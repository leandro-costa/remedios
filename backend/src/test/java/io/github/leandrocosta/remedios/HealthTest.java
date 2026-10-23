package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

import io.github.leandrocosta.remedios.Api.User;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.RestAssured;
import io.restassured.config.JsonConfig;
import io.restassured.config.RestAssuredConfig;
import io.restassured.path.json.config.JsonPathConfig;
import io.restassured.response.ValidatableResponse;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Aferições, sintomas e linhas de referência. */
@QuarkusTest
class HealthTest {

    Dosing d;
    RestAssuredConfig previous;

    @BeforeEach
    void setUp() {
        // Decimais do JSON como Double, para comparar valores medidos.
        previous = RestAssured.config();
        RestAssured.config = previous.jsonConfig(JsonConfig.jsonConfig()
                .numberReturnType(JsonPathConfig.NumberReturnType.DOUBLE));
        d = new Dosing();
    }

    @AfterEach
    void tearDown() {
        RestAssured.config = previous;
    }

    @Test
    void temperatureSeriesWithAuthorAndUnit() {
        Instant first = d.now.minus(3, ChronoUnit.HOURS);
        Instant second = d.now.minus(1, ChronoUnit.HOURS);
        measure(d.ana, d.anaDevice, temperature("38.4", first, "AXILLARY")).statusCode(200)
                .body("unit", equalTo("°C"))
                .body("value", closeTo(38.4, 0.001))
                .body("method", equalTo("AXILLARY"))
                .body("recordedBy.displayName", equalTo("Ana"));
        measure(d.bruno, d.brunoDevice, temperature("37.2", second, null)).statusCode(200);

        series("TEMPERATURE").body("value", equalTo(List.of(38.4, 37.2)))
                .body("recordedBy.displayName", equalTo(List.of("Ana", "Bruno")));
        series("HEART_RATE").body("size()", equalTo(0));
    }

    @Test
    void resendingTheSameIdDoesNotDuplicate() {
        Map<String, Object> body = temperature("38.0", d.now, null);
        String id = measure(d.ana, d.anaDevice, body).statusCode(200).extract().path("id");
        measure(d.ana, d.anaDevice, body).statusCode(200).body("id", equalTo(id));
        series("TEMPERATURE").body("size()", equalTo(1));
        // O mesmo id vindo de outra pessoa é recusado.
        measure(d.bruno, d.brunoDevice, body).statusCode(409).body("code", equalTo("ID_IN_USE"));
    }

    @Test
    void allTypesWithTheirUnits() {
        measure(d.ana, d.anaDevice, body("HEART_RATE", "92", null, d.now)).statusCode(200).body("unit", equalTo("bpm"));
        measure(d.ana, d.anaDevice, body("BLOOD_PRESSURE", "120", "80", d.now)).statusCode(200)
                .body("unit", equalTo("mmHg")).body("value2", closeTo(80, 0.001));
        measure(d.ana, d.anaDevice, body("OXYGEN_SATURATION", "97", null, d.now)).statusCode(200)
                .body("unit", equalTo("%"));
        Map<String, Object> glucose = body("BLOOD_GLUCOSE", "105", null, d.now);
        glucose.put("method", "FASTING");
        measure(d.ana, d.anaDevice, glucose).statusCode(200).body("unit", equalTo("mg/dL"));
        measure(d.ana, d.anaDevice, body("WEIGHT", "18.6", null, d.now)).statusCode(200).body("unit", equalTo("kg"));
        Map<String, Object> other = body("OTHER", "3", null, d.now);
        other.put("label", "Evacuações no dia");
        other.put("unit", "vezes");
        measure(d.ana, d.anaDevice, other).statusCode(200).body("unit", equalTo("vezes"))
                .body("label", equalTo("Evacuações no dia"));
    }

