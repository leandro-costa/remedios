package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import io.github.leandrocosta.remedios.Api.User;
import io.github.leandrocosta.remedios.audit.OutboxEvent;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

@QuarkusTest
class TreatmentTest {

    private static final Instant START = Instant.now().truncatedTo(ChronoUnit.SECONDS);

    User ana;
    User bruno;
    UUID family;
    String gabriel;

    @BeforeEach
    void setUp() {
        ana = Api.newUser("Ana");
        bruno = Api.newUser("Bruno");
        family = Api.createFamily(ana, "Família");
        Api.join(family, ana, bruno);
        gabriel = ana.req().body(PersonTest.person("Gabriel", null, null)).post("/api/families/{f}/persons", family)
                .then().statusCode(201).extract().path("id");
    }

    @Test
    void newTreatmentStartsAsDraftVersionOne() {
        String id = create();

        bruno.req().get("/api/families/{f}/treatments/{t}", family, id).then().statusCode(200)
                .body("status", equalTo("DRAFT"))
                .body("version", equalTo(1))
                .body("kind", equalTo("CONTINUOUS"))
                .body("prescribedDose", equalTo("5 ml"))
                .body("endAt", nullValue());
        bruno.req().queryParam("personId", gabriel).get("/api/families/{f}/treatments", family)
                .then().statusCode(200).body("id", hasSize(1));
        bruno.req().queryParam("status", "ACTIVE").get("/api/families/{f}/treatments", family)
                .then().statusCode(200).body("id", hasSize(0));
    }

    @Test
    void everyAcceptedChangeCreatesARevision() {
        String id = create();
        status(ana, id, "ACTIVE", 1).statusCode(200).body("version", equalTo(2));

        Map<String, Object> change = update(2);
        change.put("prescribedDose", "7,5 ml");
        change.put("reason", "Nova receita");
        bruno.req().body(change).put("/api/families/{f}/treatments/{t}", family, id).then().statusCode(200)
                .body("version", equalTo(3))
                .body("prescribedDose", equalTo("7,5 ml"))
                .body("status", equalTo("ACTIVE"))
                .body("updatedBy", equalTo(bruno.id().toString()));

        ana.req().get("/api/families/{f}/treatments/{t}/revisions", family, id).then().statusCode(200)
                .body("version", equalTo(List.of(1, 2, 3)))
                .body("baseVersion", equalTo(java.util.Arrays.asList(null, 1, 2)))
                .body("[0].snapshot.prescribedDose", equalTo("5 ml"))
                .body("[2].snapshot.prescribedDose", equalTo("7,5 ml"))
                .body("[2].changeReason", equalTo("Nova receita"));
    }

    @Test
    void staleBaseVersionIsRejectedWithoutApplying() {
        String id = create();

        Map<String, Object> first = update(1);
        first.put("instructions", "Após o café");
        ana.req().body(first).put("/api/families/{f}/treatments/{t}", family, id).then().statusCode(200);

        // Bruno editou a partir da versão 1, já superada.
        Map<String, Object> second = update(1);
        second.put("instructions", "Antes de dormir");
        bruno.req().body(second).put("/api/families/{f}/treatments/{t}", family, id).then().statusCode(409)
                .body("code", equalTo("STALE_VERSION"))
                .body("details.currentVersion", equalTo(2));

        ana.req().get("/api/families/{f}/treatments/{t}", family, id).then()
                .body("instructions", equalTo("Após o café"))
                .body("version", equalTo(2));
    }

    @Test
    void unchangedContentDoesNotBumpVersion() {
        String id = create();
        ana.req().body(update(1)).put("/api/families/{f}/treatments/{t}", family, id).then().statusCode(200)
                .body("version", equalTo(1));
    }

