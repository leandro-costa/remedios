package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
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
 * Término por número de doses ("por 5 dias, 2 vezes ao dia" = 10 doses): a
 * contagem começa na primeira dose real, dose não dada conta e não é reposta,
 * alteração no meio mantém o total.
 */
@QuarkusTest
class TreatmentDoseCountTest {

    Dosing d;
    LocalDate today;

    @BeforeEach
    void setUp() {
        d = new Dosing();
        today = LocalDate.now(ZoneOffset.UTC);
    }

    private Instant at(LocalDate day, int hour) {
        return day.atTime(hour, 0).toInstant(ZoneOffset.UTC);
    }

    private static Map<String, Object> rule(String... times) {
        return new HashMap<>(Map.of("type", "DAILY", "timezone", "UTC", "times", List.of(times)));
    }

    private Map<String, Object> body(Instant startAt, Integer doseCount, Map<String, Object> schedule) {
        Map<String, Object> b = new HashMap<>();
        b.put("personId", d.person);
        b.put("name", "Antibiótico");
        b.put("kind", "CONTINUOUS");
        b.put("prescribedDose", "5 ml");
        b.put("startAt", startAt.toString());
        b.put("schedule", schedule);
        b.put("doseCount", doseCount);
        return b;
    }

    private String create(Instant startAt, int doseCount) {
        return d.ana.req().body(body(startAt, doseCount, rule("08:00", "20:00")))
                .post("/api/families/{f}/treatments", d.family).then().statusCode(201)
                .body("doseCount", equalTo(doseCount)).extract().path("id");
    }

    /** Doses que contam (não canceladas), em ordem. */
    private List<String> planned(String treatment) {
        List<Map<String, Object>> all = d.agenda(today.minusDays(10).atStartOfDay().toInstant(ZoneOffset.UTC),
                today.plusDays(20).atStartOfDay().toInstant(ZoneOffset.UTC)).getList("$");
        return all.stream()
                .filter(o -> treatment.equals(((Map<?, ?>) o.get("treatment")).get("id")))
                .filter(o -> !"CANCELLED".equals(o.get("status")))
                .map(o -> (String) o.get("scheduledAt")).sorted().toList();
    }

    private Map<String, Object> progress(String treatment) {
        List<Map<String, Object>> list = d.ana.req().get("/api/families/{f}/treatments/progress", d.family)
                .then().statusCode(200).extract().jsonPath().getList("$");
        return list.stream().filter(p -> treatment.equals(p.get("treatmentId"))).findFirst().orElseThrow();
    }

    @Test
    void tenDosesStartingAtTheEveningDoseEndOnTheSixthMorning() {
        LocalDate first = today.plusDays(1);
        String id = create(at(first, 20), 10);
        d.activate(id, 1, Instant.now());

        List<String> doses = planned(id);
        assertEquals(10, doses.size(), doses.toString());
        assertEquals(at(first, 20).toString(), doses.getFirst());
        assertEquals(at(first.plusDays(5), 8).toString(), doses.getLast(), "completa as 10 doses no 6º dia às 8h");

        Map<String, Object> p = progress(id);
        assertEquals(10, p.get("total"));
        assertEquals(10, p.get("upcoming"));
        assertEquals(at(first.plusDays(5), 8).toString(), p.get("lastAt"));
    }

    @Test
    void treatmentAlreadyUnderwayCountsThePastDosesAndANotGivenDoseIsNotReplaced() {
        LocalDate first = today.minusDays(3);
        String id = create(at(first, 20), 10);
        // Ativação com as doses anteriores em aberto (para registrar uma a uma).
        d.activate(id, 1, at(first, 20));

        List<String> doses = planned(id);
        assertEquals(10, doses.size(), doses.toString());
        assertEquals(at(first.plusDays(5), 8).toString(), doses.getLast());

        // A primeira não foi dada: conta como uma das 10 e não é reposta no fim.
        String firstDose = d.occurrenceAt(at(first, 20));
        d.ana.req().body(Map.of("deviceId", d.anaDevice, "reason", "Esqueci"))
                .post("/api/families/{f}/occurrences/{o}/not-administered", d.family, firstDose)
                .then().statusCode(200);
        assertEquals(10, planned(id).size());
        Map<String, Object> p = progress(id);
        assertEquals(10, p.get("total"));
        assertEquals(1, p.get("notAdministered"));
        assertEquals(at(first.plusDays(5), 8).toString(), p.get("lastAt"), "o término não muda");
    }

    @Test
    void firstDoseNotGivenYetShiftsTheWholeCourse() {
        LocalDate first = today.minusDays(1);
        String id = create(at(first, 20), 4);
        // "A agenda começa agora": as doses anteriores não existem, as 4 contam daqui.
        Instant now = Instant.now();
        d.activate(id, 1, now);
        List<String> doses = planned(id);
        assertEquals(4, doses.size(), doses.toString());
        doses.forEach(at -> assertEquals(true, Instant.parse(at).isAfter(now.minusSeconds(1)), at));
    }

    @Test
    void changingTheTimesMidCourseKeepsTheTotal() {
        LocalDate first = today.minusDays(1);
        String id = create(at(first, 20), 10);
        d.activate(id, 1, at(first, 20));

        Map<String, Object> change = body(at(first, 20), 10, rule("09:00", "21:00"));
        change.remove("personId");
        change.put("baseVersion", 2);
        change.put("effectiveFrom", Instant.now().toString());
        d.ana.req().body(change).put("/api/families/{f}/treatments/{t}", d.family, id).then().statusCode(200);

        List<String> doses = planned(id);
        assertEquals(10, doses.size(), doses.toString());
        assertEquals(10, progress(id).get("total"));
    }

    @Test
    void endDateAndDoseCountAreExclusive() {
        Map<String, Object> b = body(at(today, 20), 10, rule("08:00", "20:00"));
        b.put("endAt", at(today.plusDays(5), 20).toString());
        d.ana.req().body(b).post("/api/families/{f}/treatments", d.family).then().statusCode(422)
                .body("code", equalTo("END_OR_COUNT"));
    }
}