    @Test
    void typingMistakesAreCaught() {
        measure(d.ana, d.anaDevice, temperature("380", d.now, null)).statusCode(422)
                .body("code", equalTo("INVALID_MEASUREMENT"));
        measure(d.ana, d.anaDevice, body("BLOOD_PRESSURE", "80", "120", d.now)).statusCode(422);
        measure(d.ana, d.anaDevice, body("BLOOD_PRESSURE", "120", null, d.now)).statusCode(422);
        measure(d.ana, d.anaDevice, body("HEART_RATE", "80", "10", d.now)).statusCode(422);
        measure(d.ana, d.anaDevice, temperature("38", d.now.plus(1, ChronoUnit.HOURS), null)).statusCode(422);
        measure(d.ana, d.anaDevice, temperature("38", d.now, "NO_BOLSO")).statusCode(422);
        measure(d.ana, d.anaDevice, body("OTHER", "3", null, d.now)).statusCode(422);
        measure(d.ana, UUID.randomUUID(), temperature("38", d.now, null)).statusCode(422)
                .body("code", equalTo("DEVICE_NOT_REGISTERED"));
    }

    @Test
    void correctionKeepsTheOriginal() {
        String id = measure(d.ana, d.anaDevice, temperature("39.8", d.now, null)).statusCode(200)
                .extract().path("id");
        Map<String, Object> fix = new HashMap<>(Map.of("deviceId", d.brunoDevice, "value", "38.9",
                "measuredAt", d.now.toString(), "reason", "Digitei errado"));
        String fixed = d.bruno.req().body(fix).post("/api/families/{f}/measurements/{m}/correction", d.family, id)
                .then().statusCode(200)
                .body("value", closeTo(38.9, 0.001))
                .body("replacesId", equalTo(id))
                .body("recordedBy.displayName", equalTo("Bruno"))
                .extract().path("id");

        series("TEMPERATURE").body("id", equalTo(List.of(fixed)));
        d.ana.req().get("/api/families/{f}/measurements/{m}", d.family, id).then().statusCode(200)
                .body("voidedAt", notNullValue())
                .body("voidReason", equalTo("Digitei errado"))
                .body("voidedBy.displayName", equalTo("Bruno"));
        d.bruno.req().body(fix).post("/api/families/{f}/measurements/{m}/correction", d.family, id)
                .then().statusCode(409).body("code", equalTo("ALREADY_VOIDED"));
    }

    @Test
    void discardRequiresReason() {
        String id = measure(d.ana, d.anaDevice, temperature("37", d.now, null)).statusCode(200).extract().path("id");
        d.ana.req().body(Map.of("reason", " ")).post("/api/families/{f}/measurements/{m}/void", d.family, id)
                .then().statusCode(400);
        d.ana.req().body(Map.of("reason", "Pessoa errada")).post("/api/families/{f}/measurements/{m}/void", d.family, id)
                .then().statusCode(204);
        series("TEMPERATURE").body("size()", equalTo(0));
    }

    @Test
    void symptomsInProgressAndPossibleReaction() {
        String treatment = d.createTreatment(Dosing.dailyAt(d.now.plus(1, ChronoUnit.HOURS)));
        Map<String, Object> rash = new HashMap<>(Map.of("id", UUID.randomUUID(), "deviceId", d.anaDevice,
                "description", "Manchas vermelhas na pele", "intensity", "MILD",
                "startedAt", d.now.minus(2, ChronoUnit.HOURS).toString(), "treatmentId", treatment));
        String id = d.ana.req().body(rash).post("/api/families/{f}/persons/{p}/symptoms", d.family, d.person).then()
                .statusCode(200)
                .body("endedAt", nullValue())
                .body("treatmentId", equalTo(treatment))
                .body("version", equalTo(1))
                .extract().path("id");

        // Terminou: Bruno registra o fim, com a versão que viu.
        Map<String, Object> ended = new HashMap<>(rash);
        ended.remove("id");
        ended.remove("deviceId");
        ended.put("baseVersion", 1);
        ended.put("endedAt", d.now.toString());
        d.bruno.req().body(ended).put("/api/families/{f}/symptoms/{s}", d.family, id).then().statusCode(200)
                .body("endedAt", equalTo(d.now.toString()))
                .body("updatedBy.displayName", equalTo("Bruno"))
                .body("version", equalTo(2));
        d.ana.req().body(ended).put("/api/families/{f}/symptoms/{s}", d.family, id).then().statusCode(409)
                .body("code", equalTo("STALE_VERSION"));

        // Aparece no período em que esteve presente, não depois.
        symptoms(d.now.minus(1, ChronoUnit.HOURS), d.now.plus(1, ChronoUnit.HOURS)).body("id", equalTo(List.of(id)));
        symptoms(d.now.plus(1, ChronoUnit.MINUTES), d.now.plus(2, ChronoUnit.HOURS)).body("size()", equalTo(0));
    }

