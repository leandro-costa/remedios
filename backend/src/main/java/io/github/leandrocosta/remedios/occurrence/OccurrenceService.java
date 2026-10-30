package io.github.leandrocosta.remedios.occurrence;

import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.ClientIds;
import io.github.leandrocosta.remedios.common.Texts;
import io.github.leandrocosta.remedios.common.VersionConflictException;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.sync.SyncConflict;
import io.github.leandrocosta.remedios.sync.SyncConflictChange;
import io.github.leandrocosta.remedios.sync.SyncOperation;
import io.github.leandrocosta.remedios.treatment.Treatment;
import io.github.leandrocosta.remedios.user.AppUser;
import io.github.leandrocosta.remedios.user.CurrentUser;
import io.github.leandrocosta.remedios.user.DeviceService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Registro de desfechos das doses (seções 4.2 a 4.4 e 11.2). Cada mudança
 * grava auditoria e outbox na mesma transação. O sistema nunca presume uma
 * administração nem sugere dose substituta.
 */
@ApplicationScoped
public class OccurrenceService {

    static final String ENTITY = "DOSE_OCCURRENCE";

    /** Tolerância para relógios de dispositivos ligeiramente adiantados. */
    private static final Duration CLOCK_SKEW = Duration.ofMinutes(5);
    private static final Duration MAX_RANGE = Duration.ofDays(62);
    static final int MAX_HISTORY = 500;

    /** {@code CANCELLED}: dose "se necessário" registrada por engano. */
    public enum CorrectionTarget { ADMINISTERED, NOT_ADMINISTERED, OPEN, CANCELLED }

    public record Correction(long baseVersion, CorrectionTarget status, Instant administeredAt, String notes,
            String reason, UUID deviceId) {
    }

    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final DeviceService devices;
    private final AuditService audit;
    private final EntityManager em;
    private final Duration maxAdvance;
    private final Duration claimDuration;

    public OccurrenceService(CurrentUser currentUser, FamilyAccess access, DeviceService devices, AuditService audit,
            EntityManager em, @ConfigProperty(name = "remedios.administration.max-advance") Duration maxAdvance,
            @ConfigProperty(name = "remedios.reminders.claim") Duration claimDuration) {
        this.claimDuration = claimDuration;
        this.currentUser = currentUser;
        this.access = access;
        this.devices = devices;
        this.audit = audit;
        this.em = em;
        this.maxAdvance = maxAdvance;
    }

    // --- Consultas ------------------------------------------------------------

    /** Agenda de um período (tela Hoje): todas as doses com horário em [from, to). */
    public List<DoseOccurrence> agenda(UUID familyId, Instant from, Instant to, UUID personId, UUID treatmentId) {
        access.requireMember(familyId);
        requireRange(from, to);
        return query(familyId, from, to, personId, treatmentId, null, null, "o.scheduledAt, o.slotKey", 0);
    }

    /** Histórico (seção 7.4): doses com desfecho registrado, mais recentes primeiro. */
    public List<DoseOccurrence> history(UUID familyId, Instant from, Instant to, UUID personId, UUID treatmentId,
            UUID recordedBy, int limit) {
        access.requireMember(familyId);
        requireRange(from, to);
        return query(familyId, from, to, personId, treatmentId, recordedBy,
                List.of(DoseOccurrence.Status.ADMINISTERED, DoseOccurrence.Status.NOT_ADMINISTERED,
                        DoseOccurrence.Status.REVIEW_REQUIRED),
                "o.scheduledAt desc, o.slotKey desc", Math.clamp(limit, 1, MAX_HISTORY));
    }

    public DoseOccurrence get(UUID familyId, UUID occurrenceId) {
        access.requireMember(familyId);
        return DoseOccurrence.findInFamily(familyId, occurrenceId).orElseThrow(() -> ApiException.notFound("Dose"));
    }

    // --- Desfechos ------------------------------------------------------------

    /** Nota das administrações informadas ao ativar um tratamento já em andamento. */
    static final String PAST_DOSES_NOTE = "Informada como dada ao cadastrar o tratamento (horário previsto).";

    /**
     * Ao ativar um tratamento que começou no passado, o responsável pode
     * informar que as doses anteriores a agora foram todas dadas. Cada uma é
     * registrada no horário previsto, com nota e auditoria; o sistema só
     * registra o que o responsável afirmou (seção 1).
     */
    @Transactional(Transactional.TxType.MANDATORY)
    public int recordPastAsAdministered(UUID familyId, UUID treatmentId, UUID deviceId, Instant now) {
        return recordPastAsAdministered(familyId, treatmentId, null, deviceId, now);
    }

