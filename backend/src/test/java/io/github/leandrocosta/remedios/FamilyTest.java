package io.github.leandrocosta.remedios;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.leandrocosta.remedios.Api.User;
import io.github.leandrocosta.remedios.audit.AuditEvent;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

@QuarkusTest
class FamilyTest {

    @Test
    void requiresAuthentication() {
        given().get("/api/families").then().statusCode(401);
    }

    @Test
    void provisionsAccountOnFirstAccess() {
        User ana = Api.newUser("Ana");
        ana.req().get("/api/me").then().statusCode(200)
                .body("displayName", equalTo("Ana"))
                .body("id", notNullValue());
        ana.req().body(Map.of("displayName", "Ana Paula")).put("/api/me").then().statusCode(200)
                .body("displayName", equalTo("Ana Paula"));
    }

    @Test
    void creatorBecomesAdminWithDefaultSettings() {
        User ana = Api.newUser("Ana");
        UUID family = Api.createFamily(ana, "Família Silva");

        ana.req().get("/api/families").then().statusCode(200)
                .body("name", hasSize(1))
                .body("[0].myRole", equalTo("ADMIN"));
        ana.req().get("/api/families/{f}/settings", family).then().statusCode(200)
                .body("reminderBeforeMinutes", equalTo(10))
                .body("repeatIntervalMinutes", equalTo(15))
                .body("confirmationPolicy", equalTo("IMPORTANT_ONLY"))
                .body("version", equalTo(1));
    }

    @Test
    void outsidersCannotSeeFamily() {
        User ana = Api.newUser("Ana");
        User eve = Api.newUser("Eve");
        UUID family = Api.createFamily(ana, "Família");

        eve.req().get("/api/families/{f}", family).then().statusCode(404);
        eve.req().get("/api/families/{f}/members", family).then().statusCode(404);
        eve.req().get("/api/families/{f}/persons", family).then().statusCode(404);
        eve.req().body(Map.of()).post("/api/families/{f}/invitations", family).then().statusCode(404);
    }

    @Test
    void invitationFlow() {
        User ana = Api.newUser("Ana");
        User bruno = Api.newUser("Bruno");
        User carla = Api.newUser("Carla");
        UUID family = Api.createFamily(ana, "Família");

        String code = ana.req().body(Map.of()).post("/api/families/{f}/invitations", family)
                .then().statusCode(201).body("role", equalTo("MEMBER")).extract().path("code");
        ana.req().get("/api/families/{f}/invitations", family).then().statusCode(200).body("id", hasSize(1));

        bruno.req().body(Map.of("code", code)).post("/api/invitations/accept").then().statusCode(200)
                .body("familyId", equalTo(family.toString()))
                .body("role", equalTo("MEMBER"));

        // Convite de uso único.
        carla.req().body(Map.of("code", code)).post("/api/invitations/accept").then().statusCode(404);
        ana.req().get("/api/families/{f}/invitations", family).then().statusCode(200).body("id", hasSize(0));

        ana.req().get("/api/families/{f}/members", family).then().statusCode(200)
                .body("displayName", containsInAnyOrder("Ana", "Bruno"));

        // Membro comum não administra convites nem padrões.
        bruno.req().body(Map.of()).post("/api/families/{f}/invitations", family).then().statusCode(403);
        bruno.req().body(settings(1)).put("/api/families/{f}/settings", family).then().statusCode(403);
    }

    @Test
    void revokedInvitationCannotBeUsed() {
        User ana = Api.newUser("Ana");
        User bruno = Api.newUser("Bruno");
        UUID family = Api.createFamily(ana, "Família");
        var issued = ana.req().body(Map.of("role", "ADMIN")).post("/api/families/{f}/invitations", family)
                .then().statusCode(201).extract();

        ana.req().delete("/api/families/{f}/invitations/{i}", family, issued.path("id")).then().statusCode(204);
        bruno.req().body(Map.of("code", issued.path("code"))).post("/api/invitations/accept").then()
                .statusCode(404);
    }

    @Test
    void familyKeepsAtLeastOneAdmin() {
        User ana = Api.newUser("Ana");
        User bruno = Api.newUser("Bruno");
        UUID family = Api.createFamily(ana, "Família");
        Api.join(family, ana, bruno);

        ana.req().delete("/api/families/{f}/members/{u}", family, ana.id()).then().statusCode(409)
                .body("code", equalTo("LAST_ADMIN"));
        ana.req().body(Map.of("role", "MEMBER")).put("/api/families/{f}/members/{u}/role", family, ana.id())
                .then().statusCode(409).body("code", equalTo("LAST_ADMIN"));

        ana.req().body(Map.of("role", "ADMIN")).put("/api/families/{f}/members/{u}/role", family, bruno.id())
                .then().statusCode(200).body("role", equalTo("ADMIN"));
        ana.req().delete("/api/families/{f}/members/{u}", family, ana.id()).then().statusCode(204);

        // Quem saiu perde o acesso imediatamente.
        ana.req().get("/api/families/{f}", family).then().statusCode(404);
        bruno.req().get("/api/families/{f}/members", family).then().statusCode(200)
                .body("displayName", containsInAnyOrder("Bruno"));
    }

    @Test
    void memberCanLeaveButNotRemoveOthers() {
        User ana = Api.newUser("Ana");
        User bruno = Api.newUser("Bruno");
        User carla = Api.newUser("Carla");
        UUID family = Api.createFamily(ana, "Família");
        Api.join(family, ana, bruno);
        Api.join(family, ana, carla);

        bruno.req().delete("/api/families/{f}/members/{u}", family, carla.id()).then().statusCode(403);
        bruno.req().delete("/api/families/{f}/members/{u}", family, bruno.id()).then().statusCode(204);

        // Pode voltar com novo convite.
        Api.join(family, ana, bruno);
        bruno.req().get("/api/families/{f}", family).then().statusCode(200).body("myRole", equalTo("MEMBER"));
    }

    @Test
    void settingsUseOptimisticVersion() {
        User ana = Api.newUser("Ana");
        UUID family = Api.createFamily(ana, "Família");

        ana.req().body(settings(1)).put("/api/families/{f}/settings", family).then().statusCode(200)
                .body("reminderBeforeMinutes", equalTo(5))
                .body("version", equalTo(2));
        ana.req().body(settings(1)).put("/api/families/{f}/settings", family).then().statusCode(409)
                .body("code", equalTo("STALE_VERSION"))
                .body("details.currentVersion", equalTo(2));
    }

    @Test
    void changesAreAudited() {
        User ana = Api.newUser("Ana");
        User bruno = Api.newUser("Bruno");
        UUID family = Api.createFamily(ana, "Família");
        Api.join(family, ana, bruno);

        List<String> events = QuarkusTransaction.requiringNew().call(() -> AuditEvent
                .<AuditEvent>list("familyId", family).stream()
                .map(e -> e.eventType).sorted().toList());
        assertEquals(List.of("FAMILY_CREATED", "INVITATION_CREATED", "MEMBER_JOINED", "MEMBER_JOINED"), events);
    }

    private static Map<String, Object> settings(long baseVersion) {
        return Map.of("reminderBeforeMinutes", 5, "repeatIntervalMinutes", 15, "repeatLimit", 3,
                "lateToleranceMinutes", 30, "confirmationPolicy", "IMPORTANT_ONLY", "baseVersion", baseVersion);
    }
}
