package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.leandrocosta.remedios.schedule.ScheduleService;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Doses de um tratamento na tela dele e exclusão de uma dose gerada ou
 * registrada por engano: só administradores, com motivo, nada apagado.
 */
@QuarkusTest
class DoseExclusionTest {

    @Inject
    ScheduleService schedules;

    Dosing d;

    @BeforeEach
    void setUp() {
        d = new Dosing();
    }

    private List<Map<String, Object>> doses(String treatment) {
        return d.ana.req().get("/api/families/{f}/treatments/{t}/occurrences", d.family, treatment)
                .then().statusCode(200).extract().jsonPath().getList("$");
    }

    private static int version(Map<String, Object> o) {
        return ((Number) o.get("version")).intValue();
    }

    @Test
    void listsAllDosesAndExcludesOneWithReasonOnlyForAdmins() {
        Instant past = d.now.minus(3, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(past, d.now.plus(3, ChronoUnit.HOURS)));
        d.activate(t, 1, d.now.minus(2, ChronoUnit.DAYS));

        List<Map<String, Object>> all = doses(t);
        assertTrue(all.size() >= 5, "doses passadas e futuras: " + all.size());
        List<String> times = all.stream().map(o -> (String) o.get("scheduledAt")).toList();
        assertEquals(times.stream().sorted().toList(), times, "em ordem de horário");

        // Dose dada; depois excluída (registrada por engano): o registro é invalidado, não apagado.
        String id = d.occurrenceAt(past);
        d.ana.req().body(Map.of("deviceId", d.anaDevice))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, id).then().statusCode(200);
        Map<String, Object> given = doses(t).stream().filter(o -> id.equals(o.get("id"))).findFirst().orElseThrow();

        // Membro comum não exclui; motivo é obrigatório; versão antiga é recusada.
        d.bruno.req().body(Map.of("baseVersion", version(given), "reason", "engano"))
                .post("/api/families/{f}/occurrences/{o}/exclusion", d.family, id).then().statusCode(403);
        d.ana.req().body(Map.of("baseVersion", version(given), "reason", " "))
                .post("/api/families/{f}/occurrences/{o}/exclusion", d.family, id).then().statusCode(400);
        d.ana.req().body(Map.of("baseVersion", version(given) - 1, "reason", "engano"))
                .post("/api/families/{f}/occurrences/{o}/exclusion", d.family, id).then().statusCode(409);

        d.ana.req().body(Map.of("baseVersion", version(given), "reason", "Dose gerada por engano"))
                .post("/api/families/{f}/occurrences/{o}/exclusion", d.family, id).then().statusCode(200)
                .body("status", equalTo("CANCELLED"))
                .body("statusReason", equalTo("Dose gerada por engano"))
                .body("administration", org.hamcrest.Matchers.nullValue());

        // Continua na lista do tratamento (como excluída), some do histórico e não pode ser excluída de novo.
        Map<String, Object> after = doses(t).stream().filter(o -> id.equals(o.get("id"))).findFirst().orElseThrow();
        assertEquals("CANCELLED", after.get("status"));
        List<Map<String, Object>> history = d.ana.req().queryParam("treatmentId", t)
                .queryParam("from", d.now.minus(3, ChronoUnit.DAYS).toString())
                .queryParam("to", d.now.plus(1, ChronoUnit.DAYS).toString())
                .get("/api/families/{f}/history", d.family).then().statusCode(200).extract().jsonPath().getList("$");
        assertTrue(history.stream().noneMatch(o -> id.equals(o.get("id"))));
        d.ana.req().body(Map.of("baseVersion", version(after), "reason", "de novo"))
                .post("/api/families/{f}/occurrences/{o}/exclusion", d.family, id).then().statusCode(409)
                .body("code", equalTo("ALREADY_EXCLUDED"));

        // Auditoria guarda o antes (dada), o depois e o motivo.
        String audit = d.ana.req().get("/api/families/{f}/export", d.family).then().statusCode(200).extract().asString();
        assertTrue(audit.contains("DOSE_EXCLUDED") && audit.contains("Dose gerada por engano"));
    }

    @Test
    void excludedDoseDoesNotCountTowardsTheTotal() {
        LocalDate tomorrow = LocalDate.now(ZoneOffset.UTC).plusDays(1);
        Map<String, Object> body = new HashMap<>();
        body.put("personId", d.person);
        body.put("name", "Antibiótico");
        body.put("kind", "OCCASIONAL");
        body.put("prescribedDose", "5 ml");
        body.put("startAt", tomorrow.atTime(8, 0).toInstant(ZoneOffset.UTC).toString());
        body.put("doseCount", 4);
        body.put("schedule", Map.of("type", "DAILY", "timezone", "UTC", "times", List.of("08:00", "20:00")));
        String t = d.ana.req().body(body).post("/api/families/{f}/treatments", d.family)
                .then().statusCode(201).extract().path("id");
        d.activate(t, 1, Instant.now());
        assertEquals(4, doses(t).size());

        Map<String, Object> first = doses(t).getFirst();
        d.ana.req().body(Map.of("baseVersion", version(first), "reason", "Horário errado"))
                .post("/api/families/{f}/occurrences/{o}/exclusion", d.family, first.get("id")).then().statusCode(200);
        schedules.extendAll();

        List<Map<String, Object>> after = doses(t);
        assertEquals(4, after.stream().filter(o -> !"CANCELLED".equals(o.get("status"))).count(),
                "a agenda segue até completar as 4 doses da receita");
        assertEquals(5, after.size());
    }
}
