package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Uso "se necessário": sem agenda; cada dose é registrada quando é dada. */
@QuarkusTest
class AsNeededTest {

    Dosing d;

    @BeforeEach
    void setUp() {
        d = new Dosing();
    }

    static Map<String, Object> asNeeded(String person, Instant start) {
        Map<String, Object> body = new HashMap<>();
        body.put("personId", person);
        body.put("name", "Paracetamol");
        body.put("kind", "AS_NEEDED");
        body.put("prescribedDose", "15 gotas");
        body.put("instructions", "Até de 6/6 h se febre acima de 37,8 °C");
        body.put("startAt", start.toString());
        return body;
    }

    private String createActive() {
        String id = d.ana.req().body(asNeeded(d.person, d.now.minus(1, ChronoUnit.DAYS)))
                .post("/api/families/{f}/treatments", d.family).then().statusCode(201).extract().path("id");
        d.activate(id, 1, d.now);
        return id;
    }

    private io.restassured.response.ValidatableResponse dose(Api.User who, UUID device, String treatment,
            Map<String, Object> extra) {
        Map<String, Object> body = new HashMap<>(Map.of("deviceId", device.toString()));
        body.putAll(extra);
        return who.req().body(body).post("/api/families/{f}/treatments/{t}/doses", d.family, treatment).then();
    }

    @Test
    void activatesWithoutScheduleAndGeneratesNothing() {
        String t = createActive();
        d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, t).then().statusCode(200)
                .body("status", equalTo("ACTIVE")).body("kind", equalTo("AS_NEEDED"));
        assertEquals(0, d.agenda(d.now.minus(2, ChronoUnit.DAYS), d.now.plus(14, ChronoUnit.DAYS))
                .getList("$").size());
    }

    @Test
    void scheduleOrDoseCountAreRefused() {
        Map<String, Object> body = asNeeded(d.person, d.now);
        body.put("schedule", Dosing.dailyAt(d.now));
        d.ana.req().body(body).post("/api/families/{f}/treatments", d.family).then().statusCode(422)
                .body("code", equalTo("AS_NEEDED_WITHOUT_SCHEDULE"));
    }

    @Test
    void recordDosesAndSeeThemInHistory() {
        String t = createActive();
        String id = UUID.randomUUID().toString();
        Instant at = d.now.minus(3, ChronoUnit.HOURS);
        dose(d.ana, d.anaDevice, t, Map.of("id", id, "administeredAt", at.toString(), "notes", "38,4 °C"))
                .statusCode(200)
                .body("id", equalTo(id))
                .body("status", equalTo("ADMINISTERED"))
                .body("scheduledAt", equalTo(at.toString()))
                .body("treatment.kind", equalTo("AS_NEEDED"))
                .body("administration.recordedBy.displayName", equalTo("Ana"));
        // O mesmo id de novo é recusado (o reenvio usa Idempotency-Key).
        dose(d.ana, d.anaDevice, t, Map.of("id", id)).statusCode(409).body("code", equalTo("ID_IN_USE"));
        // Bruno dá outra agora (sem horário: vale o momento do registro).
        dose(d.bruno, d.brunoDevice, t, Map.of()).statusCode(200);

        List<Map<String, Object>> history = d.ana.req()
                .queryParam("from", d.now.minus(1, ChronoUnit.DAYS).toString())
                .queryParam("to", d.now.plus(1, ChronoUnit.HOURS).toString()).queryParam("treatmentId", t)
                .get("/api/families/{f}/history", d.family).then().statusCode(200).extract().jsonPath().getList("$");
        assertEquals(2, history.size());
        assertEquals(id, history.get(1).get("id"));
    }

    @Test
    void futureTimeAndScheduledTreatmentsAreRefused() {
        String t = createActive();
        dose(d.ana, d.anaDevice, t, Map.of("administeredAt", d.now.plus(1, ChronoUnit.HOURS).toString()))
                .statusCode(422).body("code", equalTo("ADMINISTERED_AT_IN_FUTURE"));
        String scheduled = d.createTreatment(Dosing.dailyAt(d.now));
        d.activate(scheduled, 1, d.now);
        dose(d.ana, d.anaDevice, scheduled, Map.of()).statusCode(422).body("code", equalTo("NOT_AS_NEEDED"));
    }

    @Test
    void draftRefusesButSuspendedAcceptsADoseGivenOffline() {
        String draft = d.ana.req().body(asNeeded(d.person, d.now)).post("/api/families/{f}/treatments", d.family)
                .then().statusCode(201).extract().path("id");
        dose(d.ana, d.anaDevice, draft, Map.of()).statusCode(409).body("code", equalTo("TREATMENT_NOT_ACTIVE"));

        String t = createActive();
        d.ana.req().body(Map.of("status", "SUSPENDED", "baseVersion", 2, "effectiveFrom", Instant.now().toString()))
                .post("/api/families/{f}/treatments/{t}/status", d.family, t).then().statusCode(200);
        // Dada antes da suspensão, enviada depois (aparelho estava offline): não se perde.
        dose(d.bruno, d.brunoDevice, t, Map.of("recordedAt", d.now.minus(10, ChronoUnit.MINUTES).toString()))
                .statusCode(200).body("status", equalTo("ADMINISTERED"));
    }

    @Test
    void correctTimeOrMarkAsRecordedByMistake() {
        String t = createActive();
        String id = dose(d.ana, d.anaDevice, t, Map.of()).statusCode(200).extract().path("id");
        Instant earlier = d.now.minus(40, ChronoUnit.MINUTES);
        d.ana.req().body(Map.of("baseVersion", 1, "status", "ADMINISTERED", "administeredAt", earlier.toString(),
                "reason", "Horário errado", "deviceId", d.anaDevice.toString()))
                .post("/api/families/{f}/occurrences/{o}/correction", d.family, id).then().statusCode(200)
                .body("scheduledAt", equalTo(earlier.toString()));
        // "Volta a ficar em aberto" não faz sentido sem agenda.
        d.ana.req().body(Map.of("baseVersion", 2, "status", "OPEN", "reason", "Engano"))
                .post("/api/families/{f}/occurrences/{o}/correction", d.family, id).then().statusCode(422)
                .body("code", equalTo("AS_NEEDED_CORRECTION"));
        d.ana.req().body(Map.of("baseVersion", 2, "status", "CANCELLED", "reason", "Registrei na pessoa errada"))
                .post("/api/families/{f}/occurrences/{o}/correction", d.family, id).then().statusCode(200)
                .body("status", equalTo("CANCELLED"));
    }

    @Test
    void activeTreatmentCannotSwitchBetweenAsNeededAndScheduled() {
        String t = createActive();
        Map<String, Object> body = asNeeded(d.person, d.now.minus(1, ChronoUnit.DAYS));
        body.remove("personId");
        body.put("kind", "CONTINUOUS");
        body.put("schedule", Dosing.dailyAt(d.now));
        body.put("baseVersion", 2);
        body.put("effectiveFrom", Instant.now().toString());
        d.ana.req().body(body).put("/api/families/{f}/treatments/{t}", d.family, t).then().statusCode(422)
                .body("code", equalTo("KIND_CHANGE"));
    }
}
