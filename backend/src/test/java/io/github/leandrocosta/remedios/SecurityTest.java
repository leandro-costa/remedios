package io.github.leandrocosta.remedios;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.leandrocosta.remedios.Api.User;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Revisão de segurança (fase 5): matriz de autorização de todas as rotas.
 * Quem não participa da família não vê nem altera nada dela (e não descobre
 * se existe); membro comum não faz ações de administrador; sem token, nada.
 */
@QuarkusTest
class SecurityTest {

    private record Route(String method, String path, Map<String, Object> body) {

        Response call(RequestSpecification spec) {
            RequestSpecification r = body == null ? spec : spec.body(body);
            return switch (method) {
                case "GET" -> r.get(path);
                case "POST" -> r.post(path);
                case "PUT" -> r.put(path);
                case "DELETE" -> r.delete(path);
                default -> throw new IllegalArgumentException(method);
            };
        }

        @Override
        public String toString() {
            return method + " " + path;
        }
    }

    Dosing d;
    String f;
    String treatment;
    String dose;
    String measurement;
    String symptom;
    String line;
    String reminder;
    String invitation;

    @BeforeEach
    void setUp() {
        d = new Dosing();
        f = "/api/families/" + d.family;
        Instant pastAt = d.now.minus(1, ChronoUnit.HOURS);
        treatment = d.createTreatment(Dosing.dailyAt(pastAt));
        d.activate(treatment, 1, d.now.minus(2, ChronoUnit.HOURS));
        dose = d.occurrenceAt(pastAt);
        measurement = d.ana.req().body(Map.of("id", UUID.randomUUID(), "deviceId", d.anaDevice, "type", "TEMPERATURE",
                "value", "38.2", "measuredAt", d.now.minus(10, ChronoUnit.MINUTES).toString()))
                .post(f + "/persons/{p}/measurements", d.person).then().statusCode(200).extract().path("id");
        symptom = d.ana.req().body(Map.of("id", UUID.randomUUID(), "deviceId", d.anaDevice, "description", "Tosse",
                "startedAt", d.now.minus(2, ChronoUnit.HOURS).toString()))
                .post(f + "/persons/{p}/symptoms", d.person).then().statusCode(200).extract().path("id");
        line = d.ana.req().body(Map.of("type", "TEMPERATURE", "value", "37.8", "label", "Pediatra"))
                .put(f + "/reference-lines").then().statusCode(200).extract().path("id");
        reminder = d.ana.req().body(Map.of("message", "Medir de novo", "remindAt", d.now.plus(2, ChronoUnit.HOURS).toString()))
                .post(f + "/persons/{p}/reminders", d.person).then().statusCode(200).extract().path("id");
        invitation = d.ana.req().body(Map.of()).post(f + "/invitations").then().statusCode(201).extract().path("id");
    }

    private Map<String, Object> treatmentBody() {
        Map<String, Object> b = new HashMap<>();
        b.put("personId", d.person);
        b.put("name", "Invasor");
        b.put("kind", "CONTINUOUS");
        b.put("prescribedDose", "1 ml");
        b.put("startAt", d.now.toString());
        b.put("baseVersion", 2);
        b.put("effectiveFrom", d.now.toString());
        return b;
    }

