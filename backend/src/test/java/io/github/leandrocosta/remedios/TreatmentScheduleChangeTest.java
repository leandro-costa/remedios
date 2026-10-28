package io.github.leandrocosta.remedios;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.test.junit.QuarkusTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Alterar um tratamento ativo nunca deixa doses em aberto em duplicidade. */
@QuarkusTest
class TreatmentScheduleChangeTest {

    Dosing d;
    Instant t1;
    Instant t2;
    Instant start;

    @BeforeEach
    void setUp() {
        d = new Dosing();
        t1 = d.now.plus(1, ChronoUnit.HOURS);
        t2 = d.now.plus(5, ChronoUnit.HOURS);
        start = d.now.minus(2, ChronoUnit.DAYS);
    }

    private void change(String id, Map<String, Object> schedule, long baseVersion, Instant effectiveFrom) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", "Medicamento A");
        body.put("kind", "CONTINUOUS");
        body.put("prescribedDose", "5 ml");
        body.put("startAt", start.toString());
        body.put("schedule", schedule);
        body.put("baseVersion", baseVersion);
        body.put("effectiveFrom", effectiveFrom.toString());
        d.ana.req().body(body).put("/api/families/{f}/treatments/{t}", d.family, id).then().statusCode(200);
    }

    /** Doses em aberto por horário, nos próximos dias. */
    private Map<String, Integer> open() {
        List<Map<String, Object>> list = d.agenda(d.now, d.now.plus(4, ChronoUnit.DAYS)).getList("$");
        Map<String, Integer> byTime = new TreeMap<>();
        for (Map<String, Object> o : list) {
            String status = (String) o.get("status");
            if (status.equals("SCHEDULED") || status.equals("PENDING")) {
                byTime.merge((String) o.get("scheduledAt"), 1, Integer::sum);
            }
        }
        return byTime;
    }

    private static void noDuplicates(Map<String, Integer> open) {
        assertTrue(open.values().stream().allMatch(n -> n == 1), "doses em duplicidade: " + open);
    }

    @Test
    void earlierChangeAfterAScheduledFutureChange() {
        String id = d.createTreatment(Dosing.dailyAt(t1, t2));
        d.activate(id, 1, d.now);
        // Primeiro, uma alteração que só vale amanhã.
        change(id, Dosing.dailyAt(t1.plus(15, ChronoUnit.MINUTES), t2.plus(15, ChronoUnit.MINUTES)), 2,
                Instant.now().plus(1, ChronoUnit.DAYS));
        // Depois, outra que vale já (anterior ao início da primeira).
        Map<String, Object> later = Dosing.dailyAt(t1.plus(30, ChronoUnit.MINUTES), t2.plus(30, ChronoUnit.MINUTES));
        change(id, later, 3, Instant.now());

        Map<String, Integer> open = open();
        noDuplicates(open);
        assertEquals(8, open.size(), "4 dias × 2 horários, só os novos: " + open);
        assertTrue(open.keySet().stream().allMatch(at -> at.contains(":" + t1.plus(30, ChronoUnit.MINUTES)
                .toString().substring(14, 16))), "só os horários da última alteração: " + open);
    }

    /**
     * V8: estado deixado pelo erro (versão anterior com doses em aberto depois
     * do início da nova) é corrigido sem tocar nas doses da versão vigente.
     */
    @Test
    void migrationCancelsDuplicatesLeftByTheOldBug() throws Exception {
        String id = d.createTreatment(Dosing.dailyAt(t1, t2));
        d.activate(id, 1, d.now);
        java.util.UUID treatment = java.util.UUID.fromString(id);
        java.util.UUID v2 = java.util.UUID.randomUUID();
        Instant from = Instant.now();
        io.quarkus.narayana.jta.QuarkusTransaction.requiringNew().run(() -> {
            var em = io.quarkus.hibernate.orm.panache.Panache.getEntityManager();
            // Como o erro deixava: a versão 1 segue vigente e a 2 repete os mesmos horários.
            em.createNativeQuery("""
                    UPDATE treatment_schedule SET valid_until = :from WHERE treatment_id = :t AND version = 1
                    """).setParameter("from", from.plus(2, ChronoUnit.DAYS)).setParameter("t", treatment)
                    .executeUpdate();
            em.createNativeQuery("""
                    INSERT INTO treatment_schedule (id, treatment_id, timezone, reminder_before_minutes,
                        repeat_interval_minutes, repeat_limit, late_tolerance_minutes, version, valid_from, rule, created_at)
                    SELECT :id, treatment_id, timezone, reminder_before_minutes, repeat_interval_minutes,
                           repeat_limit, late_tolerance_minutes, 2, :from, rule, now()
                      FROM treatment_schedule WHERE treatment_id = :t AND version = 1
                    """).setParameter("id", v2).setParameter("from", from).setParameter("t", treatment).executeUpdate();
            em.createNativeQuery("""
                    INSERT INTO dose_occurrence (id, family_id, treatment_id, schedule_id, slot_key, scheduled_at,
                        schedule_version, status, version, created_at, updated_at)
                    SELECT gen_random_uuid(), family_id, treatment_id, :v2, slot_key, scheduled_at, 2, 'SCHEDULED', 1,
                           now(), now()
                      FROM dose_occurrence WHERE treatment_id = :t AND status = 'SCHEDULED' AND scheduled_at >= :from
                    """).setParameter("v2", v2).setParameter("t", treatment).setParameter("from", from).executeUpdate();
        });
        assertTrue(open().values().stream().anyMatch(n -> n > 1), "o teste precisa partir de doses duplicadas");

        String sql = new String(getClass().getResourceAsStream("/db/migration/V8__doses_duplicadas.sql").readAllBytes(),
                java.nio.charset.StandardCharsets.UTF_8);
        io.quarkus.narayana.jta.QuarkusTransaction.requiringNew().run(() -> {
            var em = io.quarkus.hibernate.orm.panache.Panache.getEntityManager();
            for (String statement : sql.replaceAll("(?m)^--.*$", "").split(";")) {
                if (!statement.isBlank()) {
                    em.createNativeQuery(statement).executeUpdate();
                }
            }
        });

        Map<String, Integer> open = open();
        noDuplicates(open);
        assertEquals(8, open.size(), open.toString());
        Map<String, Long> counts = io.quarkus.narayana.jta.QuarkusTransaction.requiringNew().call(() -> {
            var em = io.quarkus.hibernate.orm.panache.Panache.getEntityManager();
            java.util.function.Function<String, Long> count = (q) -> ((Number) em.createNativeQuery(q)
                    .setParameter("t", treatment).setParameter("v2", v2).setParameter("from", from)
                    .getSingleResult()).longValue();
            return Map.of(
                    "antigaAberta", count.apply("""
                            SELECT count(*) FROM dose_occurrence WHERE treatment_id = :t AND schedule_id <> :v2
                               AND status = 'SCHEDULED' AND scheduled_at >= :from AND :v2 = :v2"""),
                    "vigenteAberta", count.apply("""
                            SELECT count(*) FROM dose_occurrence WHERE schedule_id = :v2 AND status = 'SCHEDULED'
                               AND treatment_id = :t AND scheduled_at >= :from"""),
                    "copiadas", count.apply("""
                            SELECT count(*) FROM dose_occurrence WHERE schedule_id = :v2
                               AND treatment_id = :t AND scheduled_at >= :from"""));
        });
        assertEquals(0L, counts.get("antigaAberta"), "a versão substituída não fica com dose em aberto: " + counts);
        assertEquals(counts.get("copiadas"), counts.get("vigenteAberta"), "a versão vigente fica intacta: " + counts);
    }

    @Test
    void secondChangeWithFormOpenedBeforeTheFirstWasSaved() {
        String id = d.createTreatment(Dosing.dailyAt(t1, t2));
        d.activate(id, 1, d.now);
        Instant formOpened = Instant.now().minus(3, ChronoUnit.MINUTES);
        change(id, Dosing.dailyAt(t1.plus(10, ChronoUnit.MINUTES), t2), 2, Instant.now());
        // Formulário aberto antes da primeira alteração: vigência um pouco anterior a ela.
        change(id, Dosing.dailyAt(t1.plus(20, ChronoUnit.MINUTES), t2), 3, formOpened);

        Map<String, Integer> open = open();
        noDuplicates(open);
        assertEquals(8, open.size(), open.toString());
    }
}
