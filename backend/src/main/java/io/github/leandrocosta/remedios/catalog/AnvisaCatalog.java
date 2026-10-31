package io.github.leandrocosta.remedios.catalog;

import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Catálogo de medicamentos registrados na ANVISA (dados abertos), para sugerir
 * nome, substâncias e fabricante ao cadastrar um medicamento. Só registros
 * ativos, sem repetição de nome + substâncias + fabricante. O arquivo vem em
 * ISO-8859-1, separado por ponto e vírgula.
 */
@ApplicationScoped
public class AnvisaCatalog {

    private static final Logger LOG = Logger.getLogger(AnvisaCatalog.class);

    /** Um produto: nome comercial, princípios ativos (separados por vírgula), fabricante e categoria. */
    public record Product(String name, String substances, String manufacturer, String category) {
    }

    public record Info(String version, String source, int count, Instant importedAt) {
    }

    private final EntityManager em;
    private final Optional<String> url;
    private final Duration refresh;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20))
            .followRedirects(HttpClient.Redirect.NORMAL).build();

    public AnvisaCatalog(EntityManager em, @ConfigProperty(name = "remedios.anvisa.url") Optional<String> url,
            @ConfigProperty(name = "remedios.anvisa.refresh") Duration refresh) {
        this.em = em;
        this.url = url.filter(u -> !u.isBlank());
        this.refresh = refresh;
    }

    public Optional<Info> info() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                "SELECT version, source, product_count, imported_at FROM anvisa_import WHERE id = 1", Object[].class)
                .getResultList();
        return rows.stream().findFirst().map(r -> new Info((String) r[0], (String) r[1], ((Number) r[2]).intValue(),
                instant(r[3])));
    }

    public List<Product> products() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                "SELECT name, substances, manufacturer, category FROM anvisa_product ORDER BY id", Object[].class)
                .getResultList();
        return rows.stream().map(r -> new Product((String) r[0], (String) r[1], (String) r[2], (String) r[3])).toList();
    }

    /** Importa se ainda não há catálogo ou se ele passou do intervalo de atualização. */
    public void refreshIfStale(Instant now) {
        if (url.isEmpty()) {
            return;
        }
        Optional<Info> current = QuarkusTransaction.requiringNew().call(this::info);
        if (current.isPresent() && current.get().importedAt().plus(refresh).isAfter(now)) {
            return;
        }
        try {
            importFrom(url.get());
        } catch (IOException | RuntimeException e) {
            LOG.warnf(e, "Não foi possível importar o catálogo da ANVISA de %s; tento de novo mais tarde.", url.get());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Baixa (ou lê) o arquivo e substitui o catálogo numa transação. */
    public Info importFrom(String source) throws IOException, InterruptedException {
        List<Product> products;
        if (source.startsWith("file:")) {
            try (InputStream in = Files.newInputStream(Path.of(URI.create(source)))) {
                products = parse(in);
            }
        } else {
            HttpResponse<InputStream> response = http.send(HttpRequest.newBuilder(URI.create(source))
                    .timeout(Duration.ofMinutes(5)).GET().build(), HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() != 200) {
                response.body().close();
                throw new IOException("HTTP " + response.statusCode());
            }
            try (InputStream in = response.body()) {
                products = parse(in);
            }
        }
        if (products.isEmpty()) {
            throw new IOException("Arquivo sem medicamentos ativos");
        }
        Info info = new Info(version(products), source, products.size(), Instant.now());
        QuarkusTransaction.requiringNew().run(() -> replace(products, info));
        LOG.infof("Catálogo da ANVISA importado: %d medicamentos (versão %s).", products.size(), info.version());
        return info;
    }

    private void replace(List<Product> products, Info info) {
        em.createNativeQuery("DELETE FROM anvisa_product").executeUpdate();
        int batch = 0;
        StringBuilder sql = new StringBuilder();
        List<Object> params = new ArrayList<>();
        for (Product p : products) {
            sql.append(batch == 0 ? "INSERT INTO anvisa_product (name, substances, manufacturer, category) VALUES " : ", ");
            sql.append("(?, ?, ?, ?)");
            params.add(p.name());
            params.add(p.substances());
            params.add(p.manufacturer());
            params.add(p.category());
            if (++batch == 500) {
                flush(sql, params);
                batch = 0;
            }
        }
        if (batch > 0) {
            flush(sql, params);
        }
        em.createNativeQuery("""
                INSERT INTO anvisa_import (id, version, source, product_count, imported_at)
                VALUES (1, ?1, ?2, ?3, ?4)
                ON CONFLICT (id) DO UPDATE SET version = excluded.version, source = excluded.source,
                    product_count = excluded.product_count, imported_at = excluded.imported_at
                """).setParameter(1, info.version()).setParameter(2, info.source())
                .setParameter(3, info.count()).setParameter(4, info.importedAt()).executeUpdate();
    }

    private void flush(StringBuilder sql, List<Object> params) {
        var query = em.createNativeQuery(sql.toString());
        for (int i = 0; i < params.size(); i++) {
            query.setParameter(i + 1, params.get(i));
        }
        query.executeUpdate();
        sql.setLength(0);
        params.clear();
    }

    /** Lê o CSV da ANVISA: só medicamentos com registro ativo, sem repetição, ordenados por nome. */
    static List<Product> parse(InputStream in) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.ISO_8859_1));
        List<String> header = fields(reader.readLine());
        int name = header.indexOf("NOME_PRODUTO");
        int status = header.indexOf("SITUACAO_REGISTRO");
        int substances = header.indexOf("PRINCIPIO_ATIVO");
        int company = header.indexOf("EMPRESA_DETENTORA_REGISTRO");
        int category = header.indexOf("CATEGORIA_REGULATORIA");
        if (name < 0 || status < 0 || substances < 0) {
            throw new IOException("Cabeçalho inesperado no arquivo da ANVISA");
        }
        Map<String, Product> unique = new TreeMap<>();
        String line;
        while ((line = reader.readLine()) != null) {
            List<String> f = fields(line);
            if (f.size() <= Math.max(name, Math.max(status, substances)) || !"Ativo".equals(f.get(status))) {
                continue;
            }
            String n = clean(f.get(name));
            if (n == null) {
                continue;
            }
            String m = company >= 0 && company < f.size() ? clean(f.get(company)) : null;
            if (m != null && m.matches("^\\d+ - .*")) {
                m = m.substring(m.indexOf(" - ") + 3); // tira o CNPJ
            }
            Product p = new Product(n, clean(f.get(substances)), m,
                    category >= 0 && category < f.size() ? clean(f.get(category)) : null);
            unique.putIfAbsent(String.join("\u0000", n, String.valueOf(p.substances()), String.valueOf(m)), p);
        }
        return new ArrayList<>(unique.values());
    }

    /** Campos de uma linha separada por ";" com aspas duplas opcionais. */
    static List<String> fields(String line) {
        List<String> out = new ArrayList<>();
        if (line == null) {
            return out;
        }
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    cur.append('"');
                    i++;
                } else if (c == '"') {
                    quoted = false;
                } else {
                    cur.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == ';') {
                out.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        out.add(cur.toString());
        return out;
    }

    private static String clean(String s) {
        if (s == null) {
            return null;
        }
        String t = s.strip().replaceAll("\\s+", " ");
        return t.isEmpty() ? null : t;
    }

    private static String version(List<Product> products) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            for (Product p : products) {
                sha.update((p.name() + ";" + p.substances() + ";" + p.manufacturer() + ";" + p.category() + "\n")
                        .getBytes(StandardCharsets.UTF_8));
            }
            return HexFormat.of().formatHex(sha.digest()).substring(0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Instant instant(Object value) {
        return switch (value) {
            case Instant i -> i;
            case OffsetDateTime o -> o.toInstant();
            case java.sql.Timestamp t -> t.toInstant();
            default -> throw new IllegalStateException("Data inesperada: " + value.getClass());
        };
    }
}