    /** Idem, só as doses de uma versão de agenda (ex.: o período acrescentado ao antecipar o início). */
    @Transactional(Transactional.TxType.MANDATORY)
    public int recordPastAsAdministered(UUID familyId, UUID treatmentId, UUID scheduleId, UUID deviceId,
            Instant now) {
        String query = "familyId = ?1 and treatmentId = ?2 and status = ?3 and scheduledAt <= ?4";
        List<DoseOccurrence> past = scheduleId == null
                ? DoseOccurrence.list(query + " order by scheduledAt", familyId, treatmentId,
                        DoseOccurrence.Status.SCHEDULED, now)
                : DoseOccurrence.list(query + " and scheduleId = ?5 order by scheduledAt", familyId, treatmentId,
                        DoseOccurrence.Status.SCHEDULED, now, scheduleId);
        for (DoseOccurrence o : past) {
            AdministrationRecord r = newRecord(o, deviceId, o.scheduledAt, PAST_DOSES_NOTE, now);
            r.persist();
            close(o, DoseOccurrence.Status.ADMINISTERED, null, now);
            audit.record(familyId, currentUser.id(), ENTITY, o.id, "DOSE_ADMINISTERED", null, recordData(o, r),
                    PAST_DOSES_NOTE);
        }
        if (!past.isEmpty()) {
            // Um único aviso para a família, não um por dose.
            audit.publish(familyId, "PAST_DOSES_RECORDED", ENTITY, treatmentId,
                    Map.of("treatmentId", treatmentId, "count", past.size()));
        }
        return past.size();
    }

    /**
     * Dose de um tratamento "se necessário": registrada quando é dada, vira
     * uma ocorrência já administrada, sem agenda. O id vem do aparelho (pode
     * ter sido registrada offline). Uma dose dada é aceita mesmo que o
     * tratamento tenha sido suspenso ou encerrado enquanto o aparelho estava
     * sem conexão: o registro do que aconteceu não se perde.
     */
    @Transactional
    public DoseOccurrence recordAsNeeded(UUID familyId, UUID treatmentId, UUID requestedId, UUID deviceId,
            Instant administeredAt, String notes, Instant recordedAt) {
        access.requireMember(familyId);
        devices.requireActive(deviceId);
        Treatment t = Treatment.lockInFamily(familyId, treatmentId)
                .orElseThrow(() -> ApiException.notFound("Tratamento"));
        if (t.kind != Treatment.Kind.AS_NEEDED) {
            throw ApiException.unprocessable("NOT_AS_NEEDED",
                    "Este tratamento tem horários: registre a dose pela agenda.");
        }
        if (t.status == Treatment.Status.DRAFT) {
            throw ApiException.conflict("TREATMENT_NOT_ACTIVE", "Ative o tratamento antes de registrar doses.");
        }
        Instant now = Instant.now();
        Instant tapped = recordedAt == null || recordedAt.isAfter(now) ? now : recordedAt;
        Instant at = administeredAt == null ? tapped : administeredAt;
        requireNotFuture(at, now);

        DoseOccurrence o = new DoseOccurrence();
        o.id = ClientIds.choose(requestedId, id -> DoseOccurrence.findById(id) != null);
        o.familyId = familyId;
        o.treatmentId = t.id;
        o.slotKey = "prn:" + o.id;
        o.scheduledAt = at;
        o.status = DoseOccurrence.Status.ADMINISTERED;
        o.version = 1;
        o.statusChangedBy = currentUser.id();
        o.statusChangedAt = now;
        o.createdAt = now;
        o.updatedAt = now;
        o.persist();
        AdministrationRecord r = newRecord(o, deviceId, at, notes, now);
        r.recordedAt = tapped;
        r.persist();
        audit.record(familyId, currentUser.id(), ENTITY, o.id, "DOSE_ADMINISTERED", null, recordData(o, r), null);
        audit.publish(familyId, "DOSE_ADMINISTERED", ENTITY, o.id, event(o));
        return o;
    }

    /**
     * Metadados de uma operação vinda de um aparelho (seção 10.1). Quando
     * presentes, tornam o envio idempotente e permitem detectar divergências:
     * {@code baseVersion} é a versão da dose que o responsável viu ao tocar no
     * botão, e {@code recordedAt}, quando tocou (pode ser bem antes do envio,
     * se o aparelho estava offline).
     */
    public record Operation(UUID operationId, Long baseVersion, Instant recordedAt) {
    }

