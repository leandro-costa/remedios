package io.github.leandrocosta.remedios.schedule;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.leandrocosta.remedios.family.FamilySettings;
import io.github.leandrocosta.remedios.occurrence.DoseOccurrence;
import io.github.leandrocosta.remedios.treatment.Treatment;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Materializa a regra de agenda em versões com vigência e gera as ocorrências
 * até o horizonte configurado (decisão em aberto 3). A geração é idempotente:
 * repetir a chamada não duplica doses (UNIQUE(schedule_id, slot_key)).
 */
@ApplicationScoped
public class ScheduleService {

    private static final Logger LOG = Logger.getLogger(ScheduleService.class);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {
    };

    private final ObjectMapper mapper;
    private final EntityManager em;
    private final Duration horizon;

    public ScheduleService(ObjectMapper mapper, EntityManager em,
            @ConfigProperty(name = "remedios.schedule.horizon") Duration horizon) {
        this.mapper = mapper.copy().setSerializationInclusion(JsonInclude.Include.NON_NULL);
        this.em = em;
        this.horizon = horizon;
    }

    public Duration horizon() {
        return horizon;
    }

    // --- Conversão da regra -------------------------------------------------

    public Map<String, Object> toStored(ScheduleRule rule) {
        return rule == null ? null : mapper.convertValue(rule, MAP);
    }

    public ScheduleRule fromStored(Map<String, Object> stored) {
        return stored == null ? null : mapper.convertValue(stored, ScheduleRule.class);
    }

    // --- Vigência -------------------------------------------------------------

    /** Cria uma nova versão vigente a partir de {@code effectiveFrom} e gera as doses. */
    @Transactional(Transactional.TxType.MANDATORY)
    public TreatmentSchedule start(Treatment treatment, Instant effectiveFrom) {
        ScheduleRule rule = fromStored(treatment.scheduleRule);
        FamilySettings defaults = FamilySettings.findById(treatment.familyId);
        ScheduleRule.Reminders r = rule.reminders() == null
                ? new ScheduleRule.Reminders(null, null, null, null)
                : rule.reminders();

        TreatmentSchedule s = new TreatmentSchedule();
        s.id = UUID.randomUUID();
        s.treatmentId = treatment.id;
        s.rule = treatment.scheduleRule;
        s.timezone = rule.timezone();
        s.reminderBeforeMinutes = or(r.reminderBeforeMinutes(), defaults.reminderBeforeMinutes);
        s.repeatIntervalMinutes = or(r.repeatIntervalMinutes(), defaults.repeatIntervalMinutes);
        s.repeatLimit = or(r.repeatLimit(), defaults.repeatLimit);
        s.lateToleranceMinutes = or(r.lateToleranceMinutes(), defaults.lateToleranceMinutes);
        s.version = TreatmentSchedule.lastVersion(treatment.id) + 1;
        s.validFrom = effectiveFrom;
        s.createdAt = Instant.now();
        s.persist();
        em.flush();
        generate(s, treatment, Instant.now().plus(horizon));
        return s;
    }

    /**
     * Encerra a versão vigente em {@code effectiveFrom} e cancela as doses em
     * aberto a partir dali. Doses anteriores e doses já registradas não mudam.
     *
     * @return quantidade de doses canceladas
     */
    @Transactional(Transactional.TxType.MANDATORY)
    public int stop(Treatment treatment, Instant effectiveFrom, UUID actor, String reason) {
        TreatmentSchedule s = TreatmentSchedule.lockCurrent(treatment.id).orElse(null);
        if (s == null) {
            return 0;
        }
        Instant until = effectiveFrom.isBefore(s.validFrom) ? s.validFrom : effectiveFrom;
        s.validUntil = until;
        Instant now = Instant.now();
        return em.createQuery("""
                update DoseOccurrence o
                   set o.status = :cancelled, o.statusReason = :reason, o.statusChangedBy = :actor,
                       o.statusChangedAt = :now, o.updatedAt = :now, o.version = o.version + 1
                 where o.scheduleId = :schedule and o.status = :open and o.scheduledAt >= :from
                """)
                .setParameter("cancelled", DoseOccurrence.Status.CANCELLED)
                .setParameter("open", DoseOccurrence.Status.SCHEDULED)
                .setParameter("reason", reason)
                .setParameter("actor", actor)
                .setParameter("now", now)
                .setParameter("schedule", s.id)
                .setParameter("from", until)
                .executeUpdate();
    }

