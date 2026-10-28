package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.leandrocosta.remedios.Api.User;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.response.Response;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.IntFunction;
import org.junit.jupiter.api.Test;

/**
 * Rajadas de pedidos simultâneos (fase 5): várias pessoas e aparelhos agindo
 * no mesmo instante não podem gerar registros duplicados, perder propostas
 * nem deixar o banco inconsistente.
 */
@QuarkusTest
class ConcurrencyTest {

    private static final int N = 8;

    /** Dispara {@code n} pedidos ao mesmo tempo e devolve as respostas. */
    private static List<Response> burst(int n, IntFunction<Response> request) throws Exception {
        CountDownLatch ready = new CountDownLatch(n);
        CountDownLatch go = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(n)) {
            List<Future<Response>> futures = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                int index = i;
                Callable<Response> task = () -> {
                    ready.countDown();
                    go.await();
                    return request.apply(index);
                };
                futures.add(pool.submit(task));
            }
            ready.await();
            go.countDown();
            List<Response> responses = new ArrayList<>();
            for (Future<Response> f : futures) {
                responses.add(f.get());
            }
            return responses;
        }
    }

    private static long count(List<Response> responses, int status) {
        return responses.stream().filter(r -> r.statusCode() == status).count();
    }

    @Test
    void muitosRegistrosOnlineDaMesmaDoseGeramUmaSoAdministracao() throws Exception {
        Dosing d = new Dosing();
        Instant pastAt = d.now.minus(1, ChronoUnit.HOURS);
        d.activate(d.createTreatment(Dosing.dailyAt(pastAt)), 1, d.now.minus(2, ChronoUnit.HOURS));
        String dose = d.occurrenceAt(pastAt);

        List<Response> responses = burst(N, i -> {
            User who = i % 2 == 0 ? d.ana : d.bruno;
            UUID device = i % 2 == 0 ? d.anaDevice : d.brunoDevice;
            return who.req().body(Map.of("deviceId", device))
                    .post("/api/families/{f}/occurrences/{o}/administration", d.family, dose);
        });

        assertEquals(1, count(responses, 200), "uma administração aceita");
        assertEquals(N - 1, count(responses, 409), "as demais recusadas com quem registrou");
        d.ana.req().get("/api/families/{f}/occurrences/{o}", d.family, dose).then()
                .body("records", hasSize(1)).body("occurrence.version", equalTo(2));
    }

    @Test
    void registrosOfflineSimultaneosDivergentesViramUmUnicoConflito() throws Exception {
        Dosing d = new Dosing();
        Instant pastAt = d.now.minus(1, ChronoUnit.HOURS);
        d.activate(d.createTreatment(Dosing.dailyAt(pastAt)), 1, d.now.minus(2, ChronoUnit.HOURS));
        String dose = d.occurrenceAt(pastAt);

        // Todos viram a dose em aberto (versão 1) e registraram sem conexão.
        List<Response> responses = burst(N, i -> {
            User who = i % 2 == 0 ? d.ana : d.bruno;
            UUID device = i % 2 == 0 ? d.anaDevice : d.brunoDevice;
            return who.req().body(Map.of("deviceId", device, "operationId", UUID.randomUUID(), "baseVersion", 1,
                    "recordedAt", d.now.minus(30, ChronoUnit.MINUTES).toString()))
                    .post("/api/families/{f}/occurrences/{o}/administration", d.family, dose);
        });

        assertEquals(N, count(responses, 200), "nenhum registro é recusado nem perdido");
        d.ana.req().get("/api/families/{f}/occurrences/{o}", d.family, dose).then()
                .body("occurrence.status", equalTo("REVIEW_REQUIRED"))
                .body("records", hasSize(1))
                .body("conflict.proposals", hasSize(N - 1));
        d.ana.req().get("/api/families/{f}/conflicts", d.family).then().body("$", hasSize(1));
    }

    @Test
    void mesmaChaveDeOperacaoEnviadaAoMesmoTempoTemEfeitoUmaVez() throws Exception {
        User ana = Api.newUser("Ana");
        UUID family = Api.createFamily(ana, "Família");
        UUID op = UUID.randomUUID();
        UUID person = UUID.randomUUID();

        List<Response> responses = burst(N, i -> ana.req().header("Idempotency-Key", op.toString())
                .body(Map.of("id", person, "displayName", "Gabriel"))
                .post("/api/families/{f}/persons", family));

        assertTrue(count(responses, 201) >= 1, "ao menos uma resposta com a pessoa criada");
        // As que chegaram durante a execução da primeira pedem para tentar de novo; nenhuma falha.
        assertEquals(N, count(responses, 201) + count(responses, 409));
        responses.stream().filter(r -> r.statusCode() == 409)
                .forEach(r -> assertEquals("OPERATION_IN_PROGRESS", r.path("code")));
        ana.req().get("/api/families/{f}/persons", family).then().body("$", hasSize(1));
        // Depois de concluída, o reenvio devolve a resposta guardada.
        ana.req().header("Idempotency-Key", op.toString()).body(Map.of("id", person, "displayName", "Gabriel"))
                .post("/api/families/{f}/persons", family).then().statusCode(201)
                .header("Idempotent-Replay", "true");
    }

    private static Map<String, Object> update(long base, String dose, UUID device) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", "Medicamento A");
        body.put("kind", "CONTINUOUS");
        body.put("prescribedDose", dose);
        body.put("startAt", Instant.now().minus(2, ChronoUnit.DAYS).toString());
        body.put("schedule", Dosing.dailyAt(Instant.now().plus(3, ChronoUnit.HOURS)));
        body.put("baseVersion", base);
        body.put("effectiveFrom", Instant.now().toString());
        if (device != null) {
            body.put("preserveConflict", true);
            body.put("deviceId", device);
        }
        return body;
    }

    @Test
    void alteracoesSimultaneasDoTratamentoAplicamUmaSo() throws Exception {
        Dosing d = new Dosing();
        String t = d.createTreatment(Dosing.dailyAt(d.now.plus(3, ChronoUnit.HOURS)));

        List<Response> responses = burst(N, i -> (i % 2 == 0 ? d.ana : d.bruno).req()
                .body(update(1, (i + 1) + " ml", null)).put("/api/families/{f}/treatments/{t}", d.family, t));

        assertEquals(1, count(responses, 200));
        assertEquals(N - 1, count(responses, 409));
        responses.stream().filter(r -> r.statusCode() == 409)
                .forEach(r -> assertEquals("STALE_VERSION", r.path("code")));
        d.ana.req().get("/api/families/{f}/treatments/{t}/revisions", d.family, t).then().body("$", hasSize(2));
    }

    @Test
    void alteracoesOfflineSimultaneasEntramTodasNoMesmoConflito() throws Exception {
        Dosing d = new Dosing();
        String t = d.createTreatment(Dosing.dailyAt(d.now.plus(3, ChronoUnit.HOURS)));
        d.bruno.req().body(update(1, "7 ml", null)).put("/api/families/{f}/treatments/{t}", d.family, t)
                .then().statusCode(200);

        // Todos alteraram offline sobre a versão 1, agora desatualizada.
        List<Response> responses = burst(N, i -> {
            User who = i % 2 == 0 ? d.ana : d.bruno;
            UUID device = i % 2 == 0 ? d.anaDevice : d.brunoDevice;
            return who.req().header("Idempotency-Key", UUID.randomUUID().toString())
                    .body(update(1, (i + 10) + " ml", device)).put("/api/families/{f}/treatments/{t}", d.family, t);
        });

        assertEquals(N, count(responses, 202), "todas preservadas para conferência");
        d.ana.req().get("/api/families/{f}/treatments/conflicts", d.family).then()
                .body("$", hasSize(1)).body("[0].proposals", hasSize(N))
                .body("[0].treatment.prescribedDose", equalTo("7 ml"));
    }
}