    public enum Report { ADMINISTER, MARK_NOT_ADMINISTERED }

    @Transactional
    public DoseOccurrence administer(UUID familyId, UUID occurrenceId, UUID deviceId, Instant administeredAt,
            String notes, Operation op) {
        Map<String, Object> proposal = new LinkedHashMap<>();
        proposal.put("administeredAt", administeredAt == null ? null : administeredAt.toString());
        proposal.put("notes", Texts.clean(notes));
        return report(familyId, occurrenceId, Report.ADMINISTER, deviceId, proposal, op);
    }

    @Transactional
    public DoseOccurrence markNotAdministered(UUID familyId, UUID occurrenceId, String reason, UUID deviceId,
            Operation op) {
        Map<String, Object> proposal = new LinkedHashMap<>();
        proposal.put("reason", Texts.clean(reason));
        return report(familyId, occurrenceId, Report.MARK_NOT_ADMINISTERED, deviceId, proposal, op);
    }

    /**
     * Registra o desfecho informado por um responsável.
     *
     * <ul>
     * <li>Dose em aberto: aplica.</li>
     * <li>Dose já decidida que o responsável ainda via em aberto
     * ({@code baseVersion} antiga, típico de registro offline): se os
     * registros divergem, a dose vai para revisão ({@code REVIEW_REQUIRED}) e
     * a proposta é preservada; nada é descartado (seção 10.3). Se coincidem
     * (duas pessoas marcaram "não foi dada"), não há o que fazer.</li>
     * <li>Dose já decidida e o responsável sabia disso: recusa (409).</li>
     * </ul>
     */
    private DoseOccurrence report(UUID familyId, UUID occurrenceId, Report kind, UUID deviceId,
            Map<String, Object> proposal, Operation op) {
        access.requireMember(familyId);
        boolean tracked = op != null && op.operationId() != null;
        if (kind == Report.ADMINISTER || tracked) {
            devices.requireActive(deviceId);
        }
        DoseOccurrence o = DoseOccurrence.lockInFamily(familyId, occurrenceId)
                .orElseThrow(() -> ApiException.notFound("Dose"));
        Instant now = Instant.now();

        if (tracked) {
            SyncOperation previous = SyncOperation.find(deviceId, op.operationId()).orElse(null);
            if (previous != null) {
                if (!previous.actorId.equals(currentUser.id()) || !previous.entityId.equals(o.id)) {
                    throw ApiException.conflict("OPERATION_ID_IN_USE",
                            "Este identificador de operação já foi usado para outra ação.");
                }
                return o; // reenvio: os efeitos já foram aplicados
            }
        }
        Instant recordedAt = op == null || op.recordedAt() == null || op.recordedAt().isAfter(now) ? now
                : op.recordedAt();
        proposal.put("type", kind.name());
        proposal.put("recordedBy", currentUser.id().toString());
        proposal.put("deviceId", deviceId == null ? null : deviceId.toString());
        proposal.put("recordedAt", recordedAt.toString());

        SyncOperation sync = tracked ? newOperation(o, kind, deviceId, op, proposal, now) : null;

        if (o.isOpen()) {
            requireNotTooEarly(o, recordedAt);
            apply(o, kind, deviceId, proposal, recordedAt, sync, now);
            if (sync != null) {
                sync.finish(SyncOperation.Status.APPLIED, null);
            }
            return o;
        }
        boolean sawItOpen = tracked && op.baseVersion() != null && op.baseVersion() < o.version;
        if (!sawItOpen) {
            throw closedError(o);
        }
        if (agrees(o, kind)) {
            sync.finish(SyncOperation.Status.APPLIED, Map.of("outcome", "ALREADY_IN_THIS_STATE"));
            return o;
        }
        openConflict(o, sync, proposal, op.baseVersion(), now);
        sync.finish(SyncOperation.Status.CONFLICT, null);
        return o;
    }