    /** Todas as rotas que tocam dados de uma família, com corpos válidos. */
    private List<Route> familyRoutes() {
        String range = "?from=" + d.now.minus(1, ChronoUnit.DAYS) + "&to=" + d.now.plus(1, ChronoUnit.DAYS);
        String p = f + "/persons/" + d.person;
        String t = f + "/treatments/" + treatment;
        String o = f + "/occurrences/" + dose;
        Map<String, Object> device = Map.of("deviceId", d.anaDevice);
        List<Route> r = new ArrayList<>();
        r.add(new Route("GET", f, null));
        r.add(new Route("PUT", f, Map.of("name", "Invadida")));
        r.add(new Route("GET", f + "/members", null));
        r.add(new Route("PUT", f + "/members/" + d.ana.id() + "/role", Map.of("role", "MEMBER")));
        r.add(new Route("DELETE", f + "/members/" + d.ana.id(), null));
        r.add(new Route("GET", f + "/invitations", null));
        r.add(new Route("POST", f + "/invitations", Map.of()));
        r.add(new Route("DELETE", f + "/invitations/" + invitation, null));
        r.add(new Route("GET", f + "/export", null));
        r.add(new Route("GET", f + "/settings", null));
        r.add(new Route("PUT", f + "/settings", Map.of("reminderBeforeMinutes", 5, "repeatIntervalMinutes", 15,
                "repeatLimit", 4, "lateToleranceMinutes", 30, "confirmationPolicy", "ALL", "baseVersion", 1)));
        r.add(new Route("GET", f + "/persons", null));
        r.add(new Route("POST", f + "/persons", Map.of("displayName", "Intruso")));
        r.add(new Route("GET", p, null));
        r.add(new Route("PUT", p, Map.of("displayName", "Renomeado")));
        r.add(new Route("GET", f + "/treatments", null));
        r.add(new Route("POST", f + "/treatments", treatmentBody()));
        r.add(new Route("GET", t, null));
        r.add(new Route("PUT", t, treatmentBody()));
        r.add(new Route("POST", t + "/status", Map.of("status", "ENDED", "baseVersion", 2)));
        r.add(new Route("GET", t + "/revisions", null));
        r.add(new Route("GET", f + "/treatments/conflicts", null));
        r.add(new Route("POST", t + "/conflict/resolution", Map.of("conflictId", UUID.randomUUID(),
                "choice", "KEEP_CURRENT", "baseVersion", 2, "reason", "x")));
        r.add(new Route("GET", f + "/occurrences" + range, null));
        r.add(new Route("GET", o, null));
        r.add(new Route("POST", o + "/administration", device));
        r.add(new Route("POST", o + "/not-administered", device));
        r.add(new Route("POST", o + "/correction", Map.of("baseVersion", 1, "status", "OPEN", "reason", "x")));
        r.add(new Route("POST", o + "/claim", null));
        r.add(new Route("DELETE", o + "/claim", null));
        r.add(new Route("POST", o + "/resolution", Map.of("baseVersion", 1, "status", "NOT_ADMINISTERED", "reason", "x")));
        r.add(new Route("GET", f + "/conflicts", null));
        r.add(new Route("GET", f + "/history" + range, null));
        r.add(new Route("GET", p + "/measurements" + range, null));
        r.add(new Route("POST", p + "/measurements", Map.of("id", UUID.randomUUID(), "deviceId", d.anaDevice,
                "type", "TEMPERATURE", "value", "39", "measuredAt", d.now.toString())));
        r.add(new Route("GET", f + "/measurements/" + measurement, null));
        r.add(new Route("POST", f + "/measurements/" + measurement + "/correction", Map.of("deviceId", d.anaDevice,
                "value", "36", "measuredAt", d.now.toString(), "reason", "x")));
        r.add(new Route("POST", f + "/measurements/" + measurement + "/void", Map.of("reason", "x")));
        r.add(new Route("GET", p + "/symptoms" + range, null));
        r.add(new Route("POST", p + "/symptoms", Map.of("id", UUID.randomUUID(), "deviceId", d.anaDevice,
                "description", "Febre", "startedAt", d.now.toString())));
        r.add(new Route("PUT", f + "/symptoms/" + symptom, Map.of("baseVersion", 1, "description", "Tosse forte",
                "startedAt", d.now.minus(2, ChronoUnit.HOURS).toString())));
        r.add(new Route("POST", f + "/symptoms/" + symptom + "/void", Map.of("reason", "x")));
        r.add(new Route("GET", f + "/reference-lines", null));
        r.add(new Route("PUT", f + "/reference-lines", Map.of("type", "TEMPERATURE", "value", "39", "label", "x")));
        r.add(new Route("DELETE", f + "/reference-lines/" + line, null));
        r.add(new Route("GET", p + "/reminders", null));
        r.add(new Route("POST", p + "/reminders", Map.of("message", "x", "remindAt", d.now.plus(1, ChronoUnit.HOURS).toString())));
        r.add(new Route("DELETE", f + "/reminders/" + reminder, null));
        return r;
    }

    @Test
    void quemNaoParticipaDaFamiliaRecebe404EmTodaRotaENadaMuda() {
        User eve = Api.newUser("Eve");
        Api.createFamily(eve, "Outra família");
        Dosing.registerDevice(eve, UUID.randomUUID());
        String before = snapshot();

        List<String> problems = new ArrayList<>();
        for (Route route : familyRoutes()) {
            int status = route.call(eve.req()).statusCode();
            // 404 sempre; 400 só se o corpo for recusado antes de chegar à família (não revela nada).
            if (status != 404 && !(status == 400 && route.body() != null)) {
                problems.add(route + " → " + status);
            }
        }
        assertEquals(List.of(), problems);
        assertEquals(before, snapshot(), "nada pode ter mudado na família");
    }

    @Test
    void semTokenOuComTokenInvalidoNadaPassa() {
        List<Route> routes = new ArrayList<>(familyRoutes());
        routes.add(new Route("GET", "/api/me", null));
        routes.add(new Route("GET", "/api/families", null));
        routes.add(new Route("POST", "/api/families", Map.of("name", "x")));
        routes.add(new Route("POST", "/api/invitations/accept", Map.of("code", "x")));
        routes.add(new Route("GET", "/api/me/devices", null));
        routes.add(new Route("PUT", "/api/me/notification-settings", Map.of()));
        routes.add(new Route("POST", "/api/me/push/test", null));

        String otherProject = Api.firebaseToken("abc", "Eve").audience("outro-projeto").sign();
        long now = System.currentTimeMillis() / 1000;
        String expired = Api.firebaseToken("abc", "Eve").issuedAt(now - 7200).expiresAt(now - 3600).sign();
        List<String> problems = new ArrayList<>();
        for (Route route : routes) {
            for (RequestSpecification spec : List.of(given().contentType(ContentType.JSON),
                    given().auth().oauth2(otherProject).contentType(ContentType.JSON),
                    given().auth().oauth2(expired).contentType(ContentType.JSON),
                    given().auth().oauth2("nao.e.jwt").contentType(ContentType.JSON))) {
                int status = route.call(spec).statusCode();
                if (status != 401) {
                    problems.add(route + " → " + status);
                }
            }
        }
        assertEquals(List.of(), problems);
    }

