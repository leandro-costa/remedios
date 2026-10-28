package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.leandrocosta.remedios.sync.SyncOperation;
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

/** Fila offline: envio idempotente e registros divergentes preservados (seções 10.1 e 10.3). */
@QuarkusTest
class SyncTest {

    Dosing d;
    String treatment;
    Instant pastAt;
    String past;

    @BeforeEach
    void setUp() {
        d = new Dosing();
        pastAt = d.now.minus(2, ChronoUnit.HOURS);
        treatment = d.createTreatment(Dosing.dailyAt(pastAt, d.now.plus(1, ChronoUnit.HOURS)));
        d.activate(treatment, 1, d.now.minus(3, ChronoUnit.HOURS));
        past = d.occurrenceAt(pastAt);
    }

    @Test
    void resendingTheSameOperationHasNoNewEffects() {
        UUID op = UUID.randomUUID();
        administer(d.ana, d.anaDevice, op, 1L, null).statusCode(200).body("status", equalTo("ADMINISTERED"))
                .body("version", equalTo(2));
        administer(d.ana, d.anaDevice, op, 1L, null).statusCode(200).body("status", equalTo("ADMINISTERED"))
                .body("version", equalTo(2));

        detail().body("records", hasSize(1)).body("trail", hasSize(1));
        assertEquals(1L, QuarkusTransaction.requiringNew().call(() -> SyncOperation.count("operationKey", op)));
    }