    private void apply(DoseOccurrence o, Report kind, UUID deviceId, Map<String, Object> proposal,
            Instant recordedAt, SyncOperation sync, Instant now) {
        if (kind == Report.ADMINISTER) {
            Object given = proposal.get("administeredAt");
            Instant at = given == null ? recordedAt : Instant.parse((String) given);
            requireNotFuture(at, now);
            AdministrationRecord r = newRecord(o, deviceId, at, (String) proposal.get("notes"), now);
            r.recordedAt = recordedAt;
            r.syncOperationId = sync == null ? null : sync.id;
            r.persist();
            close(o, DoseOccurrence.Status.ADMINISTERED, null, now);
            audit.record(o.familyId, currentUser.id(), ENTITY, o.id, "DOSE_ADMINISTERED", null, recordData(o, r),
                    null);
            audit.publish(o.familyId, "DOSE_ADMINISTERED", ENTITY, o.id, event(o));
        } else {
            close(o, DoseOccurrence.Status.NOT_ADMINISTERED, (String) proposal.get("reason"), now);
            audit.record(o.familyId, currentUser.id(), ENTITY, o.id, "DOSE_NOT_ADMINISTERED", null, stateData(o),
                    o.statusReason);
            audit.publish(o.familyId, "DOSE_NOT_ADMINISTERED", ENTITY, o.id, event(o));
        }
    }

    /** O desfecho informado coincide com o já registrado? */
    private static boolean agrees(DoseOccurrence o, Report kind) {
        return kind == Report.MARK_NOT_ADMINISTERED
                && (o.status == DoseOccurrence.Status.NOT_ADMINISTERED || o.status == DoseOccurrence.Status.CANCELLED);
    }

    private void openConflict(DoseOccurrence o, SyncOperation sync, Map<String, Object> proposal, Long baseVersion,
            Instant now) {
        SyncConflict conflict = SyncConflict.findOpen(ENTITY, o.id).orElse(null);
        Map<String, Object> before = stateData(o);
        if (conflict == null) {
            conflict = new SyncConflict();
            conflict.id = UUID.randomUUID();
            conflict.familyId = o.familyId;
            conflict.entityType = ENTITY;
            conflict.entityId = o.id;
            conflict.baseVersion = baseVersion;
            conflict.status = SyncConflict.Status.OPEN;
            conflict.reason = "Registros divergentes para a mesma dose";
            conflict.details = stateData(o);
            conflict.createdAt = now;
            conflict.persist();
        }
        SyncConflictChange change = new SyncConflictChange();
        change.id = UUID.randomUUID();
        change.conflictId = conflict.id;
        change.operationId = sync.id;
        change.baseVersion = baseVersion;
        change.proposedData = proposal;
        change.createdAt = now;
        change.persist();

        if (o.status != DoseOccurrence.Status.REVIEW_REQUIRED) {
            close(o, DoseOccurrence.Status.REVIEW_REQUIRED, "Registros divergentes: confira antes de decidir.", now);
        } else {
            o.version++;
            o.updatedAt = now;
        }
        audit.record(o.familyId, currentUser.id(), ENTITY, o.id, "DOSE_CONFLICT_OPENED", before, proposal,
                conflict.reason);
        audit.publish(o.familyId, "DOSE_CONFLICT_OPENED", ENTITY, o.id, event(o));
    }

    // --- "Estou cuidando desta dose" --------------------------------------------

    /** Avisa os outros responsáveis que alguém está cuidando da dose; reduz os lembretes deles. */
    @Transactional
    public DoseOccurrence claim(UUID familyId, UUID occurrenceId) {
        access.requireMember(familyId);
        DoseOccurrence o = DoseOccurrence.lockInFamily(familyId, occurrenceId)
                .orElseThrow(() -> ApiException.notFound("Dose"));
        if (!o.isOpen()) {
            throw closedError(o);
        }
        Instant now = Instant.now();
        if (o.claimedBy != null && !o.claimedBy.equals(currentUser.id()) && o.claimedUntil.isAfter(now)) {
            AppUser by = AppUser.findById(o.claimedBy);
            throw ApiException.conflict("ALREADY_CLAIMED", by.displayName + " já está cuidando desta dose.",
                    Map.of("claimedBy", Map.of("id", by.id, "displayName", by.displayName),
                            "claimedUntil", o.claimedUntil.toString()));
        }
        o.claimedBy = currentUser.id();
        o.claimedUntil = now.plus(claimDuration);
        audit.record(familyId, currentUser.id(), ENTITY, o.id, "DOSE_CLAIMED", null,
                Map.of("claimedUntil", o.claimedUntil.toString()), null);
        return o;
    }

    @Transactional
    public DoseOccurrence releaseClaim(UUID familyId, UUID occurrenceId) {
        access.requireMember(familyId);
        DoseOccurrence o = DoseOccurrence.lockInFamily(familyId, occurrenceId)
                .orElseThrow(() -> ApiException.notFound("Dose"));
        if (currentUser.id().equals(o.claimedBy)) {
            o.claimedBy = null;
            o.claimedUntil = null;
        }
        return o;
    }