    @Test
    void statusTransitionsFollowTheLifecycle() {
        String id = create();
        status(ana, id, "SUSPENDED", 1).statusCode(409).body("code", equalTo("INVALID_STATUS_TRANSITION"));
        status(ana, id, "ACTIVE", 1).statusCode(200);
        status(ana, id, "SUSPENDED", 2).statusCode(200);
        status(ana, id, "ACTIVE", 3).statusCode(200);
        status(ana, id, "ENDED", 4).statusCode(200).body("status", equalTo("ENDED"));
        status(ana, id, "ACTIVE", 5).statusCode(409).body("code", equalTo("INVALID_STATUS_TRANSITION"));
        ana.req().body(update(5)).put("/api/families/{f}/treatments/{t}", family, id).then().statusCode(409)
                .body("code", equalTo("TREATMENT_ENDED"));
    }

    @Test
    void activeTreatmentChangesCannotApplyToThePast() {
        String id = create();
        status(ana, id, "ACTIVE", 1).statusCode(200);
        Map<String, Object> change = update(2);
        change.put("prescribedDose", "10 ml");
        change.put("effectiveFrom", Instant.now().minus(1, ChronoUnit.DAYS).toString());
        ana.req().body(change).put("/api/families/{f}/treatments/{t}", family, id).then().statusCode(422)
                .body("code", equalTo("EFFECTIVE_FROM_IN_PAST"));
    }

    @Test
    void validatesPeriodAndPerson() {
        Map<String, Object> body = create(gabriel);
        body.put("endAt", START.minus(1, ChronoUnit.DAYS).toString());
        ana.req().body(body).post("/api/families/{f}/treatments", family).then().statusCode(422)
                .body("code", equalTo("INVALID_PERIOD"));

        User eve = Api.newUser("Eve");
        UUID otherFamily = Api.createFamily(eve, "Outra");
        eve.req().body(create(gabriel)).post("/api/families/{f}/treatments", otherFamily).then().statusCode(422)
                .body("code", equalTo("PERSON_NOT_FOUND"));

        Map<String, Object> noDose = create(gabriel);
        noDose.remove("prescribedDose");
        ana.req().body(noDose).post("/api/families/{f}/treatments", family).then().statusCode(400);
    }

    @Test
    void outsidersCannotReadOrChangeTreatments() {
        String id = create();
        User eve = Api.newUser("Eve");
        eve.req().get("/api/families/{f}/treatments/{t}", family, id).then().statusCode(404);
        eve.req().get("/api/families/{f}/treatments", family).then().statusCode(404);
        status(eve, id, "ACTIVE", 1).statusCode(404);
    }

    @Test
    void outboxEventsCarryNoHealthData() {
        String id = create();
        status(ana, id, "ACTIVE", 1).statusCode(200);

        List<OutboxEvent> events = QuarkusTransaction.requiringNew().call(() -> OutboxEvent
                .<OutboxEvent>list("aggregateId = ?1 order by createdAt", UUID.fromString(id)));
        assertEquals(List.of("TREATMENT_CREATED", "TREATMENT_STATUS_CHANGED"),
                events.stream().map(e -> e.eventType).toList());
        events.forEach(e -> {
            assertEquals(OutboxEvent.Status.PENDING, e.status);
            assertFalse(e.payload.containsKey("prescribedDose"));
            assertFalse(e.payload.containsKey("name"));
        });
    }

    private String create() {
        return ana.req().body(create(gabriel)).post("/api/families/{f}/treatments", family)
                .then().statusCode(201).extract().path("id");
    }

    private Map<String, Object> create(String personId) {
        Map<String, Object> body = new HashMap<>();
        body.put("personId", personId);
        body.put("name", "Medicamento A");
        body.put("kind", "CONTINUOUS");
        body.put("prescribedDose", "5 ml");
        body.put("route", "oral");
        body.put("instructions", "Conforme prescrição");
        body.put("startAt", START.toString());
        return body;
    }

    private Map<String, Object> update(long baseVersion) {
        Map<String, Object> body = create(gabriel);
        body.remove("personId");
        body.put("baseVersion", baseVersion);
        body.put("effectiveFrom", Instant.now().toString());
        return body;
    }

    private io.restassured.response.ValidatableResponse status(User user, String id, String status,
            long baseVersion) {
        return user.req().body(Map.of("status", status, "baseVersion", baseVersion))
                .post("/api/families/{f}/treatments/{t}/status", family, id).then();
    }
}