    // --- Geração --------------------------------------------------------------

    /** Gera as doses de {@code s} ainda não geradas, até {@code until}. */
    @Transactional(Transactional.TxType.MANDATORY)
    public int generate(TreatmentSchedule s, Treatment t, Instant until) {
        Instant from = max(max(s.validFrom, t.startAt), s.generatedUntil);
        Instant to = min(min(until, s.validUntil), t.endAt);
        if (!from.isBefore(to)) {
            return 0;
        }
        List<OccurrenceSlots.Slot> slots = OccurrenceSlots.between(fromStored(s.rule), t.startAt, from, to);
        Instant now = Instant.now();
        int created = 0;
        for (OccurrenceSlots.Slot slot : slots) {
            created += em.createNativeQuery("""
                    INSERT INTO dose_occurrence (id, family_id, treatment_id, schedule_id, slot_key, scheduled_at,
                                                 schedule_version, status, version, created_at, updated_at)
                    VALUES (:id, :family, :treatment, :schedule, :key, :at, :scheduleVersion, 'SCHEDULED', 1,
                            :now, :now)
                    ON CONFLICT (schedule_id, slot_key) DO NOTHING
                    """)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("family", t.familyId)
                    .setParameter("treatment", t.id)
                    .setParameter("schedule", s.id)
                    .setParameter("key", slot.key())
                    .setParameter("at", slot.at())
                    .setParameter("scheduleVersion", s.version)
                    .setParameter("now", now)
                    .executeUpdate();
        }
        s.generatedUntil = to;
        return created;
    }

    /**
     * Estende o horizonte de todas as agendas vigentes de tratamentos ativos.
     * Cada agenda é processada na própria transação, com bloqueio da linha;
     * instâncias concorrentes da API não duplicam doses.
     */
    public int extendAll() {
        Instant target = Instant.now().plus(horizon);
        List<UUID> ids = QuarkusTransaction.requiringNew().call(() -> em.createQuery("""
                select s.id from TreatmentSchedule s, Treatment t
                 where t.id = s.treatmentId and s.validUntil is null and t.status = :active
                   and (s.generatedUntil is null or s.generatedUntil < :target)
                   and (t.endAt is null or s.generatedUntil is null or s.generatedUntil < t.endAt)
                """, UUID.class)
                .setParameter("active", Treatment.Status.ACTIVE)
                .setParameter("target", target)
                .getResultList());
        int created = 0;
        for (UUID id : ids) {
            try {
                created += QuarkusTransaction.requiringNew().call(() -> extend(id, target));
            } catch (RuntimeException e) {
                LOG.errorf(e, "Falha ao gerar doses da agenda %s", id);
            }
        }
        return created;
    }

    private int extend(UUID scheduleId, Instant target) {
        TreatmentSchedule s = TreatmentSchedule.findById(scheduleId, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        if (s == null || s.validUntil != null) {
            return 0;
        }
        Treatment t = Treatment.findById(s.treatmentId);
        return t.status == Treatment.Status.ACTIVE ? generate(s, t, target) : 0;
    }

    private static int or(Integer value, int fallback) {
        return value == null ? fallback : value;
    }

    private static Instant max(Instant a, Instant b) {
        return b == null || a.isAfter(b) ? a : b;
    }

    private static Instant min(Instant a, Instant b) {
        return b == null || a.isBefore(b) ? a : b;
    }
}
