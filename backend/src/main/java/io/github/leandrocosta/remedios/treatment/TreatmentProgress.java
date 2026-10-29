package io.github.leandrocosta.remedios.treatment;

import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.schedule.OccurrenceSlots;
import io.github.leandrocosta.remedios.schedule.ScheduleService;
import io.github.leandrocosta.remedios.schedule.TreatmentSchedule;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Andamento de cada tratamento: doses dadas, não dadas, sem registro, a dar e
 * a última prevista. Só conta; não sugere nada (dose perdida não é reposta).
 */
@ApplicationScoped
public class TreatmentProgress {

    /** Até onde simular horários ainda não gerados (término por doses ou data distante). */
    static final Duration LOOKAHEAD = Duration.ofDays(5 * 365);

    /**
     * {@code total} e {@code lastAt}: previstos para o tratamento inteiro, ou nulos se não há término.
     * {@code unrecorded}: horário já passou e ninguém registrou. {@code upcoming}: ainda por vir.
     */
    public record Progress(UUID treatmentId, Integer total, long administered, long notAdministered,
            long unrecorded, long review, Long upcoming, Instant firstAt, Instant lastAt) {
    }

    private final EntityManager em;
    private final FamilyAccess access;
    private final ScheduleService schedules;

    public TreatmentProgress(EntityManager em, FamilyAccess access, ScheduleService schedules) {
        this.em = em;
        this.access = access;
        this.schedules = schedules;
    }

    private record Counts(long administered, long notAdministered, long unrecorded, long review, long upcoming,
            long planned, Instant firstAt, Instant lastAt) {
    }

    public List<Progress> forFamily(UUID familyId) {
        access.requireMember(familyId);
        Instant now = Instant.now();
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery("""
                SELECT treatment_id,
                       count(*) FILTER (WHERE status = 'ADMINISTERED'),
                       count(*) FILTER (WHERE status = 'NOT_ADMINISTERED'),
                       count(*) FILTER (WHERE status = 'SCHEDULED' AND scheduled_at < :now),
                       count(*) FILTER (WHERE status = 'REVIEW_REQUIRED'),
                       count(*) FILTER (WHERE status = 'SCHEDULED' AND scheduled_at >= :now),
                       count(*) FILTER (WHERE status <> 'CANCELLED'),
                       min(scheduled_at) FILTER (WHERE status <> 'CANCELLED'),
                       max(scheduled_at) FILTER (WHERE status <> 'CANCELLED')
                  FROM dose_occurrence WHERE family_id = :f GROUP BY treatment_id
                """, Object[].class)
                .setParameter("f", familyId).setParameter("now", now).getResultList();
        Map<UUID, Counts> counts = new HashMap<>();
        for (Object[] r : rows) {
            counts.put((UUID) r[0], new Counts(n(r[1]), n(r[2]), n(r[3]), n(r[4]), n(r[5]), n(r[6]),
                    instant(r[7]), instant(r[8])));
        }
        List<Treatment> list = Treatment.list("familyId", familyId);
        return list.stream().map(t -> progress(t, counts.getOrDefault(t.id,
                new Counts(0, 0, 0, 0, 0, 0, null, null)), now)).toList();
    }

    private Progress progress(Treatment t, Counts c, Instant now) {
        boolean scheduling = t.status == Treatment.Status.ACTIVE || t.status == Treatment.Status.DRAFT;
        boolean bounded = t.doseCount != null || t.endAt != null;
        if (!scheduling || !bounded || t.scheduleRule == null) {
            // Sem término (ou sem agenda futura): só o que já existe.
            Integer total = scheduling && !bounded ? null : (int) c.planned();
            return new Progress(t.id, total, c.administered(), c.notAdministered(), c.unrecorded(), c.review(),
                    scheduling && !bounded ? null : c.upcoming(), c.firstAt(), scheduling && !bounded ? null : c.lastAt());
        }
        // Horários ainda não gerados (além do horizonte) até o término.
        TreatmentSchedule current = TreatmentSchedule.<TreatmentSchedule>find(
                "treatmentId = ?1 and validUntil is null", t.id).firstResult();
        Instant from = t.startAt;
        if (current != null) {
            from = max(max(current.validFrom, t.startAt), current.generatedUntil);
        }
        Instant to = t.endAt != null ? t.endAt : from.plus(LOOKAHEAD);
        List<OccurrenceSlots.Slot> future = OccurrenceSlots.between(schedules.fromStored(
                current != null ? current.rule : t.scheduleRule), t.startAt, from, to);
        long missing = t.doseCount != null ? Math.max(0, t.doseCount - c.planned()) : future.size();
        missing = Math.min(missing, future.size());
        Instant firstAt = c.firstAt() != null ? c.firstAt() : (future.isEmpty() ? null : future.getFirst().at());
        Instant lastAt = missing > 0 ? future.get((int) missing - 1).at() : c.lastAt();
        int total = (int) (c.planned() + missing);
        return new Progress(t.id, total, c.administered(), c.notAdministered(), c.unrecorded(), c.review(),
                c.upcoming() + missing, firstAt, lastAt);
    }

    private static long n(Object value) {
        return ((Number) value).longValue();
    }

    private static Instant instant(Object value) {
        return switch (value) {
            case null -> null;
            case Instant i -> i;
            case OffsetDateTime o -> o.toInstant();
            case java.sql.Timestamp ts -> ts.toInstant();
            default -> throw new IllegalStateException("Data inesperada: " + value.getClass());
        };
    }

    private static Instant max(Instant a, Instant b) {
        return b == null || a.isAfter(b) ? a : b;
    }
}
