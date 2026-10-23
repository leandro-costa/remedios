package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.leandrocosta.remedios.schedule.ScheduleService;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

@QuarkusTest
class AgendaTest {

    @Inject
    ScheduleService schedules;

    @Test
    void activationRequiresSchedule() {
        Dosing d = new Dosing();
        String t = d.createTreatment(null);
        d.ana.req().body(Map.of("status", "ACTIVE", "baseVersion", 1))
                .post("/api/families/{f}/treatments/{tr}/status", d.family, t).then().statusCode(422)
                .body("code", equalTo("SCHEDULE_REQUIRED"));
    }

    @Test
    void invalidScheduleIsRejected() {
        Dosing d = new Dosing();
        Map<String, Object> rule = new HashMap<>(Dosing.dailyAt(d.now));
        rule.put("timezone", "Lua/Base");
        Map<String, Object> body = new HashMap<>(Map.of("personId", d.person, "name", "X", "kind", "CONTINUOUS",
                "prescribedDose", "1", "startAt", d.now.toString()));
        body.put("schedule", rule);
        d.ana.req().body(body).post("/api/families/{f}/treatments", d.family).then().statusCode(422)
                .body("code", equalTo("INVALID_SCHEDULE"));
    }

    @Test
    void activationGeneratesDosesUpToTheHorizonOnly() {
        Dosing d = new Dosing();
        Instant morning = d.now.plus(1, ChronoUnit.HOURS);
        Instant evening = d.now.plus(13, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(morning, evening));
        d.activate(t, 1, d.now);

        List<Map<String, Object>> next = d.agenda(d.now, d.now.plus(2, ChronoUnit.DAYS)).getList("$");
        assertEquals(4, next.size());
        assertEquals("SCHEDULED", next.getFirst().get("status"));
        assertEquals("Gabriel", ((Map<?, ?>) next.getFirst().get("person")).get("displayName"));
        assertEquals("5 ml", ((Map<?, ?>) next.getFirst().get("treatment")).get("prescribedDose"));

        // Nada antes da ativação, nada além do horizonte de 14 dias.
        assertEquals(0, d.agenda(d.now.minus(2, ChronoUnit.DAYS), d.now).getList("$").size());
        Instant horizon = d.now.plus(schedules.horizon());
        assertEquals(0, d.agenda(horizon.plus(1, ChronoUnit.MINUTES), horizon.plus(3, ChronoUnit.DAYS))
                .getList("$").size());
        assertEquals(28, d.agenda(d.now, horizon.plus(1, ChronoUnit.MINUTES)).getList("$").size());
    }

    @Test
    void draftCanBeActivatedWithTodaysEarlierDoses() {
        Dosing d = new Dosing();
        Instant earlier = d.now.minus(2, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(earlier));
        d.activate(t, 1, d.now.minus(3, ChronoUnit.HOURS));

        Map<String, Object> dose = d.agenda(earlier.minusSeconds(60), earlier.plusSeconds(60)).getMap("[0]");
        assertEquals("PENDING", dose.get("status"));
        assertEquals(true, dose.get("late"));

        d.ana.req().body(Map.of("status", "ACTIVE", "baseVersion", 1, "effectiveFrom",
                d.now.minus(3, ChronoUnit.DAYS).toString()))
                .post("/api/families/{f}/treatments/{tr}/status", d.family, d.createTreatment(Dosing.dailyAt(d.now)))
                .then().statusCode(422).body("code", equalTo("EFFECTIVE_FROM_IN_PAST"));
    }

    @Test
    void horizonExtensionIsIdempotent() {
        Dosing d = new Dosing();
        String t = d.createTreatment(Dosing.dailyAt(d.now.plus(1, ChronoUnit.HOURS)));
        d.activate(t, 1, d.now);
        int before = d.agenda(d.now, d.now.plus(30, ChronoUnit.DAYS)).getList("$").size();

        schedules.extendAll();
        schedules.extendAll();
        assertEquals(before, d.agenda(d.now, d.now.plus(30, ChronoUnit.DAYS)).getList("$").size());
    }

    @Test
    void suspendingCancelsOnlyFutureOpenDosesAndReactivationResumes() {
        Dosing d = new Dosing();
        Instant past = d.now.minus(2, ChronoUnit.HOURS);
        Instant soon = d.now.plus(2, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(past, soon));
        d.activate(t, 1, d.now.minus(3, ChronoUnit.HOURS));

        d.ana.req().body(Map.of("status", "SUSPENDED", "baseVersion", 2))
                .post("/api/families/{f}/treatments/{tr}/status", d.family, t).then().statusCode(200);

        assertEquals("PENDING", d.agenda(past.minusSeconds(60), past.plusSeconds(60)).getString("[0].status"));
        Map<String, Object> cancelled = d.agenda(soon.minusSeconds(60), soon.plusSeconds(60)).getMap("[0]");
        assertEquals("CANCELLED", cancelled.get("status"));
        assertEquals("Tratamento suspenso", cancelled.get("statusReason"));

        d.ana.req().body(Map.of("status", "ACTIVE", "baseVersion", 3))
                .post("/api/families/{f}/treatments/{tr}/status", d.family, t).then().statusCode(200);
        List<Map<String, Object>> sameTime = d.agenda(soon.minusSeconds(60), soon.plusSeconds(60)).getList("$");
        assertEquals(List.of("CANCELLED", "SCHEDULED"),
                sameTime.stream().map(o -> (String) o.get("status")).sorted().toList());
    }

