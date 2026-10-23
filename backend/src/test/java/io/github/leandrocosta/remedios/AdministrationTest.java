package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.leandrocosta.remedios.audit.OutboxEvent;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.response.ValidatableResponse;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

@QuarkusTest
class AdministrationTest {

    Dosing d;
    Instant pastAt;
    Instant soonAt;
    Instant laterAt;
    String past;
    String soon;
    String later;

    @BeforeEach
    void setUp() {
        d = new Dosing();
        pastAt = d.now.minus(2, ChronoUnit.HOURS);
        soonAt = d.now.plus(1, ChronoUnit.HOURS);
        laterAt = d.now.plus(10, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(pastAt, soonAt, laterAt));
        d.activate(t, 1, d.now.minus(3, ChronoUnit.HOURS));
        past = d.occurrenceAt(pastAt);
        soon = d.occurrenceAt(soonAt);
        later = d.occurrenceAt(laterAt);
    }

    @Test
    void recordsAdministrationWithAuthorDeviceAndTimes() {
        Instant given = d.now.minus(90, ChronoUnit.MINUTES);
        administer(d.ana, d.anaDevice, past, given, "Com água").statusCode(200)
                .body("status", equalTo("ADMINISTERED"))
                .body("late", equalTo(false))
                .body("version", equalTo(2))
                .body("administration.administeredAt", equalTo(given.toString()))
                .body("administration.recordedBy.displayName", equalTo("Ana"))
                .body("administration.deviceId", equalTo(d.anaDevice.toString()))
                .body("administration.recordedAt", notNullValue())
                .body("administration.notes", equalTo("Com água"));

        // Bruno vê o registro na agenda compartilhada.
        d.bruno.req().get("/api/families/{f}/occurrences/{o}", d.family, past).then().statusCode(200)
                .body("occurrence.status", equalTo("ADMINISTERED"))
                .body("records", hasSize(1))
                .body("trail[0].eventType", equalTo("DOSE_ADMINISTERED"))
                .body("trail[0].actor.displayName", equalTo("Ana"));
    }

    @Test
    void secondAdministrationOfTheSameDoseIsBlocked() {
        administer(d.ana, d.anaDevice, past, null, null).statusCode(200);
        administer(d.bruno, d.brunoDevice, past, null, null).statusCode(409)
                .body("code", equalTo("ALREADY_ADMINISTERED"))
                .body("details.recordedBy.displayName", equalTo("Ana"))
                .body("details.administeredAt", notNullValue());
    }

