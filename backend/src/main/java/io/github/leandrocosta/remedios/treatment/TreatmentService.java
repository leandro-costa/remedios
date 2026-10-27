package io.github.leandrocosta.remedios.treatment;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ClientIds;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.Texts;
import io.github.leandrocosta.remedios.common.VersionConflictException;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.schedule.ScheduleRule;
import io.github.leandrocosta.remedios.schedule.ScheduleService;
import io.github.leandrocosta.remedios.occurrence.OccurrenceService;
import io.github.leandrocosta.remedios.sync.SyncConflict;
import io.github.leandrocosta.remedios.sync.SyncConflictChange;
import io.github.leandrocosta.remedios.sync.SyncOperation;
import io.github.leandrocosta.remedios.user.CurrentUser;
import io.github.leandrocosta.remedios.user.DeviceService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Cadastro e versionamento de tratamentos (seções 4.5, 10.2 e 11.1). Cada
 * alteração aceita gera nova versão, revisão, auditoria e evento de outbox na
 * mesma transação. Online, uma versão-base desatualizada é rejeitada sem aplicar
 * nada. Vinda da fila offline, a alteração é preservada como conflito para um
 * responsável conferir, e o tratamento não muda até a conferência (seção 10.2).
 */
@ApplicationScoped
public class TreatmentService {

    static final String TREATMENT = "TREATMENT";

    /** Tolerância para relógios de dispositivos ligeiramente atrasados. */
    private static final Duration CLOCK_SKEW = Duration.ofMinutes(5);
    /**
     * Ao ativar um rascunho, a agenda pode começar no máximo este tempo no
     * passado (tratamento já em andamento quando foi cadastrado).
     */
    static final Duration MAX_ACTIVATION_BACKDATE = Duration.ofDays(30);
    private static final String CONFLICT_REASON = "Alteração feita sem conexão sobre uma versão anterior do tratamento";

    public record TreatmentData(String name, Treatment.Kind kind, String prescribedDose, String route,
            String instructions, Instant startAt, Instant endAt, ScheduleRule schedule) {
    }

    public record Change(long baseVersion, Instant effectiveFrom, String reason) {
    }

    /**
     * Alteração vinda da fila offline: o aparelho, a chave da operação e o
     * pedido completo, guardado como proposta se houver conflito.
     */
    public record Offline(UUID deviceId, UUID operationKey, Map<String, Object> request) {
    }

    /** Doses anteriores a agora ao ativar um tratamento que começou no passado. */
    public enum PastDoses {
        /** Ficam em aberto, para registrar uma a uma. */
        OPEN,
        /** O responsável informou que todas foram dadas nos horários previstos. */
        ADMINISTERED
    }

    /** Aplicada, ou preservada para conferência ({@code conflictId}). */
    public record Outcome(Treatment treatment, UUID conflictId) {
    }

    public enum Choice { KEEP_CURRENT, ADOPT }

    public record Resolution(UUID conflictId, Choice choice, UUID proposalId, long baseVersion, String reason) {
    }

    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final AuditService audit;
    private final ScheduleService schedules;
    private final OccurrenceService occurrences;
    private final DeviceService devices;
    private final ObjectMapper json;