    @Test
    void scheduleChangeRecalculatesOnlyFutureDoses() {
        Dosing d = new Dosing();
        Instant past = d.now.minus(2, ChronoUnit.HOURS);
        Instant oldTime = d.now.plus(2, ChronoUnit.HOURS);
        Instant newTime = d.now.plus(3, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(past, oldTime));
        d.activate(t, 1, d.now.minus(3, ChronoUnit.HOURS));

        Map<String, Object> update = new HashMap<>(Map.of("name", "Medicamento A", "kind", "CONTINUOUS",
                "prescribedDose", "5 ml", "startAt", d.now.minus(2, ChronoUnit.DAYS).toString(), "baseVersion", 2,
                "effectiveFrom", d.now.toString(), "reason", "Novo horário"));
        update.put("schedule", Dosing.dailyAt(past, newTime));
        d.ana.req().body(update).put("/api/families/{f}/treatments/{tr}", d.family, t).then().statusCode(200)
                .body("version", equalTo(3));

        assertEquals("PENDING", d.agenda(past.minusSeconds(60), past.plusSeconds(60)).getString("[0].status"));
        assertEquals("CANCELLED", d.agenda(oldTime.minusSeconds(60), oldTime.plusSeconds(60)).getString("[0].status"));
        assertEquals("SCHEDULED", d.agenda(newTime.minusSeconds(60), newTime.plusSeconds(60)).getString("[0].status"));
    }

    @Test
    void renamingDoesNotTouchTheAgenda() {
        Dosing d = new Dosing();
        Instant soon = d.now.plus(2, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(soon));
        d.activate(t, 1, d.now);
        String before = d.occurrenceAt(soon);

        Map<String, Object> update = new HashMap<>(Map.of("name", "Medicamento A (genérico)", "kind", "CONTINUOUS",
                "prescribedDose", "5 ml", "startAt", d.now.minus(2, ChronoUnit.DAYS).toString(), "baseVersion", 2,
                "effectiveFrom", d.now.toString()));
        update.put("schedule", Dosing.dailyAt(soon));
        d.ana.req().body(update).put("/api/families/{f}/treatments/{tr}", d.family, t).then().statusCode(200);

        assertEquals(before, d.occurrenceAt(soon));
    }

    @Test
    void endDateBoundsGeneration() {
        Dosing d = new Dosing();
        Map<String, Object> body = new HashMap<>(Map.of("personId", d.person, "name", "Antibiótico", "kind",
                "OCCASIONAL", "prescribedDose", "1 comprimido", "startAt", d.now.toString(),
                "endAt", d.now.plus(3, ChronoUnit.DAYS).toString()));
        body.put("schedule", Map.of("type", "INTERVAL", "timezone", "UTC", "everyHours", 8, "firstDoseAt",
                d.now.atOffset(java.time.ZoneOffset.UTC).toLocalTime().toString()));
        String t = d.ana.req().body(body).post("/api/families/{f}/treatments", d.family).then().statusCode(201)
                .extract().path("id");
        d.activate(t, 1, d.now);

        List<Map<String, Object>> all = d.agenda(d.now.minus(1, ChronoUnit.DAYS), d.now.plus(10, ChronoUnit.DAYS))
                .getList("$");
        assertEquals(9, all.size());
        assertTrue(all.stream().allMatch(o -> Instant.parse((String) o.get("scheduledAt"))
                .isBefore(d.now.plus(3, ChronoUnit.DAYS))));
    }

    @Test
    void agendaFiltersAndValidation() {
        Dosing d = new Dosing();
        String t = d.createTreatment(Dosing.dailyAt(d.now.plus(1, ChronoUnit.HOURS)));
        d.activate(t, 1, d.now);
        String other = d.ana.req().body(PersonTest.person("Isabela", null, null))
                .post("/api/families/{f}/persons", d.family).then().extract().path("id");

        d.ana.req().queryParam("from", d.now.toString()).queryParam("to", d.now.plus(1, ChronoUnit.DAYS).toString())
                .queryParam("personId", other).get("/api/families/{f}/occurrences", d.family).then()
                .statusCode(200).body("size()", equalTo(0));
        d.ana.req().queryParam("from", d.now.toString()).queryParam("to", d.now.plus(90, ChronoUnit.DAYS).toString())
                .get("/api/families/{f}/occurrences", d.family).then().statusCode(422)
                .body("code", equalTo("INVALID_RANGE"));
        Api.newUser("Eve").req().queryParam("from", d.now.toString())
                .queryParam("to", d.now.plus(1, ChronoUnit.DAYS).toString())
                .get("/api/families/{f}/occurrences", d.family).then().statusCode(404);
    }
}