    @Test
    void simultaneousAdministrationsProduceOnlyOneValidRecord() throws Exception {
        try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var a = pool.submit(() -> administer(d.ana, d.anaDevice, past, null, null).extract().statusCode());
            var b = pool.submit(() -> administer(d.bruno, d.brunoDevice, past, null, null).extract().statusCode());
            assertEquals(List.of(200, 409), java.util.stream.Stream.of(a.get(), b.get()).sorted().toList());
        }
        d.ana.req().get("/api/families/{f}/occurrences/{o}", d.family, past).then().body("records", hasSize(1));
    }

    @Test
    void administeredAtDefaultsToNowAndCannotBeInTheFuture() {
        administer(d.ana, d.anaDevice, soon, d.now.plus(1, ChronoUnit.HOURS), null).statusCode(422)
                .body("code", equalTo("ADMINISTERED_AT_IN_FUTURE"));
        Instant before = Instant.now().minusSeconds(1);
        String at = administer(d.ana, d.anaDevice, soon, null, null).statusCode(200)
                .extract().path("administration.administeredAt");
        org.junit.jupiter.api.Assertions.assertTrue(Instant.parse(at).isAfter(before));
    }

    @Test
    void doseFarAheadCannotBeRecordedByMistake() {
        administer(d.ana, d.anaDevice, later, null, null).statusCode(422)
                .body("code", equalTo("OCCURRENCE_TOO_EARLY"));
        d.ana.req().body(Map.of()).post("/api/families/{f}/occurrences/{o}/not-administered", d.family, later)
                .then().statusCode(422).body("code", equalTo("OCCURRENCE_TOO_EARLY"));
    }

    @Test
    void requiresARegisteredActiveDeviceOfTheUser() {
        administer(d.ana, UUID.randomUUID(), past, null, null).statusCode(422)
                .body("code", equalTo("DEVICE_NOT_REGISTERED"));
        administer(d.ana, d.brunoDevice, past, null, null).statusCode(422)
                .body("code", equalTo("DEVICE_NOT_REGISTERED"));

        d.ana.req().delete("/api/me/devices/{d}", d.anaDevice).then().statusCode(204);
        administer(d.ana, d.anaDevice, past, null, null).statusCode(403);
        // Um aparelho desconectado não pode ser reativado com o mesmo id.
        d.ana.req().body(Map.of("platform", "ANDROID")).put("/api/me/devices/{d}", d.anaDevice).then()
                .statusCode(409).body("code", equalTo("DEVICE_REVOKED"));
        // Nem registrado por outra conta.
        Api.newUser("Eve").req().body(Map.of("platform", "ANDROID")).put("/api/me/devices/{d}", d.brunoDevice)
                .then().statusCode(409).body("code", equalTo("DEVICE_ID_IN_USE"));
    }

    @Test
    void notAdministeredIsNeverAnAdministration() {
        d.bruno.req().body(Map.of("reason", "Criança dormindo")).post(
                "/api/families/{f}/occurrences/{o}/not-administered", d.family, past).then().statusCode(200)
                .body("status", equalTo("NOT_ADMINISTERED"))
                .body("statusReason", equalTo("Criança dormindo"))
                .body("administration", nullValue())
                .body("statusChangedBy.displayName", equalTo("Bruno"));

        administer(d.ana, d.anaDevice, past, null, null).statusCode(409).body("code", equalTo("ALREADY_RECORDED"));
    }

    @Test
    void correctionPreservesTheOriginalRecord() {
        administer(d.ana, d.anaDevice, past, d.now.minus(2, ChronoUnit.HOURS), null).statusCode(200);

        Instant fixed = d.now.minus(100, ChronoUnit.MINUTES);
        correct(d.bruno, past, 2, "ADMINISTERED", fixed, d.brunoDevice, "Horário anotado errado").statusCode(200)
                .body("status", equalTo("ADMINISTERED"))
                .body("version", equalTo(3))
                .body("administration.administeredAt", equalTo(fixed.toString()))
                .body("administration.recordedBy.displayName", equalTo("Bruno"));

        d.ana.req().get("/api/families/{f}/occurrences/{o}", d.family, past).then().statusCode(200)
                .body("records", hasSize(2))
                .body("records[0].voidedAt", notNullValue())
                .body("records[0].voidReason", equalTo("Horário anotado errado"))
                .body("records[0].voidedBy.displayName", equalTo("Bruno"))
                .body("records[1].voidedAt", nullValue())
                .body("trail.eventType", equalTo(List.of("DOSE_ADMINISTERED", "DOSE_CORRECTED")))
                .body("trail[1].reason", equalTo("Horário anotado errado"));
    }

    @Test
    void correctionToNotAdministeredAndBackToOpen() {
        administer(d.ana, d.anaDevice, past, null, null).statusCode(200);
        correct(d.ana, past, 2, "NOT_ADMINISTERED", null, null, "Registrei a dose errada").statusCode(200)
                .body("status", equalTo("NOT_ADMINISTERED"))
                .body("administration", nullValue());
        correct(d.ana, past, 3, "OPEN", null, null, "Ainda vou dar").statusCode(200)
                .body("status", equalTo("PENDING"));
        // Reaberta, a dose volta a aceitar o registro normal.
        administer(d.bruno, d.brunoDevice, past, null, null).statusCode(200)
                .body("administration.recordedBy.displayName", equalTo("Bruno"));
    }

    @Test
    void correctionRequiresReasonCurrentVersionAndAClosedDose() {
        correct(d.ana, past, 1, "NOT_ADMINISTERED", null, null, "x").statusCode(409)
                .body("code", equalTo("NOTHING_TO_CORRECT"));
        administer(d.ana, d.anaDevice, past, null, null).statusCode(200);
        correct(d.ana, past, 1, "NOT_ADMINISTERED", null, null, "x").statusCode(409)
                .body("code", equalTo("STALE_VERSION"))
                .body("details.currentVersion", equalTo(2));
        correct(d.ana, past, 2, "NOT_ADMINISTERED", null, null, " ").statusCode(400);
    }

    @Test
    void historyShowsRecordedDosesWithFilters() {
        administer(d.ana, d.anaDevice, past, null, null).statusCode(200);
        d.bruno.req().body(Map.of()).post("/api/families/{f}/occurrences/{o}/not-administered", d.family, soon)
                .then().statusCode(200);

        history(Map.of()).body("id", equalTo(List.of(soon, past)));
        history(Map.of("recordedBy", d.bruno.id().toString())).body("id", equalTo(List.of(soon)));
        history(Map.of("personId", UUID.randomUUID().toString())).body("size()", equalTo(0));
    }

    @Test
    void outboxCarriesOnlyIdentifiers() {
        administer(d.ana, d.anaDevice, past, null, "observação sensível").statusCode(200);
        OutboxEvent e = QuarkusTransaction.requiringNew().call(() -> OutboxEvent
                .<OutboxEvent>find("aggregateId = ?1", UUID.fromString(past)).firstResult());
        assertEquals("DOSE_ADMINISTERED", e.eventType);
        assertEquals(java.util.Set.of("occurrenceId", "treatmentId", "personId", "status", "version"),
                e.payload.keySet());
    }

    @Test
    void outsidersCannotSeeOrRecordDoses() {
        Api.User eve = Api.newUser("Eve");
        UUID eveDevice = UUID.randomUUID();
        Dosing.registerDevice(eve, eveDevice);
        eve.req().get("/api/families/{f}/occurrences/{o}", d.family, past).then().statusCode(404);
        administer(eve, eveDevice, past, null, null).statusCode(404);
    }

    private ValidatableResponse administer(Api.User user, UUID device, String occurrence, Instant at, String notes) {
        Map<String, Object> body = new HashMap<>();
        body.put("deviceId", device);
        body.put("administeredAt", at == null ? null : at.toString());
        body.put("notes", notes);
        return user.req().body(body)
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, occurrence).then();
    }

    private ValidatableResponse correct(Api.User user, String occurrence, long baseVersion, String status,
            Instant at, UUID device, String reason) {
        Map<String, Object> body = new HashMap<>();
        body.put("baseVersion", baseVersion);
        body.put("status", status);
        body.put("administeredAt", at == null ? null : at.toString());
        body.put("deviceId", device);
        body.put("reason", reason);
        return user.req().body(body).post("/api/families/{f}/occurrences/{o}/correction", d.family, occurrence)
                .then();
    }

    private ValidatableResponse history(Map<String, String> filters) {
        var req = d.ana.req().queryParam("from", d.now.minus(1, ChronoUnit.DAYS).toString())
                .queryParam("to", d.now.plus(1, ChronoUnit.DAYS).toString());
        filters.forEach(req::queryParam);
        return req.get("/api/families/{f}/history", d.family).then().statusCode(200);
    }
}