    /** Limite do adiamento de um lembrete. */
    static final Duration MAX_SNOOZE = Duration.ofHours(12);

    /**
     * "Lembrar daqui a pouco": adia só o lembrete desta dose para quem pediu.
     * O horário da dose e as próximas doses não mudam. Vindo da fila offline
     * depois do horário pedido, ou com a dose já decidida, não há o que adiar
     * e nada muda.
     */
    @Transactional
    public DoseOccurrence snooze(UUID familyId, UUID occurrenceId, Instant remindAt) {
        access.requireMember(familyId);
        DoseOccurrence o = DoseOccurrence.<DoseOccurrence>find("familyId = ?1 and id = ?2", familyId, occurrenceId)
                .firstResultOptional().orElseThrow(() -> ApiException.notFound("Dose"));
        Instant now = Instant.now();
        if (remindAt.isAfter(now.plus(MAX_SNOOZE))) {
            throw ApiException.unprocessable("SNOOZE_TOO_LONG", "O lembrete pode ser adiado por até 12 horas.");
        }
        if (!o.isOpen() || !remindAt.isAfter(now)) {
            return o;
        }
        int changed = em.createNativeQuery("""
                INSERT INTO reminder_snooze (dose_occurrence_id, user_id, remind_at)
                VALUES (:o, :u, :at)
                ON CONFLICT (dose_occurrence_id, user_id) DO UPDATE
                   SET remind_at = EXCLUDED.remind_at, times = reminder_snooze.times + 1, updated_at = now()
                 WHERE reminder_snooze.times < 100
                """)
                .setParameter("o", o.id).setParameter("u", currentUser.id()).setParameter("at", remindAt)
                .executeUpdate();
        if (changed == 0) {
            throw ApiException.unprocessable("SNOOZE_LIMIT", "O lembrete desta dose já foi adiado muitas vezes.");
        }
        return o;
    }

    /** Volta aos lembretes normais da agenda. */
    @Transactional
    public DoseOccurrence cancelSnooze(UUID familyId, UUID occurrenceId) {
        access.requireMember(familyId);
        DoseOccurrence o = DoseOccurrence.<DoseOccurrence>find("familyId = ?1 and id = ?2", familyId, occurrenceId)
                .firstResultOptional().orElseThrow(() -> ApiException.notFound("Dose"));
        // Mantém a linha: a contagem numera os próximos adiamentos no reminder_log.
        em.createNativeQuery("""
                UPDATE reminder_snooze SET remind_at = NULL, updated_at = now()
                 WHERE dose_occurrence_id = :o AND user_id = :u
                """)
                .setParameter("o", o.id).setParameter("u", currentUser.id()).executeUpdate();
        return o;
    }

    // --- Revisão de conflitos ---------------------------------------------------

    public enum Decision { ADMINISTERED, NOT_ADMINISTERED, CANCELLED }

    /**
     * Decisão humana sobre uma dose em revisão. {@code proposalId} adota os
     * dados de uma proposta preservada como a administração válida; sem ele, a
     * administração já registrada (se houver) é mantida.
     */
    public record Resolution(long baseVersion, Decision status, UUID proposalId, Instant administeredAt,
            UUID deviceId, String reason) {
    }

    public List<DoseOccurrence> openConflicts(UUID familyId) {
        access.requireMember(familyId);
        return DoseOccurrence.list("familyId = ?1 and status = ?2 and " + DoseOccurrence.NOT_DELETED
                + " order by scheduledAt desc", familyId,
                DoseOccurrence.Status.REVIEW_REQUIRED);
    }

