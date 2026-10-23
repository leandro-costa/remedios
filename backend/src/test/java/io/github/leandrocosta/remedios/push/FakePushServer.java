package io.github.leandrocosta.remedios.push;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Serviço de push falso: recebe as mensagens como o serviço de um navegador,
 * confere a assinatura VAPID e guarda os corpos cifrados por endpoint.
 */
public final class FakePushServer implements AutoCloseable {

    public record Received(Map<String, List<String>> headers, byte[] body) {
    }

    private final HttpServer server;
    private final Map<String, List<Received>> received = new ConcurrentHashMap<>();
    private final Map<String, Integer> statusFor = new ConcurrentHashMap<>();
    private final ObjectMapper mapper = new ObjectMapper();

    public FakePushServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/push/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            byte[] body = exchange.getRequestBody().readAllBytes();
            int status = verifyVapid(exchange.getRequestHeaders().getFirst("Authorization")) ? 201 : 403;
            if (status == 201) {
                status = statusFor.getOrDefault(path, 201);
                received.computeIfAbsent(path, k -> new CopyOnWriteArrayList<>())
                        .add(new Received(Map.copyOf(exchange.getRequestHeaders()), body));
            }
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.start();
    }

    public String base() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** Navegador simulado: inscrição com chaves próprias. */
    public Browser browser() throws Exception {
        return new Browser(this, "/push/" + UUID.randomUUID());
    }

    public void respondWith(Browser browser, int status) {
        statusFor.put(browser.path, status);
    }

    List<Received> received(String path) {
        return received.getOrDefault(path, List.of());
    }

    private boolean verifyVapid(String header) {
        try {
            String token = header.substring("vapid t=".length(), header.indexOf(", k="));
            String key = header.substring(header.indexOf(", k=") + 4);
            String[] parts = token.split("\\.");
            Map<?, ?> claims = mapper.readValue(Base64.getUrlDecoder().decode(parts[1]), Map.class);
            if (!base().equals(claims.get("aud"))) {
                return false;
            }
            Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
            verifier.initVerify(WebPushCrypto.publicKey(WebPushCrypto.b64(key)));
            verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            return verifier.verify(Base64.getUrlDecoder().decode(parts[2]));
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }

    public static final class Browser {
        private final FakePushServer server;
        final String path;
        private final KeyPair keys;
        private final byte[] auth = new byte[16];
        private int read;

        Browser(FakePushServer server, String path) throws Exception {
            this.server = server;
            this.path = path;
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(WebPushCrypto.P256);
            keys = generator.generateKeyPair();
            new SecureRandom().nextBytes(auth);
        }

        public Map<String, Object> subscription(String timezone) {
            return Map.of("endpoint", server.base() + path,
                    "p256dh", WebPushCrypto.b64(WebPushCrypto.rawPublic((ECPublicKey) keys.getPublic())),
                    "auth", WebPushCrypto.b64(auth), "timezone", timezone);
        }

        /** Mensagens decifradas recebidas desde a última chamada. */
        @SuppressWarnings("unchecked")
        public List<Map<String, Object>> take() throws Exception {
            List<Received> all = server.received(path);
            List<Map<String, Object>> messages = new ArrayList<>();
            for (Received r : all.subList(read, all.size())) {
                byte[] plain = WebPushCrypto.decrypt(r.body(), (ECPrivateKey) keys.getPrivate(),
                        WebPushCrypto.rawPublic((ECPublicKey) keys.getPublic()), auth);
                Map<String, Object> message = server.mapper.readValue(plain, Map.class);
                message.put("_urgency", r.headers().get("Urgency").getFirst());
                messages.add(message);
            }
            read = all.size();
            return messages;
        }

        public URI endpoint() {
            return URI.create(server.base() + path);
        }
    }
}