    @Test
    void symptomValidation() {
        Map<String, Object> s = new HashMap<>(Map.of("id", UUID.randomUUID(), "deviceId", d.anaDevice,
                "description", "Tosse", "startedAt", d.now.toString(), "endedAt",
                d.now.minus(1, ChronoUnit.HOURS).toString()));
        d.ana.req().body(s).post("/api/families/{f}/persons/{p}/symptoms", d.family, d.person).then()
                .statusCode(422).body("code", equalTo("INVALID_SYMPTOM"));
        s.remove("endedAt");
        s.put("treatmentId", UUID.randomUUID());
        d.ana.req().body(s).post("/api/families/{f}/persons/{p}/symptoms", d.family, d.person).then()
                .statusCode(422);
    }

    @Test
    void referenceLinesPerFamilyAndPerson() {
        save(Map.of("type", "TEMPERATURE", "value", "37.8", "label", "Orientação do pediatra")).statusCode(200)
                .body("personId", nullValue());
        save(Map.of("type", "TEMPERATURE", "value", "38.0", "label", "Clínico", "personId", d.person))
                .statusCode(200).body("personId", equalTo(d.person));
        // Salvar de novo substitui, sem duplicar.
        save(Map.of("type", "TEMPERATURE", "value", "37.5", "label", "Nova orientação")).statusCode(200);
        save(Map.of("type", "BLOOD_PRESSURE", "value", "140", "value2", "90", "label", "Cardiologista"))
                .statusCode(200);

        d.bruno.req().get("/api/families/{f}/reference-lines", d.family).then().statusCode(200)
                .body("size()", equalTo(3))
                .body("find { it.personId == null && it.type == 'TEMPERATURE' }.value", closeTo(37.5, 0.001));

        save(Map.of("type", "TEMPERATURE", "value", "80", "label", "x")).statusCode(422);
        save(Map.of("type", "HEART_RATE", "value", "100", "value2", "60", "label", "x")).statusCode(422);
        save(Map.of("type", "OTHER", "value", "1", "label", "x")).statusCode(422);
    }

    @Test
    void outsidersCannotSeeHealthData() {
        measure(d.ana, d.anaDevice, temperature("38", d.now, null)).statusCode(200);
        User eve = Api.newUser("Eve");
        eve.req().queryParam("from", d.now.minus(1, ChronoUnit.DAYS).toString())
                .queryParam("to", d.now.plus(1, ChronoUnit.DAYS).toString())
                .get("/api/families/{f}/persons/{p}/measurements", d.family, d.person).then().statusCode(404);
        eve.req().get("/api/families/{f}/reference-lines", d.family).then().statusCode(404);
    }

    private ValidatableResponse measure(User user, UUID device, Map<String, Object> body) {
        Map<String, Object> b = new HashMap<>(body);
        b.putIfAbsent("id", UUID.randomUUID());
        b.put("deviceId", device);
        return user.req().body(b).post("/api/families/{f}/persons/{p}/measurements", d.family, d.person).then();
    }

    private ValidatableResponse series(String type) {
        return d.ana.req().queryParam("type", type)
                .queryParam("from", d.now.minus(1, ChronoUnit.DAYS).toString())
                .queryParam("to", d.now.plus(1, ChronoUnit.DAYS).toString())
                .get("/api/families/{f}/persons/{p}/measurements", d.family, d.person).then().statusCode(200);
    }

    private ValidatableResponse symptoms(Instant from, Instant to) {
        return d.ana.req().queryParam("from", from.toString()).queryParam("to", to.toString())
                .get("/api/families/{f}/persons/{p}/symptoms", d.family, d.person).then().statusCode(200);
    }

    private ValidatableResponse save(Map<String, Object> body) {
        return d.ana.req().body(body).put("/api/families/{f}/reference-lines", d.family).then();
    }

    private static Map<String, Object> temperature(String value, Instant at, String method) {
        Map<String, Object> b = body("TEMPERATURE", value, null, at);
        b.put("method", method);
        b.put("id", UUID.randomUUID());
        return b;
    }

    private static Map<String, Object> body(String type, String value, String value2, Instant at) {
        Map<String, Object> b = new HashMap<>();
        b.put("type", type);
        b.put("value", value);
        b.put("value2", value2);
        b.put("measuredAt", at.toString());
        return b;
    }
}
