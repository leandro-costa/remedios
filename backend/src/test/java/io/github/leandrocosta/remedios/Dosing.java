package io.github.leandrocosta.remedios;

import io.github.leandrocosta.remedios.Api.User;
import io.restassured.path.json.JsonPath;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Cenário de testes: família com uma pessoa e um tratamento com agenda diária em UTC. */
public final class Dosing {

    public final User ana = Api.newUser("Ana");
    public final User bruno = Api.newUser("Bruno");
    public final UUID family;
    public final String person;
    public final UUID anaDevice = UUID.randomUUID();
    public final UUID brunoDevice = UUID.randomUUID();
    /** Instante de referência, sem segundos. */
    public final Instant now = Instant.now().truncatedTo(ChronoUnit.MINUTES);

    public Dosing() {
        family = Api.createFamily(ana, "Família");
        Api.join(family, ana, bruno);
        person = ana.req().body(PersonTest.person("Gabriel", null, null)).post("/api/families/{f}/persons", family)
                .then().statusCode(201).extract().path("id");
        registerDevice(ana, anaDevice);
        registerDevice(bruno, brunoDevice);
    }

    public static void registerDevice(User user, UUID id) {
        user.req().body(Map.of("platform", "ANDROID", "name", "Celular de " + user.name()))
                .put("/api/me/devices/{d}", id).then().statusCode(200);
    }

    /** Regra DAILY em UTC com doses nos horários de {@code instants}. */
    public static Map<String, Object> dailyAt(Instant... instants) {
        Map<String, Object> rule = new HashMap<>();
        rule.put("type", "DAILY");
        rule.put("timezone", "UTC");
        rule.put("times", List.of(instants).stream()
                .map(i -> i.atOffset(ZoneOffset.UTC).toLocalTime().truncatedTo(ChronoUnit.MINUTES).toString())
                .toList());
        return rule;
    }

    /** Cria o tratamento (rascunho) com início há 2 dias. */
    public String createTreatment(Map<String, Object> schedule) {
        Map<String, Object> body = new HashMap<>();
        body.put("personId", person);
        body.put("name", "Medicamento A");
        body.put("kind", "CONTINUOUS");
        body.put("prescribedDose", "5 ml");
        body.put("startAt", now.minus(2, ChronoUnit.DAYS).toString());
        body.put("schedule", schedule);
        return ana.req().body(body).post("/api/families/{f}/treatments", family)
                .then().statusCode(201).extract().path("id");
    }

    /** Ativa com a agenda valendo desde {@code effectiveFrom}. */
    public void activate(String treatment, long baseVersion, Instant effectiveFrom) {
        ana.req().body(Map.of("status", "ACTIVE", "baseVersion", baseVersion, "effectiveFrom",
                effectiveFrom.toString()))
                .post("/api/families/{f}/treatments/{t}/status", family, treatment).then().statusCode(200);
    }

    public JsonPath agenda(Instant from, Instant to) {
        return ana.req().queryParam("from", from.toString()).queryParam("to", to.toString())
                .get("/api/families/{f}/occurrences", family).then().statusCode(200).extract().jsonPath();
    }

    /** Id da dose prevista exatamente em {@code at}. */
    public String occurrenceAt(Instant at) {
        List<Map<String, Object>> list = agenda(at.minus(1, ChronoUnit.MINUTES), at.plus(1, ChronoUnit.MINUTES))
                .getList("$");
        if (list.size() != 1) {
            throw new AssertionError("Esperava 1 dose em " + at + ", veio " + list.size());
        }
        return (String) list.getFirst().get("id");
    }
}
