package io.github.leandrocosta.remedios.treatment;

import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.Texts;
import io.github.leandrocosta.remedios.common.VersionConflictException;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.schedule.ScheduleRule;
import io.github.leandrocosta.remedios.schedule.ScheduleService;
import io.github.leandrocosta.remedios.user.CurrentUser;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Cadastro e versionamento de tratamentos (seções 4.5, 10.2 e 11.1). Cada
 * alteração aceita gera nova versão, revisão, auditoria e evento de outbox na
 * mesma transação. Uma versão-base desatualizada é rejeitada sem aplicar nada.
 */
@ApplicationScoped
public class TreatmentService {

    static final String TREATMENT = "TREATMENT";

    /** Tolerância para relógios de dispositivos ligeiramente atrasados. */
    private static final Duration CLOCK_SKEW = Duration.ofMinutes(5);
    /** Ao ativar um rascunho, a agenda pode começar no máximo este tempo no passado. */
    private static final Duration MAX_ACTIVATION_BACKDATE = Duration.ofHours(24);

    public record TreatmentData(String name, Treatment.Kind kind, String prescribedDose, String route,
            String instructions, Instant startAt, Instant endAt, ScheduleRule schedule) {
    }

    public record Change(long baseVersion, Instant effectiveFrom, String reason) {
    }

    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final AuditService audit;
    private final ScheduleService schedules;

    public TreatmentService(CurrentUser currentUser, FamilyAccess access, AuditService audit,
            ScheduleService schedules) {
        this.currentUser = currentUser;
        this.access = access;
        this.audit = audit;
        this.schedules = schedules;
    }

    public List<Treatment> list(UUID familyId, UUID personId, Treatment.Status status) {
        access.requireMember(familyId);
        StringBuilder query = new StringBuilder("familyId = :familyId");
        Map<String, Object> params = new HashMap<>();
        params.put("familyId", familyId);
        if (personId != null) {
            query.append(" and personId = :personId");
            params.put("personId", personId);
        }
        if (status != null) {
            query.append(" and status = :status");
            params.put("status", status);
        }
        query.append(" order by name, createdAt");
        return Treatment.list(query.toString(), params);
    }

    public Treatment get(UUID familyId, UUID treatmentId) {
        access.requireMember(familyId);
        return Treatment.findInFamily(familyId, treatmentId).orElseThrow(() -> ApiException.notFound("Tratamento"));
    }

    public List<TreatmentRevision> revisions(UUID familyId, UUID treatmentId) {
        Treatment treatment = get(familyId, treatmentId);
        return TreatmentRevision.forTreatment(treatment.id);
    }

    @Transactional
    public Treatment create(UUID familyId, UUID personId, TreatmentData data) {
        access.requireMember(familyId);
        Person person = Person.findInFamily(familyId, personId)
                .orElseThrow(() -> ApiException.unprocessable("PERSON_NOT_FOUND",
                        "A pessoa informada não pertence a esta família."));
        if (!person.active) {
            throw ApiException.unprocessable("PERSON_INACTIVE", "Não é possível cadastrar tratamento para um perfil inativo.");
        }
        validate(data);

        UUID actor = currentUser.id();
        Instant now = Instant.now();
        Treatment t = new Treatment();
        t.id = UUID.randomUUID();
        t.familyId = familyId;
        t.personId = personId;
        apply(t, data);
        t.status = Treatment.Status.DRAFT;
        t.version = 1;
        t.createdBy = actor;
        t.createdAt = now;
        t.updatedBy = actor;
        t.updatedAt = now;
        t.persist();

        Map<String, Object> snapshot = snapshot(t);
        saveRevision(t, null, snapshot, t.startAt, null, now);
        audit.record(familyId, actor, TREATMENT, t.id, "TREATMENT_CREATED", null, snapshot, null);
        audit.publish(familyId, "TREATMENT_CREATED", TREATMENT, t.id, event(t));
        return t;
    }

    @Transactional
    public Treatment update(UUID familyId, UUID treatmentId, TreatmentData data, Change change) {
        Treatment t = lockForChange(familyId, treatmentId, change);
        if (t.status == Treatment.Status.ENDED) {
            throw ApiException.conflict("TREATMENT_ENDED", "Tratamentos encerrados não podem ser alterados.");
        }
        validate(data);
        requireEffectiveFrom(t, change);

        Map<String, Object> before = snapshot(t);
        apply(t, data);
        Map<String, Object> after = snapshot(t);
        if (sameContent(before, after)) {
            return t;
        }
        if (t.status == Treatment.Status.ACTIVE) {
            if (t.scheduleRule == null) {
                throw scheduleRequired();
            }
            if (affectsSchedule(before, after)) {
                // Só doses futuras em aberto são recalculadas; o passado fica como está.
                restartSchedule(t, change, "Agenda alterada");
            }
        }
        return commitVersion(t, before, change, "TREATMENT_UPDATED");
    }

    @Transactional
    public Treatment changeStatus(UUID familyId, UUID treatmentId, Treatment.Status target, Change change) {
        Treatment t = lockForChange(familyId, treatmentId, change);
        if (t.status == target) {
            return t;
        }
        if (!t.status.canTransitionTo(target)) {
            throw ApiException.conflict("INVALID_STATUS_TRANSITION",
                    "Não é possível passar de " + t.status + " para " + target + ".");
        }
        requireEffectiveFrom(t, change);
        if (target == Treatment.Status.ACTIVE && t.scheduleRule == null) {
            throw scheduleRequired();
        }
        Map<String, Object> before = snapshot(t);
        Treatment.Status previous = t.status;
        t.status = target;
        if (target == Treatment.Status.ACTIVE) {
            schedules.start(t, change.effectiveFrom());
        } else if (previous == Treatment.Status.ACTIVE) {
            stopSchedule(t, change, target == Treatment.Status.SUSPENDED ? "Tratamento suspenso"
                    : "Tratamento encerrado");
        }
        return commitVersion(t, before, change, "TREATMENT_STATUS_CHANGED");
    }