    @Test
    void membroComumNaoFazAcoesDeAdministrador() {
        List<Route> admin = List.of(
                new Route("PUT", f, Map.of("name", "Renomeada")),
                new Route("PUT", f + "/members/" + d.ana.id() + "/role", Map.of("role", "MEMBER")),
                new Route("DELETE", f + "/members/" + d.ana.id(), null),
                new Route("GET", f + "/invitations", null),
                new Route("GET", f + "/export", null),
                new Route("POST", f + "/invitations", Map.of()),
                new Route("DELETE", f + "/invitations/" + invitation, null),
                new Route("PUT", f + "/settings", Map.of("reminderBeforeMinutes", 5, "repeatIntervalMinutes", 15,
                        "repeatLimit", 4, "lateToleranceMinutes", 30, "confirmationPolicy", "ALL", "baseVersion", 1)));
        List<String> problems = new ArrayList<>();
        for (Route route : admin) {
            int status = route.call(d.bruno.req()).statusCode();
            if (status != 403) {
                problems.add(route + " → " + status);
            }
        }
        assertEquals(List.of(), problems);
    }

    @Test
    void idsDeOutraFamiliaNaoFuncionamNemDentroDaPropriaFamilia() {
        // Eve tenta usar, na família dela, os ids da família da Ana.
        User eve = Api.newUser("Eve");
        String other = "/api/families/" + Api.createFamily(eve, "Outra família");
        UUID eveDevice = UUID.randomUUID();
        Dosing.registerDevice(eve, eveDevice);
        String range = "?from=" + d.now.minus(1, ChronoUnit.DAYS) + "&to=" + d.now.plus(1, ChronoUnit.DAYS);
        List<Route> routes = List.of(
                new Route("GET", other + "/persons/" + d.person, null),
                new Route("GET", other + "/persons/" + d.person + "/measurements" + range, null),
                new Route("GET", other + "/treatments/" + treatment, null),
                new Route("GET", other + "/occurrences/" + dose, null),
                new Route("POST", other + "/occurrences/" + dose + "/administration", Map.of("deviceId", eveDevice)),
                new Route("GET", other + "/measurements/" + measurement, null),
                new Route("POST", other + "/symptoms/" + symptom + "/void", Map.of("reason", "x")),
                new Route("DELETE", other + "/reference-lines/" + line, null),
                new Route("DELETE", other + "/reminders/" + reminder, null),
                new Route("POST", other + "/treatments", treatmentBody()));
        List<String> problems = new ArrayList<>();
        for (Route route : routes) {
            int status = route.call(eve.req()).statusCode();
            if (!Set.of(404, 422).contains(status)) {
                problems.add(route + " → " + status);
            }
        }
        assertEquals(List.of(), problems);
    }

    @Test
    void aparelhoDeOutraContaNaoPodeSerUsadoNemDesconectado() {
        User eve = Api.newUser("Eve");
        eve.req().delete("/api/me/devices/{d}", d.anaDevice).then().statusCode(404);
        int status = eve.req().body(Map.of("platform", "WEB", "name", "Sequestro"))
                .put("/api/me/devices/{d}", d.anaDevice).statusCode();
        assertEquals(409, status, "o id do aparelho já pertence a outra conta");
        int push = eve.req().body(Map.of("endpoint", "https://push.example.com/x", "p256dh", "x", "auth", "x",
                "timezone", "UTC")).put("/api/me/devices/{d}/push", d.anaDevice).statusCode();
        assertTrue(Set.of(404, 409, 422, 503).contains(push), "push em aparelho alheio: " + push);
        // O aparelho da Ana continua ativo.
        d.ana.req().get("/api/me/devices").then().statusCode(200);
        assertTrue(d.ana.req().get("/api/me/devices").jsonPath().getList("findAll { it.status == 'ACTIVE' }.id")
                .contains(d.anaDevice.toString()));
    }

    /** Estado visível da família, para conferir que nada mudou. */
    private String snapshot() {
        String range = "?from=" + d.now.minus(1, ChronoUnit.DAYS) + "&to=" + d.now.plus(1, ChronoUnit.DAYS);
        return String.join("\n",
                d.ana.req().get(f).asString(),
                d.ana.req().get(f + "/members").asString(),
                d.ana.req().get(f + "/persons").asString(),
                d.ana.req().get(f + "/treatments").asString(),
                d.ana.req().get(f + "/occurrences" + range).asString(),
                d.ana.req().get(f + "/persons/" + d.person + "/measurements" + range).asString(),
                d.ana.req().get(f + "/persons/" + d.person + "/symptoms" + range).asString(),
                d.ana.req().get(f + "/reference-lines").asString(),
                d.ana.req().get(f + "/persons/" + d.person + "/reminders").asString());
    }
}
