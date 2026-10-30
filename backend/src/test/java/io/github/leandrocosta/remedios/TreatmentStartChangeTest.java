package io.github.leandrocosta.remedios;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Mudar o início de um tratamento ativo reavalia as doses; registros feitos não mudam. */
@QuarkusTest
class TreatmentStartChangeTest {

    Dosing d;
    /** Horário diário das doses: 1 hora atrás (a de hoje já passou). */
    Instant time;

    @BeforeEach
    void setUp() {
        d = new Dosing();
        time = d.now.minus(1, ChronoUnit.HOURS);
    }

    private Map<String, Object> body(Instant start, Integer doseCount) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", "Medicamento A");
        body.put("kind", "OCCASIONAL");
        body.put("prescribedDose", "5 ml");
        body.put("startAt", start.toString());
        body.put("schedule", Dosing.dailyAt(time));
        body.put("doseCount", doseCount);
        return body;
    }

    /** Cria e ativa desde o início, com as doses anteriores em aberto. */
    private String createActive(Instant start, Integer doseCount) {
        Map<String, Object> body = body(start, doseCount);
        body.put("personId", d.person);
        String id = d.ana.req().body(body).post("/api/families/{f}/treatments", d.family)
                .then().statusCode(201).extract().path("id");
        d.activate(id, 1, start);
        return id;
    }

    private void changeStart(String id, Instant start, Integer doseCount, String pastDoses) {
        Map<String, Object> body = body(start, doseCount);
        body.put("baseVersion", 2);
        body.put("effectiveFrom", Instant.now().toString());
        body.put("pastDoses", pastDoses);
        body.put("deviceId", d.anaDevice.toString());
        d.ana.req().body(body).put("/api/families/{f}/treatments/{t}", d.family, id).then().statusCode(200);
    }

    /** Situação de cada dose (não cancelada) por horário. */
    private Map<Instant, String> doses() {
        List<Map<String, Object>> list = d.agenda(d.now.minus(10, ChronoUnit.DAYS), d.now.plus(10, ChronoUnit.DAYS))
                .getList("$");
        Map<Instant, String> byTime = new TreeMap<>();
        for (Map<String, Object> o : list) {
            if (!"CANCELLED".equals(o.get("status"))) {
                String previous = byTime.put(Instant.parse((String) o.get("scheduledAt")), (String) o.get("status"));
                assertEquals(null, previous, "dose em duplicidade em " + o.get("scheduledAt"));
            }
        }
        return byTime;
    }

    private Instant day(int days) {
        return time.plus(days, ChronoUnit.DAYS);
    }

    @Test
    void laterStartCancelsOpenDosesBeforeItAndKeepsRecords() {
        String id = createActive(day(-3).minus(1, ChronoUnit.HOURS), null);
        String yesterday = d.occurrenceAt(day(-1));
        d.ana.req().body(Map.of("deviceId", d.anaDevice.toString()))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, yesterday).then().statusCode(200);

        changeStart(id, day(0).minus(1, ChronoUnit.HOURS), null, "OPEN");

        Map<Instant, String> doses = doses();
        assertEquals("ADMINISTERED", doses.get(day(-1)), "o registro continua: " + doses);
        assertEquals(null, doses.get(day(-3)), "antes do novo início, sem registro: cancelada");
        assertEquals(null, doses.get(day(-2)));
        assertEquals("PENDING", doses.get(day(0)));
    }

    @Test
    void earlierStartAddsThePastDosesAsGivenWhenInformed() {
        String id = createActive(day(-1).minus(1, ChronoUnit.HOURS), null);
        changeStart(id, day(-3).minus(1, ChronoUnit.HOURS), null, "ADMINISTERED");

        Map<Instant, String> doses = doses();
        assertEquals("ADMINISTERED", doses.get(day(-3)), doses.toString());
        assertEquals("ADMINISTERED", doses.get(day(-2)), doses.toString());
        // As que já existiam não são registradas sozinhas.
        assertEquals("PENDING", doses.get(day(-1)), doses.toString());
        assertEquals("PENDING", doses.get(day(0)), doses.toString());
        assertEquals("SCHEDULED", doses.get(day(1)), doses.toString());
    }

    @Test
    void earlierStartWithDoseCountMovesTheLastDose() {
        // 3 doses: ontem, hoje e amanhã.
        String id = createActive(day(-1).minus(1, ChronoUnit.HOURS), 3);
        assertEquals(List.of(day(-1), day(0), day(1)), List.copyOf(doses().keySet()));

        changeStart(id, day(-2).minus(1, ChronoUnit.HOURS), 3, "OPEN");

        // Antecipado um dia: a de anteontem entra e a de amanhã sai.
        assertEquals(List.of(day(-2), day(-1), day(0)), List.copyOf(doses().keySet()));
    }
}
