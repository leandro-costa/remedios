package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Alterações de tratamento feitas offline (seção 10.2) e doses anteriores à ativação. */
@QuarkusTest
class TreatmentOfflineTest {

    private static Map<String, Object> update(long baseVersion, String dose, UUID device) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", "Medicamento A");
        body.put("kind", "CONTINUOUS");
        body.put("prescribedDose", dose);
        body.put("startAt", Instant.now().minus(2, ChronoUnit.DAYS).toString());
        body.put("schedule", Dosing.dailyAt(Instant.now().plus(3, ChronoUnit.HOURS)));
        body.put("baseVersion", baseVersion);
        body.put("effectiveFrom", Instant.now().minus(1, ChronoUnit.HOURS).toString());
        body.put("reason", "Receita nova");
        if (device != null) {
            body.put("preserveConflict", true);
            body.put("deviceId", device);
        }
        return body;
    }

    @Test
    void alteracaoOfflineSobreVersaoAntigaFicaParaConferencia() {
        Dosing d = new Dosing();
        String t = d.createTreatment(Dosing.dailyAt(d.now.plus(3, ChronoUnit.HOURS)));

        // Bruno altera online: versão 2.
        d.bruno.req().body(update(1, "7 ml", null)).put("/api/families/{f}/treatments/{t}", d.family, t)
                .then().statusCode(200).body("version", equalTo(2));

        // Ana alterou offline sobre a versão 1; chega depois e é preservada.
        UUID op = UUID.randomUUID();
        String conflictId = d.ana.req().header("Idempotency-Key", op.toString()).body(update(1, "10 ml", d.anaDevice))
                .put("/api/families/{f}/treatments/{t}", d.family, t)
                .then().statusCode(202).body("status", equalTo("IN_REVIEW"))
                .body("treatment.prescribedDose", equalTo("7 ml")).extract().path("conflictId");

        // O tratamento não muda enquanto a conferência está pendente.
        d.bruno.req().body(update(2, "8 ml", null)).put("/api/families/{f}/treatments/{t}", d.family, t)
                .then().statusCode(409).body("code", equalTo("TREATMENT_IN_REVIEW"));
        d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, t).then()
                .body("conflictId", equalTo(conflictId)).body("prescribedDose", equalTo("7 ml"));

        JsonPath conflicts = d.bruno.req().get("/api/families/{f}/treatments/conflicts", d.family)
                .then().statusCode(200).body("$", hasSize(1)).extract().jsonPath();
        assertEquals("10 ml", conflicts.getString("[0].proposals[0].data.prescribedDose"));
        assertEquals("UPDATE", conflicts.getString("[0].proposals[0].action"));
        String proposal = conflicts.getString("[0].proposals[0].id");

        // Bruno decide aplicar a proposta da Ana sobre a versão atual.
        d.bruno.req().body(Map.of("conflictId", conflictId, "choice", "ADOPT", "proposalId", proposal,
                "baseVersion", 2, "reason", "Ana trouxe a receita nova"))
                .post("/api/families/{f}/treatments/{t}/conflict/resolution", d.family, t)
                .then().statusCode(200).body("prescribedDose", equalTo("10 ml")).body("version", equalTo(3))
                .body("conflictId", nullValue());
        d.bruno.req().get("/api/families/{f}/treatments/conflicts", d.family).then().body("$", hasSize(0));
    }

    @Test
    void manterAVersaoAtualEDecisaoComVersaoMudadaERecusada() {
        Dosing d = new Dosing();
        String t = d.createTreatment(Dosing.dailyAt(d.now.plus(3, ChronoUnit.HOURS)));
        d.bruno.req().body(update(1, "7 ml", null)).put("/api/families/{f}/treatments/{t}", d.family, t)
                .then().statusCode(200);
        String conflictId = d.ana.req().header("Idempotency-Key", UUID.randomUUID().toString())
                .body(Map.of("status", "ENDED", "baseVersion", 1, "deviceId", d.anaDevice, "preserveConflict", true))
                .post("/api/families/{f}/treatments/{t}/status", d.family, t)
                .then().statusCode(202).extract().path("conflictId");

        d.bruno.req().body(Map.of("conflictId", conflictId, "choice", "KEEP_CURRENT", "baseVersion", 1,
                "reason", "Ainda em uso"))
                .post("/api/families/{f}/treatments/{t}/conflict/resolution", d.family, t)
                .then().statusCode(409).body("code", equalTo("STALE_VERSION"));
        d.bruno.req().body(Map.of("conflictId", conflictId, "choice", "KEEP_CURRENT", "baseVersion", 2,
                "reason", "Ainda em uso"))
                .post("/api/families/{f}/treatments/{t}/conflict/resolution", d.family, t)
                .then().statusCode(200).body("status", equalTo("DRAFT")).body("version", equalTo(2));
    }

    @Test
    void alteracaoOfflineSemConflitoValeAPartirDoEnvio() {
        Dosing d = new Dosing();
        String t = d.createTreatment(Dosing.dailyAt(d.now.plus(3, ChronoUnit.HOURS)));
        d.activate(t, 1, d.now);
        // Feita há 1 hora sem conexão; online seria recusada por valer para o passado.
        d.ana.req().header("Idempotency-Key", UUID.randomUUID().toString()).body(update(2, "10 ml", d.anaDevice))
                .put("/api/families/{f}/treatments/{t}", d.family, t)
                .then().statusCode(200).body("prescribedDose", equalTo("10 ml")).body("conflictId", nullValue());
    }

    @Test
    void dosesAnterioresInformadasComoDadasAoAtivar() {
        Dosing d = new Dosing();
        Instant twoHoursAgo = d.now.minus(2, ChronoUnit.HOURS);
        Instant inTwoHours = d.now.plus(2, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(twoHoursAgo, inTwoHours));

        // Início há 2 dias: 3 doses passadas (anteontem não, pois começou depois; ontem 2; hoje 1).
        Instant start = d.now.minus(2, ChronoUnit.DAYS).plus(1, ChronoUnit.HOURS);
        d.ana.req().body(Map.of("status", "ACTIVE", "baseVersion", 1, "effectiveFrom", start.toString(),
                "pastDoses", "ADMINISTERED", "deviceId", d.anaDevice))
                .post("/api/families/{f}/treatments/{tr}/status", d.family, t).then().statusCode(200);

        List<Map<String, Object>> doses = d.agenda(start, d.now.plus(1, ChronoUnit.DAYS)).getList("$");
        long past = doses.stream().filter(o -> Instant.parse((String) o.get("scheduledAt")).isBefore(d.now)).count();
        assertTrue(past >= 2, "esperava doses anteriores a agora");
        for (Map<String, Object> o : doses) {
            boolean isPast = Instant.parse((String) o.get("scheduledAt")).isBefore(d.now);
            assertEquals(isPast ? "ADMINISTERED" : "SCHEDULED", o.get("status"), o.toString());
        }
        String first = d.occurrenceAt(twoHoursAgo);
        d.ana.req().get("/api/families/{f}/occurrences/{o}", d.family, first).then()
                .body("records[0].administeredAt", equalTo(twoHoursAgo.toString()))
                .body("records[0].notes", notNullValue());
    }

    @Test
    void dosesAnterioresEmAbertoPorPadrao() {
        Dosing d = new Dosing();
        Instant twoHoursAgo = d.now.minus(2, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(twoHoursAgo));
        d.activate(t, 1, d.now.minus(5, ChronoUnit.DAYS));
        d.agenda(twoHoursAgo.minusSeconds(60), twoHoursAgo.plusSeconds(60)).getList("$");
        assertEquals("PENDING", d.agenda(twoHoursAgo.minusSeconds(60), twoHoursAgo.plusSeconds(60))
                .getString("[0].status"));
    }
}