    @Test
    void operationIdCannotBeReusedForAnotherDose() {
        UUID op = UUID.randomUUID();
        administer(d.ana, d.anaDevice, op, 1L, null).statusCode(200);
        String soon = d.occurrenceAt(d.now.plus(1, ChronoUnit.HOURS));
        d.ana.req().body(body(d.anaDevice, op, 1L, null))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, soon).then().statusCode(409)
                .body("code", equalTo("OPERATION_ID_IN_USE"));
    }

    @Test
    void offlineAdministrationOfAnAlreadyGivenDoseOpensReview() {
        administer(d.ana, d.anaDevice, UUID.randomUUID(), 1L, null).statusCode(200);

        // Bruno estava offline, viu a dose em aberto (versão 1) e também registrou.
        Instant tapped = d.now.minus(30, ChronoUnit.MINUTES);
        administer(d.bruno, d.brunoDevice, UUID.randomUUID(), 1L, tapped).statusCode(200)
                .body("status", equalTo("REVIEW_REQUIRED"))
                .body("administration.recordedBy.displayName", equalTo("Ana"));

        detail().body("records", hasSize(1))
                .body("conflict.previous.status", equalTo("ADMINISTERED"))
                .body("conflict.proposals", hasSize(1))
                .body("conflict.proposals[0].type", equalTo("ADMINISTER"))
                .body("conflict.proposals[0].recordedBy.displayName", equalTo("Bruno"))
                .body("conflict.proposals[0].recordedAt", equalTo(tapped.toString()));
        d.bruno.req().get("/api/families/{f}/conflicts", d.family).then().statusCode(200)
                .body("occurrence.id", equalTo(List.of(past)));
        // Enquanto em revisão, a dose não aceita registro comum.
        d.ana.req().body(Map.of("deviceId", d.anaDevice))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, past).then().statusCode(409)
                .body("code", equalTo("REVIEW_REQUIRED"));
    }

    @Test
    void contradictoryOfflineReportOpensReview() {
        administer(d.ana, d.anaDevice, UUID.randomUUID(), 1L, null).statusCode(200);
        notAdministered(d.bruno, d.brunoDevice, UUID.randomUUID(), 1L).statusCode(200)
                .body("status", equalTo("REVIEW_REQUIRED"));
    }

    @Test
    void matchingOfflineReportsNeedNoReview() {
        notAdministered(d.ana, d.anaDevice, UUID.randomUUID(), 1L).statusCode(200);
        notAdministered(d.bruno, d.brunoDevice, UUID.randomUUID(), 1L).statusCode(200)
                .body("status", equalTo("NOT_ADMINISTERED"));
    }

    @Test
    void administrationOfACancelledDoseIsPreservedForReview() {
        String soon = d.occurrenceAt(d.now.plus(1, ChronoUnit.HOURS));
        d.ana.req().body(Map.of("status", "SUSPENDED", "baseVersion", 2))
                .post("/api/families/{f}/treatments/{t}/status", d.family, treatment).then().statusCode(200);

        d.bruno.req().body(body(d.brunoDevice, UUID.randomUUID(), 1L, null))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, soon).then().statusCode(200)
                .body("status", equalTo("REVIEW_REQUIRED"));
    }

    @Test
    void reviewCanAdoptAPreservedProposal() {
        administer(d.ana, d.anaDevice, UUID.randomUUID(), 1L, null).statusCode(200);
        Instant tapped = d.now.minus(40, ChronoUnit.MINUTES);
        administer(d.bruno, d.brunoDevice, UUID.randomUUID(), 1L, tapped).statusCode(200);
        var conflict = detail().extract();
        String proposal = conflict.path("conflict.proposals[0].id");
        int version = conflict.path("occurrence.version");

        resolve(d.ana, Map.of("baseVersion", version, "status", "ADMINISTERED", "proposalId", proposal,
                "reason", "Conversamos: quem deu foi o Bruno")).statusCode(200)
                .body("status", equalTo("ADMINISTERED"))
                .body("administration.recordedBy.displayName", equalTo("Bruno"))
                .body("administration.administeredAt", equalTo(tapped.toString()));

        detail().body("conflict", nullValue())
                .body("records", hasSize(2))
                .body("records[0].voidReason", equalTo("Conversamos: quem deu foi o Bruno"))
                .body("trail.eventType", equalTo(List.of("DOSE_ADMINISTERED", "DOSE_CONFLICT_OPENED",
                        "DOSE_CONFLICT_RESOLVED")));
        d.ana.req().get("/api/families/{f}/conflicts", d.family).then().body("size()", equalTo(0));
    }

    @Test
    void reviewCanKeepTheExistingRecordOrRejectBoth() {
        administer(d.ana, d.anaDevice, UUID.randomUUID(), 1L, null).statusCode(200);
        administer(d.bruno, d.brunoDevice, UUID.randomUUID(), 1L, null).statusCode(200);
        int version = detail().extract().path("occurrence.version");

        resolve(d.bruno, Map.of("baseVersion", version - 1, "status", "ADMINISTERED", "reason", "x"))
                .statusCode(409).body("code", equalTo("STALE_VERSION"));
        resolve(d.bruno, Map.of("baseVersion", version, "status", "ADMINISTERED", "reason", "Foi só a Ana"))
                .statusCode(200).body("administration.recordedBy.displayName", equalTo("Ana"));
        detail().body("records", hasSize(1)).body("records[0].voidedAt", nullValue());
        resolve(d.bruno, Map.of("baseVersion", version + 1, "status", "NOT_ADMINISTERED", "reason", "x"))
                .statusCode(409).body("code", equalTo("NO_CONFLICT"));
    }

    @Test
    void reviewCanConcludeTheDoseWasNotGiven() {
        administer(d.ana, d.anaDevice, UUID.randomUUID(), 1L, null).statusCode(200);
        notAdministered(d.bruno, d.brunoDevice, UUID.randomUUID(), 1L).statusCode(200);
        int version = detail().extract().path("occurrence.version");

        resolve(d.ana, Map.of("baseVersion", version, "status", "NOT_ADMINISTERED", "reason",
                "Registrei no paciente errado")).statusCode(200)
                .body("status", equalTo("NOT_ADMINISTERED"))
                .body("administration", nullValue());
        detail().body("records[0].voidedAt", notNullValue());
    }

    @Test
    void offlineTapTimeIsKeptAndUsedForTheAdvanceCheck() {
        String later = d.occurrenceAt(d.now.plus(1, ChronoUnit.HOURS));
        Instant tapped = d.now.minus(20, ChronoUnit.MINUTES);
        administer(d.ana, d.anaDevice, UUID.randomUUID(), 1L, tapped, later).statusCode(200)
                .body("administration.recordedAt", equalTo(tapped.toString()))
                .body("administration.administeredAt", equalTo(tapped.toString()));
    }

    private ValidatableResponse administer(Api.User user, UUID device, UUID op, Long baseVersion,
            Instant recordedAt) {
        return administer(user, device, op, baseVersion, recordedAt, past);
    }

    private ValidatableResponse administer(Api.User user, UUID device, UUID op, Long baseVersion,
            Instant recordedAt, String occurrence) {
        return user.req().body(body(device, op, baseVersion, recordedAt))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, occurrence).then();
    }

    private ValidatableResponse notAdministered(Api.User user, UUID device, UUID op, Long baseVersion) {
        return user.req().body(body(device, op, baseVersion, null))
                .post("/api/families/{f}/occurrences/{o}/not-administered", d.family, past).then();
    }

    private ValidatableResponse resolve(Api.User user, Map<String, Object> body) {
        return user.req().body(body).post("/api/families/{f}/occurrences/{o}/resolution", d.family, past).then();
    }

    private ValidatableResponse detail() {
        return d.ana.req().get("/api/families/{f}/occurrences/{o}", d.family, past).then().statusCode(200);
    }

    private static Map<String, Object> body(UUID device, UUID op, Long baseVersion, Instant recordedAt) {
        Map<String, Object> body = new HashMap<>();
        body.put("deviceId", device);
        body.put("operationId", op);
        body.put("baseVersion", baseVersion);
        body.put("recordedAt", recordedAt == null ? null : recordedAt.toString());
        return body;
    }
}