    @Transactional
    public DoseOccurrence resolve(UUID familyId, UUID occurrenceId, Resolution r) {
        access.requireMember(familyId);
        DoseOccurrence o = DoseOccurrence.lockInFamily(familyId, occurrenceId)
                .orElseThrow(() -> ApiException.notFound("Dose"));
        if (o.status != DoseOccurrence.Status.REVIEW_REQUIRED) {
            throw ApiException.conflict("NO_CONFLICT", "Esta dose não está aguardando revisão.");
        }
        if (o.version != r.baseVersion()) {
            throw new VersionConflictException("A dose", o.version);
        }
        SyncConflict conflict = SyncConflict.findOpen(ENTITY, o.id).orElseThrow();
        String reason = Texts.clean(r.reason());
        Instant now = Instant.now();
        AdministrationRecord current = AdministrationRecord.findValid(o.id).orElse(null);
        Map<String, Object> before = current == null ? stateData(o) : recordData(o, current);

        SyncConflictChange adopted = null;
        if (r.proposalId() != null) {
            adopted = SyncConflictChange.<SyncConflictChange>findByIdOptional(r.proposalId())
                    .filter(c -> c.conflictId.equals(conflict.id))
                    .filter(c -> Report.ADMINISTER.name().equals(c.proposedData.get("type")))
                    .orElseThrow(() -> ApiException.unprocessable("INVALID_PROPOSAL",
                            "Escolha uma proposta de administração deste conflito."));
            if (r.status() != Decision.ADMINISTERED) {
                throw ApiException.unprocessable("INVALID_PROPOSAL",
                        "Adotar uma proposta só faz sentido ao confirmar a administração.");
            }
        }
        boolean replace = adopted != null || r.status() != Decision.ADMINISTERED;
        if (current != null && replace) {
            current.voidedAt = now;
            current.voidedBy = currentUser.id();
            current.voidReason = reason;
            em.flush();
        }

        Map<String, Object> after;
        if (r.status() == Decision.ADMINISTERED) {
            AdministrationRecord valid = current;
            if (adopted != null) {
                Map<String, Object> p = adopted.proposedData;
                valid = new AdministrationRecord();
                valid.id = UUID.randomUUID();
                valid.doseOccurrenceId = o.id;
                valid.recordedBy = UUID.fromString((String) p.get("recordedBy"));
                valid.deviceId = UUID.fromString((String) p.get("deviceId"));
                valid.syncOperationId = adopted.operationId;
                valid.recordedAt = Instant.parse((String) p.get("recordedAt"));
                valid.administeredAt = p.get("administeredAt") == null ? valid.recordedAt
                        : Instant.parse((String) p.get("administeredAt"));
                valid.receivedAt = adopted.createdAt;
                valid.notes = (String) p.get("notes");
                valid.persist();
            } else if (valid == null) {
                devices.requireActive(r.deviceId());
                Instant at = r.administeredAt() == null ? now : r.administeredAt();
                requireNotFuture(at, now);
                valid = newRecord(o, r.deviceId(), at, null, now);
                valid.persist();
            }
            close(o, DoseOccurrence.Status.ADMINISTERED, reason, now);
            after = recordData(o, valid);
        } else {
            close(o, r.status() == Decision.CANCELLED ? DoseOccurrence.Status.CANCELLED
                    : DoseOccurrence.Status.NOT_ADMINISTERED, reason, now);
            after = stateData(o);
        }

        conflict.status = SyncConflict.Status.RESOLVED;
        conflict.resolvedBy = currentUser.id();
        conflict.resolvedAt = now;
        Map<String, Object> resolution = new LinkedHashMap<>();
        resolution.put("status", r.status().name());
        resolution.put("proposalId", adopted == null ? null : adopted.id.toString());
        resolution.put("reason", reason);
        conflict.resolution = resolution;

        audit.record(familyId, currentUser.id(), ENTITY, o.id, "DOSE_CONFLICT_RESOLVED", before, after, reason);
        audit.publish(familyId, "DOSE_CONFLICT_RESOLVED", ENTITY, o.id, event(o));
        return o;
    }