    // --- Auxiliares -----------------------------------------------------------

    private Treatment lockForChange(UUID familyId, UUID treatmentId, Change change) {
        access.requireMember(familyId);
        Treatment t = Treatment.lockInFamily(familyId, treatmentId)
                .orElseThrow(() -> ApiException.notFound("Tratamento"));
        if (t.version != change.baseVersion()) {
            throw new VersionConflictException("O tratamento", t.version);
        }
        return t;
    }

    /**
     * Mudanças só valem do presente em diante; o passado registrado não é
     * reescrito. Um rascunho pode ser ativado com início até 24 h no passado,
     * para registrar doses do mesmo dia dadas antes do cadastro.
     */
    private static void requireEffectiveFrom(Treatment t, Change change) {
        Instant now = Instant.now();
        if (t.status == Treatment.Status.DRAFT) {
            if (change.effectiveFrom().isBefore(now.minus(MAX_ACTIVATION_BACKDATE))) {
                throw ApiException.unprocessable("EFFECTIVE_FROM_IN_PAST",
                        "A agenda pode começar no máximo 24 horas antes da ativação.");
            }
        } else if (change.effectiveFrom().isBefore(now.minus(CLOCK_SKEW))) {
            throw ApiException.unprocessable("EFFECTIVE_FROM_IN_PAST",
                    "A alteração de um tratamento já ativado não pode valer para o passado.");
        }
    }

    private void restartSchedule(Treatment t, Change change, String reason) {
        stopSchedule(t, change, reason);
        schedules.start(t, change.effectiveFrom());
    }

    private void stopSchedule(Treatment t, Change change, String reason) {
        int cancelled = schedules.stop(t, change.effectiveFrom(), currentUser.id(), reason);
        if (cancelled > 0) {
            audit.record(t.familyId, currentUser.id(), TREATMENT, t.id, "OCCURRENCES_CANCELLED", null,
                    Map.of("count", cancelled, "from", change.effectiveFrom().toString()), reason);
        }
    }

    private static boolean affectsSchedule(Map<String, Object> before, Map<String, Object> after) {
        return !Objects.equals(before.get("schedule"), after.get("schedule"))
                || !Objects.equals(before.get("startAt"), after.get("startAt"))
                || !Objects.equals(before.get("endAt"), after.get("endAt"));
    }

    private static ApiException scheduleRequired() {
        return ApiException.unprocessable("SCHEDULE_REQUIRED",
                "Defina a agenda (horários) antes de ativar o tratamento.");
    }

    private Treatment commitVersion(Treatment t, Map<String, Object> before, Change change, String eventType) {
        UUID actor = currentUser.id();
        Instant now = Instant.now();
        t.version = change.baseVersion() + 1;
        t.updatedBy = actor;
        t.updatedAt = now;
        Map<String, Object> after = snapshot(t);
        String reason = Texts.clean(change.reason());
        saveRevision(t, change.baseVersion(), after, change.effectiveFrom(), reason, now);
        audit.record(t.familyId, actor, TREATMENT, t.id, eventType, before, after, reason);
        audit.publish(t.familyId, eventType, TREATMENT, t.id, event(t));
        return t;
    }

    private void saveRevision(Treatment t, Long baseVersion, Map<String, Object> snapshot, Instant effectiveFrom,
            String reason, Instant now) {
        TreatmentRevision r = new TreatmentRevision();
        r.id = UUID.randomUUID();
        r.treatmentId = t.id;
        r.version = t.version;
        r.baseVersion = baseVersion;
        r.snapshot = snapshot;
        r.effectiveFrom = effectiveFrom;
        r.changeReason = reason;
        r.createdBy = currentUser.id();
        r.createdAt = now;
        r.persist();
    }

    private static void validate(TreatmentData data) {
        if (data.endAt() != null && !data.endAt().isAfter(data.startAt())) {
            throw ApiException.unprocessable("INVALID_PERIOD", "O término deve ser posterior ao início.");
        }
    }

    private void apply(Treatment t, TreatmentData data) {
        t.scheduleRule = data.schedule() == null ? null : schedules.toStored(data.schedule().normalized());
        t.name = Texts.clean(data.name());
        t.kind = data.kind();
        t.prescribedDose = Texts.clean(data.prescribedDose());
        t.route = Texts.clean(data.route());
        t.instructions = Texts.clean(data.instructions());
        t.startAt = data.startAt();
        t.endAt = data.endAt();
    }

    private static boolean sameContent(Map<String, Object> a, Map<String, Object> b) {
        return a.keySet().stream().allMatch(k -> Objects.equals(a.get(k), b.get(k)));
    }

    private static Map<String, Object> snapshot(Treatment t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("personId", t.personId.toString());
        m.put("name", t.name);
        m.put("kind", t.kind.name());
        m.put("prescribedDose", t.prescribedDose);
        m.put("route", t.route);
        m.put("instructions", t.instructions);
        m.put("status", t.status.name());
        m.put("startAt", t.startAt.toString());
        m.put("endAt", t.endAt == null ? null : t.endAt.toString());
        m.put("schedule", t.scheduleRule);
        m.put("version", t.version);
        return m;
    }

    /** Payload do outbox: só identificadores, sem dados de saúde (seção 12). */
    private static Map<String, Object> event(Treatment t) {
        return Map.of("treatmentId", t.id, "personId", t.personId, "version", t.version);
    }
}
