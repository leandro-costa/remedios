package io.github.leandrocosta.remedios.occurrence;

import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.Texts;
import io.github.leandrocosta.remedios.common.VersionConflictException;
import io.github.leandrocosta.remedios.family.FamilyAccess;
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

    public enum CorrectionTarget { ADMINISTERED, NOT_ADMINISTERED, OPEN }

    public record Correction(long baseVersion, CorrectionTarget status, Instant administeredAt, String notes,
            String reason, UUID deviceId) {
    }

    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final DeviceService devices;
    private final AuditService audit;
    private final EntityManager em;
    private final Duration maxAdvance;

    public OccurrenceService(CurrentUser currentUser, FamilyAccess access, DeviceService devices, AuditService audit,
            EntityManager em, @ConfigProperty(name = "remedios.administration.max-advance") Duration maxAdvance) {
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
                List.of(DoseOccurrence.Status.ADMINISTERED, DoseOccurrence.Status.NOT_ADMINISTERED),
                "o.scheduledAt desc, o.slotKey desc", Math.clamp(limit, 1, MAX_HISTORY));
    }

    public DoseOccurrence get(UUID familyId, UUID occurrenceId) {
        access.requireMember(familyId);
        return DoseOccurrence.findInFamily(familyId, occurrenceId).orElseThrow(() -> ApiException.notFound("Dose"));
    }

    // --- Desfechos ------------------------------------------------------------

    @Transactional
    public DoseOccurrence administer(UUID familyId, UUID occurrenceId, UUID deviceId, Instant administeredAt,
            String notes) {
        access.requireMember(familyId);
        DoseOccurrence o = lockOpen(familyId, occurrenceId);
        devices.requireActive(deviceId);
        Instant now = Instant.now();
        Instant at = administeredAt == null ? now : administeredAt;
        requireNotFuture(at, now);

        AdministrationRecord r = newRecord(o, deviceId, at, notes, now);
        r.persist();
        close(o, DoseOccurrence.Status.ADMINISTERED, null, now);

        audit.record(familyId, currentUser.id(), ENTITY, o.id, "DOSE_ADMINISTERED", null, recordData(o, r), null);
        audit.publish(familyId, "DOSE_ADMINISTERED", ENTITY, o.id, event(o));
        return o;
    }

    @Transactional
    public DoseOccurrence markNotAdministered(UUID familyId, UUID occurrenceId, String reason) {
        access.requireMember(familyId);
        DoseOccurrence o = lockOpen(familyId, occurrenceId);
        Instant now = Instant.now();
        close(o, DoseOccurrence.Status.NOT_ADMINISTERED, Texts.clean(reason), now);

        audit.record(familyId, currentUser.id(), ENTITY, o.id, "DOSE_NOT_ADMINISTERED", null, stateData(o),
                o.statusReason);
        audit.publish(familyId, "DOSE_NOT_ADMINISTERED", ENTITY, o.id, event(o));
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
            default -> throw new IllegalStateException();
        }

        audit.record(familyId, currentUser.id(), ENTITY, o.id, "DOSE_CORRECTED", before, after, reason);
        audit.publish(familyId, "DOSE_CORRECTED", ENTITY, o.id, event(o));
        return o;
    }

    // --- Auxiliares -----------------------------------------------------------

    private DoseOccurrence lockOpen(UUID familyId, UUID occurrenceId) {
        DoseOccurrence o = DoseOccurrence.lockInFamily(familyId, occurrenceId)
                .orElseThrow(() -> ApiException.notFound("Dose"));
        switch (o.status) {
            case SCHEDULED, PENDING -> {
            }
            case ADMINISTERED -> {
                AdministrationRecord r = AdministrationRecord.findValid(o.id).orElseThrow();
                AppUser by = AppUser.findById(r.recordedBy);
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("administeredAt", r.administeredAt.toString());
                details.put("recordedBy", Map.of("id", by.id, "displayName", by.displayName));
                throw ApiException.conflict("ALREADY_ADMINISTERED",
                        by.displayName + " já registrou esta dose. Confira antes de dar outra.", details);
            }
            case NOT_ADMINISTERED -> throw ApiException.conflict("ALREADY_RECORDED",
                    "Já foi registrado que esta dose não foi dada. Use a correção, se for o caso.");
            case CANCELLED -> throw ApiException.conflict("OCCURRENCE_CANCELLED",
                    "Esta dose foi cancelada por uma alteração do tratamento.");
            case REVIEW_REQUIRED -> throw ApiException.conflict("REVIEW_REQUIRED",
                    "Esta dose aguarda a revisão de um conflito.");
        }
        if (o.scheduledAt.isAfter(Instant.now().plus(maxAdvance))) {
            throw ApiException.unprocessable("OCCURRENCE_TOO_EARLY",
                    "Esta dose está prevista para daqui a mais de " + maxAdvance.toHours()
                            + " horas. Confira se escolheu a dose certa.");
        }
        return o;
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
        o.statusReason = reason;
        o.statusChangedBy = currentUser.id();
        o.statusChangedAt = now;
        o.updatedAt = now;
        o.version++;
    }

    private List<DoseOccurrence> query(UUID familyId, Instant from, Instant to, UUID personId, UUID treatmentId,
            UUID changedBy, List<DoseOccurrence.Status> statuses, String order, int limit) {
        StringBuilder q = new StringBuilder(
                "from DoseOccurrence o where o.familyId = :family and o.scheduledAt >= :from and o.scheduledAt < :to");
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