    /**
     * Corrige o desfecho de uma dose (seção 4.4). O registro anterior é
     * invalidado e preservado; quando o resultado é uma administração, um novo
     * registro é criado. Exige motivo e a versão vista pelo responsável.
     */
    @Transactional
    public DoseOccurrence correct(UUID familyId, UUID occurrenceId, Correction c) {
        access.requireMember(familyId);
        String reason = Texts.clean(c.reason());
        DoseOccurrence o = DoseOccurrence.lockInFamily(familyId, occurrenceId)
                .orElseThrow(() -> ApiException.notFound("Dose"));
        if (o.version != c.baseVersion()) {
            throw new VersionConflictException("A dose", o.version);
        }
        if (o.status != DoseOccurrence.Status.ADMINISTERED && o.status != DoseOccurrence.Status.NOT_ADMINISTERED) {
            throw ApiException.conflict("NOTHING_TO_CORRECT", switch (o.status) {
                case CANCELLED -> "Doses canceladas não podem ser corrigidas.";
                case REVIEW_REQUIRED -> "Esta dose aguarda a revisão de um conflito.";
                default -> "Esta dose ainda não tem registro; registre a administração ou que ela não foi dada.";
            });
        }
        boolean asNeeded = o.scheduleId == null;
        if (asNeeded && (c.status() == CorrectionTarget.OPEN || c.status() == CorrectionTarget.NOT_ADMINISTERED)) {
            throw ApiException.unprocessable("AS_NEEDED_CORRECTION",
                    "Esta dose foi registrada quando foi dada. Se foi por engano, use \"Registrada por engano\".");
        }
        if (!asNeeded && c.status() == CorrectionTarget.CANCELLED) {
            throw ApiException.unprocessable("AS_NEEDED_CORRECTION",
                    "Só uma dose \"se necessário\" pode ser marcada como registrada por engano.");
        }
        if (c.status() == CorrectionTarget.NOT_ADMINISTERED && o.status == DoseOccurrence.Status.NOT_ADMINISTERED
                && java.util.Objects.equals(reason, o.statusReason)) {
            throw ApiException.unprocessable("NO_CHANGE", "A correção não altera o registro.");
        }

        Instant now = Instant.now();
        AdministrationRecord previous = AdministrationRecord.findValid(o.id).orElse(null);
        Map<String, Object> before = previous == null ? stateData(o) : recordData(o, previous);
        if (c.status() == CorrectionTarget.ADMINISTERED) {
            devices.requireActive(c.deviceId());
        }
        if (previous != null) {
            previous.voidedAt = now;
            previous.voidedBy = currentUser.id();
            previous.voidReason = reason;
            // O registro anterior precisa deixar de ser válido antes do novo ser inserido.
            em.flush();
        }

        Map<String, Object> after;
        switch (c.status()) {
            case ADMINISTERED -> {
                Instant at = c.administeredAt() != null ? c.administeredAt()
                        : previous != null ? previous.administeredAt : now;
                requireNotFuture(at, now);
                String notes = c.notes() != null ? c.notes() : previous == null ? null : previous.notes;
                AdministrationRecord r = newRecord(o, c.deviceId(), at, notes, now);
                r.persist();
                if (asNeeded) {
                    // Sem agenda, o horário da dose é o da administração.
                    o.scheduledAt = at;
                }
                close(o, DoseOccurrence.Status.ADMINISTERED, null, now);
                after = recordData(o, r);
            }
            case NOT_ADMINISTERED -> {
                close(o, DoseOccurrence.Status.NOT_ADMINISTERED, reason, now);
                after = stateData(o);
            }
            case OPEN -> {
                close(o, DoseOccurrence.Status.SCHEDULED, reason, now);
                after = stateData(o);
            }
            case CANCELLED -> {
                close(o, DoseOccurrence.Status.CANCELLED, reason, now);
                after = stateData(o);
            }
            default -> throw new IllegalStateException();
        }

        audit.record(familyId, currentUser.id(), ENTITY, o.id, "DOSE_CORRECTED", before, after, reason);
        audit.publish(familyId, "DOSE_CORRECTED", ENTITY, o.id, event(o));
        return o;
    }

    // --- Auxiliares -----------------------------------------------------------

    private ApiException closedError(DoseOccurrence o) {
        return switch (o.status) {
            case ADMINISTERED -> {
                AdministrationRecord r = AdministrationRecord.findValid(o.id).orElseThrow();
                AppUser by = AppUser.findById(r.recordedBy);
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("administeredAt", r.administeredAt.toString());
                details.put("recordedBy", Map.of("id", by.id, "displayName", by.displayName));
                yield ApiException.conflict("ALREADY_ADMINISTERED",
                        by.displayName + " já registrou esta dose. Confira antes de dar outra.", details);
            }
            case NOT_ADMINISTERED -> ApiException.conflict("ALREADY_RECORDED",
                    "Já foi registrado que esta dose não foi dada. Use a correção, se for o caso.");
            case CANCELLED -> ApiException.conflict("OCCURRENCE_CANCELLED",
                    "Esta dose foi cancelada por uma alteração do tratamento.");
            case REVIEW_REQUIRED -> ApiException.conflict("REVIEW_REQUIRED",
                    "Esta dose aguarda a revisão de um conflito.");
            default -> throw new IllegalStateException();
        };
    }

    /** Evita registrar por engano uma dose de outro dia (conta a partir de quando o responsável tocou). */
    private void requireNotTooEarly(DoseOccurrence o, Instant recordedAt) {
        if (o.scheduledAt.isAfter(recordedAt.plus(maxAdvance))) {
            throw ApiException.unprocessable("OCCURRENCE_TOO_EARLY",
                    "Esta dose está prevista para daqui a mais de " + maxAdvance.toHours()
                            + " horas. Confira se escolheu a dose certa.");
        }
    }

