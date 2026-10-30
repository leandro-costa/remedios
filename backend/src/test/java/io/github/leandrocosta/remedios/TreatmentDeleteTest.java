package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Tratamento cadastrado por engano: some de tudo, mas nada é apagado. */
@QuarkusTest
class TreatmentDeleteTest {

    Dosing d;
    String treatment;
    String given;

    @BeforeEach
    void setUp() {
        d = new Dosing();
        Instant past = d.now.minus(1, ChronoUnit.HOURS);
        treatment = d.createTreatment(Dosing.dailyAt(past));
        d.activate(treatment, 1, d.now.minus(1, ChronoUnit.DAYS));
        given = d.occurrenceAt(past);
        d.ana.req().body(Map.of("deviceId", d.anaDevice.toString()))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, given).then().statusCode(200);
        // Encerrado: ainda assim pode ser excluído.
        d.ana.req().body(Map.of("status", "ENDED", "baseVersion", 2, "effectiveFrom", Instant.now().toString()))
                .post("/api/families/{f}/treatments/{t}/status", d.family, treatment).then().statusCode(200);
    }

    private io.restassured.response.ValidatableResponse delete(Api.User who, long baseVersion) {
        return who.req().body(Map.of("baseVersion", baseVersion, "reason", "Cadastrado na pessoa errada"))
                .post("/api/families/{f}/treatments/{t}/deletion", d.family, treatment).then();
    }

    @Test
    void onlyAdminsWithTheCurrentVersion() {
        delete(d.bruno, 3).statusCode(403);
        delete(d.ana, 2).statusCode(409);
        d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, treatment).then().statusCode(200);
    }

    @Test
    void disappearsFromListsHistoryAndCountsButStaysInTheAudit() {
        delete(d.ana, 3).statusCode(204);

        d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, treatment).then().statusCode(404);
        d.ana.req().get("/api/families/{f}/treatments", d.family).then().body("size()", equalTo(0));
        d.ana.req().get("/api/families/{f}/treatments/progress", d.family).then().body("size()", equalTo(0));
        d.ana.req().get("/api/families/{f}/occurrences/{o}", d.family, given).then().statusCode(404);
        assertEquals(0, d.agenda(d.now.minus(2, ChronoUnit.DAYS), d.now.plus(2, ChronoUnit.DAYS)).getList("$").size());
        List<?> history = d.ana.req().queryParam("from", d.now.minus(2, ChronoUnit.DAYS).toString())
                .queryParam("to", d.now.plus(1, ChronoUnit.HOURS).toString())
                .get("/api/families/{f}/history", d.family).then().statusCode(200).extract().jsonPath().getList("$");
        assertEquals(0, history.size());
        // Nada mais pode ser feito com ele.
        d.ana.req().body(Map.of("deviceId", d.anaDevice.toString()))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, given).then().statusCode(404);
        delete(d.ana, 3).statusCode(404);
        // A exportação da família continua com tudo (nada foi apagado).
        d.ana.req().get("/api/families/{f}/export", d.family).then().statusCode(200)
                .body("treatments[0].deleteReason", equalTo("Cadastrado na pessoa errada"));
    }
}