    public TreatmentService(CurrentUser currentUser, FamilyAccess access, AuditService audit,
            ScheduleService schedules, OccurrenceService occurrences, DeviceService devices, ObjectMapper json) {
        this.currentUser = currentUser;
        this.access = access;
        this.audit = audit;
        this.schedules = schedules;
        this.occurrences = occurrences;
        this.devices = devices;
        this.json = json;
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
    public Treatment create(UUID familyId, UUID requestedId, UUID personId, TreatmentData data) {
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
        t.id = ClientIds.choose(requestedId, id -> Treatment.findById(id) != null);
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
        return update(familyId, treatmentId, data, change, null).treatment();
    }

    @Transactional
    public Outcome update(UUID familyId, UUID treatmentId, TreatmentData data, Change change, Offline offline) {
        Treatment t = lock(familyId, treatmentId);
        Optional<UUID> preserved = checkVersion(t, change, offline, "UPDATE");
        if (preserved.isPresent()) {
            return new Outcome(t, preserved.get());
        }
        return new Outcome(applyUpdate(t, data, effective(t, change, offline)), null);
    }

    @Transactional
    public Treatment changeStatus(UUID familyId, UUID treatmentId, Treatment.Status target, Change change) {
        return changeStatus(familyId, treatmentId, target, change, PastDoses.OPEN, null, null).treatment();
    }

    /**
     * Muda a situação. Ao ativar um rascunho que começa no passado, as doses
     * anteriores a agora ficam em aberto ou, se o responsável informar que
     * foram todas dadas, são registradas nos horários previstos.
     */
    @Transactional
    public Outcome changeStatus(UUID familyId, UUID treatmentId, Treatment.Status target, Change change,
            PastDoses pastDoses, UUID deviceId, Offline offline) {
        Treatment t = lock(familyId, treatmentId);
        Optional<UUID> preserved = checkVersion(t, change, offline, "STATUS");
        if (preserved.isPresent()) {
            return new Outcome(t, preserved.get());
        }
        return new Outcome(applyStatus(t, target, effective(t, change, offline), pastDoses, deviceId), null);
    }

    /** Alterações preservadas aguardando conferência, por tratamento. */
    public Map<UUID, UUID> openConflicts(UUID familyId) {
        access.requireMember(familyId);
        Map<UUID, UUID> open = new HashMap<>();
        SyncConflict.<SyncConflict>list("familyId = ?1 and entityType = ?2 and status = ?3", familyId, TREATMENT,
                SyncConflict.Status.OPEN).forEach(c -> open.put(c.entityId, c.id));
        return open;
    }

    public List<SyncConflict> conflicts(UUID familyId) {
        access.requireMember(familyId);
        return SyncConflict.list("familyId = ?1 and entityType = ?2 and status = ?3 order by createdAt", familyId,
                TREATMENT, SyncConflict.Status.OPEN);
    }

    /**
     * Conferência de um conflito (seção 10.2): manter a versão atual ou
     * aplicar uma das propostas sobre ela. Se o tratamento mudou durante a
     * conferência, nada é feito e é preciso conferir de novo.
     */
    @Transactional
    public Treatment resolve(UUID familyId, UUID treatmentId, Resolution r) {
        Treatment t = lock(familyId, treatmentId);
        SyncConflict conflict = SyncConflict.findOpen(TREATMENT, t.id).filter(c -> c.id.equals(r.conflictId()))
                .orElseThrow(() -> ApiException.conflict("CONFLICT_NOT_OPEN", "Esta conferência já foi concluída."));
        if (t.version != r.baseVersion()) {
            throw new VersionConflictException("O tratamento", t.version);
        }
        String reason = Texts.clean(r.reason());
        if (reason == null) {
            throw ApiException.unprocessable("REASON_REQUIRED", "Informe o motivo da decisão.");
        }
        SyncConflictChange adopted = null;
        if (r.choice() == Choice.ADOPT) {
            adopted = SyncConflictChange.<SyncConflictChange>findByIdOptional(r.proposalId())
                    .filter(c -> c.conflictId.equals(conflict.id))
                    .orElseThrow(() -> ApiException.unprocessable("PROPOSAL_NOT_FOUND",
                            "A proposta escolhida não faz parte desta conferência."));
        }
        Instant now = Instant.now();
        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("choice", r.choice().name());
        resolution.put("proposalId", adopted == null ? null : adopted.id.toString());
        resolution.put("reason", reason);
        conflict.status = SyncConflict.Status.RESOLVED;
        conflict.resolution = resolution;
        conflict.resolvedBy = currentUser.id();
        conflict.resolvedAt = now;
        audit.record(familyId, currentUser.id(), TREATMENT, t.id, "TREATMENT_CONFLICT_RESOLVED", null, resolution,
                reason);
        if (adopted == null) {
            return t;
        }
        Map<String, Object> p = adopted.proposedData;
        // A proposta vale a partir de agora, sobre a versão atual.
        Instant proposedFrom = p.get("effectiveFrom") == null ? now : Instant.parse((String) p.get("effectiveFrom"));
        Instant from = t.status == Treatment.Status.DRAFT ? proposedFrom : now;
        Change change = new Change(t.version, from, "Conferência: " + reason);
        if ("STATUS".equals(p.get("action"))) {
            Treatment.Status target = Treatment.Status.valueOf((String) p.get("status"));
            PastDoses past = p.get("pastDoses") == null ? PastDoses.OPEN : PastDoses.valueOf((String) p.get("pastDoses"));
            UUID device = p.get("deviceId") == null ? null : UUID.fromString((String) p.get("deviceId"));
            return applyStatus(t, target, change, past, device);
        }
        return applyUpdate(t, json.convertValue(p, TreatmentData.class), change);
    }

    // --- Auxiliares -----------------------------------------------------------

    private Treatment applyUpdate(Treatment t, TreatmentData data, Change change) {
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

    private Treatment applyStatus(Treatment t, Treatment.Status target, Change change, PastDoses pastDoses,
            UUID deviceId) {
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
        boolean recordPast = pastDoses == PastDoses.ADMINISTERED && t.status == Treatment.Status.DRAFT
                && target == Treatment.Status.ACTIVE;
        if (recordPast) {
            devices.requireActive(deviceId);
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
        Treatment result = commitVersion(t, before, change, "TREATMENT_STATUS_CHANGED");
        if (recordPast) {
            occurrences.recordPastAsAdministered(t.familyId, t.id, deviceId, Instant.now());
        }
        return result;
    }

    private Treatment lock(UUID familyId, UUID treatmentId) {
        access.requireMember(familyId);
        return Treatment.lockInFamily(familyId, treatmentId).orElseThrow(() -> ApiException.notFound("Tratamento"));
    }

    /**
     * Versão-base desatualizada ou conferência pendente: online, recusa; da
     * fila offline, preserva a proposta no conflito do tratamento.
     */
    private Optional<UUID> checkVersion(Treatment t, Change change, Offline offline, String action) {
        Optional<SyncConflict> open = SyncConflict.findOpen(TREATMENT, t.id);
        boolean stale = t.version != change.baseVersion();
        if (!stale && open.isEmpty()) {
            return Optional.empty();
        }
        if (offline == null) {
            if (open.isPresent()) {
                throw ApiException.conflict("TREATMENT_IN_REVIEW",
                        "Há alterações deste tratamento aguardando conferência. Confira antes de alterar.",
                        Map.of("conflictId", open.get().id));
            }
            throw new VersionConflictException("O tratamento", t.version);
        }
        return Optional.of(preserve(t, change, offline, action, open.orElse(null)));
    }

    private UUID preserve(Treatment t, Change change, Offline offline, String action, SyncConflict conflict) {
        devices.requireActive(offline.deviceId());
        UUID actor = currentUser.id();
        Instant now = Instant.now();
        Map<String, Object> proposal = new LinkedHashMap<>(offline.request());
        proposal.put("action", action);
        proposal.put("deviceId", offline.deviceId().toString());

        SyncOperation op = new SyncOperation();
        op.id = UUID.randomUUID();
        op.familyId = t.familyId;
        op.deviceId = offline.deviceId();
        op.actorId = actor;
        op.operationKey = offline.operationKey();
        op.operationType = "TREATMENT_" + action;
        op.entityType = TREATMENT;
        op.entityId = t.id;
        op.baseVersion = change.baseVersion();
        op.payload = proposal;
        op.receivedAt = now;
        op.finish(SyncOperation.Status.CONFLICT, null);
        op.persist();

        if (conflict == null) {
            conflict = new SyncConflict();
            conflict.id = UUID.randomUUID();
            conflict.familyId = t.familyId;
            conflict.entityType = TREATMENT;
            conflict.entityId = t.id;
            conflict.baseVersion = change.baseVersion();
            conflict.status = SyncConflict.Status.OPEN;
            conflict.reason = CONFLICT_REASON;
            conflict.details = snapshot(t);
            conflict.createdAt = now;
            conflict.persist();
        }
        SyncConflictChange preserved = new SyncConflictChange();
        preserved.id = UUID.randomUUID();
        preserved.conflictId = conflict.id;
        preserved.operationId = op.id;
        preserved.baseVersion = change.baseVersion();
        preserved.proposedData = proposal;
        preserved.createdAt = now;
        preserved.persist();

        audit.record(t.familyId, actor, TREATMENT, t.id, "TREATMENT_CONFLICT_OPENED", snapshot(t), proposal,
                conflict.reason);
        audit.publish(t.familyId, "TREATMENT_CONFLICT_OPENED", TREATMENT, t.id, event(t));
        return conflict.id;
    }

    /**
     * Uma alteração feita offline chega depois; o que ela pedia "a partir de
     * agora" passa a valer a partir do envio (o passado registrado não muda).
     */
    private static Change effective(Treatment t, Change change, Offline offline) {
        if (offline != null && t.status != Treatment.Status.DRAFT
                && change.effectiveFrom().isBefore(Instant.now().minus(CLOCK_SKEW))) {
            return new Change(change.baseVersion(), Instant.now(), change.reason());
        }
        return change;
    }

    /**
     * Mudanças só valem do presente em diante; o passado registrado não é
     * reescrito. Um rascunho pode ser ativado com início até 30 dias no
     * passado, para um tratamento que já estava em andamento.
     */
    private static void requireEffectiveFrom(Treatment t, Change change) {
        Instant now = Instant.now();
        if (t.status == Treatment.Status.DRAFT) {
            if (change.effectiveFrom().isBefore(now.minus(MAX_ACTIVATION_BACKDATE))) {
                throw ApiException.unprocessable("EFFECTIVE_FROM_IN_PAST",
                        "A agenda pode começar no máximo 30 dias antes da ativação.");
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