    private SyncOperation newOperation(DoseOccurrence o, Report kind, UUID deviceId, Operation op,
            Map<String, Object> proposal, Instant now) {
        SyncOperation s = new SyncOperation();
        s.id = UUID.randomUUID();
        s.familyId = o.familyId;
        s.deviceId = deviceId;
        s.actorId = currentUser.id();
        s.operationKey = op.operationId();
        s.operationType = kind.name();
        s.entityType = ENTITY;
        s.entityId = o.id;
        s.baseVersion = op.baseVersion();
        s.payload = new LinkedHashMap<>(proposal);
        s.status = SyncOperation.Status.RECEIVED;
        s.receivedAt = now;
        s.persist();
        return s;
    }

    private static void requireNotFuture(Instant at, Instant now) {
        if (at.isAfter(now.plus(CLOCK_SKEW))) {
            throw ApiException.unprocessable("ADMINISTERED_AT_IN_FUTURE",
                    "O horário da administração não pode estar no futuro.");
        }
    }

    private static void requireRange(Instant from, Instant to) {
        if (from == null || to == null || !from.isBefore(to)) {
            throw ApiException.unprocessable("INVALID_RANGE", "Informe um período válido (from < to).");
        }
        if (Duration.between(from, to).compareTo(MAX_RANGE) > 0) {
            throw ApiException.unprocessable("INVALID_RANGE", "O período pode ter no máximo 62 dias.");
        }
    }

    private AdministrationRecord newRecord(DoseOccurrence o, UUID deviceId, Instant at, String notes, Instant now) {
        AdministrationRecord r = new AdministrationRecord();
        r.id = UUID.randomUUID();
        r.doseOccurrenceId = o.id;
        r.recordedBy = currentUser.id();
        r.deviceId = deviceId;
        r.administeredAt = at;
        r.recordedAt = now;
        r.receivedAt = now;
        r.notes = Texts.clean(notes);
        return r;
    }

    private void close(DoseOccurrence o, DoseOccurrence.Status status, String reason, Instant now) {
        o.status = status;
        o.claimedBy = null;
        o.claimedUntil = null;
        o.statusReason = reason;
        o.statusChangedBy = currentUser.id();
        o.statusChangedAt = now;
        o.updatedAt = now;
        o.version++;
    }

    private List<DoseOccurrence> query(UUID familyId, Instant from, Instant to, UUID personId, UUID treatmentId,
            UUID changedBy, List<DoseOccurrence.Status> statuses, String order, int limit) {
        StringBuilder q = new StringBuilder(
                "from DoseOccurrence o where o.familyId = :family and o.scheduledAt >= :from and o.scheduledAt < :to"
                        + " and o.treatmentId not in (select t.id from Treatment t where t.deletedAt is not null)");
        Map<String, Object> params = new HashMap<>();
        params.put("family", familyId);
        params.put("from", from);
        params.put("to", to);
        if (personId != null) {
            q.append(" and o.treatmentId in (select t.id from Treatment t where t.personId = :person)");
            params.put("person", personId);
        }
        if (treatmentId != null) {
            q.append(" and o.treatmentId = :treatment");
            params.put("treatment", treatmentId);
        }
        if (changedBy != null) {
            q.append(" and o.statusChangedBy = :changedBy");
            params.put("changedBy", changedBy);
        }
        if (statuses != null) {
            q.append(" and o.status in :statuses");
            params.put("statuses", statuses);
        }
        q.append(" order by ").append(order);
        var query = em.createQuery(q.toString(), DoseOccurrence.class);
        params.forEach(query::setParameter);
        if (limit > 0) {
            query.setMaxResults(limit);
        }
        return query.getResultList();
    }

    private static Map<String, Object> recordData(DoseOccurrence o, AdministrationRecord r) {
        Map<String, Object> m = stateData(o);
        m.put("administrationId", r.id);
        m.put("administeredAt", r.administeredAt.toString());
        m.put("recordedBy", r.recordedBy);
        m.put("deviceId", r.deviceId);
        m.put("notes", r.notes);
        return m;
    }

    private static Map<String, Object> stateData(DoseOccurrence o) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", o.status.name());
        m.put("statusReason", o.statusReason);
        m.put("version", o.version);
        return m;
    }

    /** Outbox: só identificadores, sem dados de saúde (seção 12). */
    private static Map<String, Object> event(DoseOccurrence o) {
        Treatment t = Treatment.findById(o.treatmentId);
        return Map.of("occurrenceId", o.id, "treatmentId", o.treatmentId, "personId", t.personId,
                "status", o.status.name(), "version", o.version);
    }
}
