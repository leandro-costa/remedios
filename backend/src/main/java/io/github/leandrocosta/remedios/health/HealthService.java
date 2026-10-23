package io.github.leandrocosta.remedios.health;

import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.Texts;
import io.github.leandrocosta.remedios.common.VersionConflictException;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.treatment.Treatment;
import io.github.leandrocosta.remedios.user.CurrentUser;
import io.github.leandrocosta.remedios.user.DeviceService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.transaction.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Aferições, sintomas e linhas de referência. Registros são criados com id
 * gerado no aparelho (envio offline idempotente) e nunca apagados: correções
 * e exclusões invalidam o registro, com motivo e auditoria.
 */
@ApplicationScoped
public class HealthService {

    static final String MEASUREMENT = "MEASUREMENT";
    static final String SYMPTOM = "SYMPTOM";
    static final String REFERENCE_LINE = "REFERENCE_LINE";

    private static final Duration CLOCK_SKEW = Duration.ofMinutes(5);
    private static final Duration MAX_RANGE = Duration.ofDays(400);
    /** Limite da coluna numeric(8, 2). */
    private static final BigDecimal OTHER_MAX = new BigDecimal("999999");
    private static final BigDecimal OTHER_MIN = OTHER_MAX.negate();

    public record MeasurementData(MeasurementType type, BigDecimal value, BigDecimal value2, String unit, String label,
            String method, Instant measuredAt, String notes) {
    }

    public record SymptomData(String description, SymptomRecord.Intensity intensity, Instant startedAt,
            Instant endedAt, UUID treatmentId, String notes) {
    }

    /** Origem de um registro criado no aparelho. */
    public record Origin(UUID id, UUID deviceId, Instant recordedAt) {
    }

    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final DeviceService devices;
    private final AuditService audit;
    private final EntityManager em;

    public HealthService(CurrentUser currentUser, FamilyAccess access, DeviceService devices, AuditService audit,
            EntityManager em) {
        this.currentUser = currentUser;
        this.access = access;
        this.devices = devices;
        this.audit = audit;
        this.em = em;
    }

    // --- Aferições ------------------------------------------------------------

    public List<Measurement> measurements(UUID familyId, UUID personId, MeasurementType type, Instant from,
            Instant to) {
        requirePerson(familyId, personId);
        requireRange(from, to);
        StringBuilder q = new StringBuilder("""
                from Measurement m where m.familyId = :family and m.personId = :person and m.voidedAt is null
                 and m.measuredAt >= :from and m.measuredAt < :to""");
        if (type != null) {
            q.append(" and m.type = :type");
        }
        q.append(" order by m.measuredAt, m.receivedAt");
        var query = em.createQuery(q.toString(), Measurement.class)
                .setParameter("family", familyId).setParameter("person", personId)
                .setParameter("from", from).setParameter("to", to);
        if (type != null) {
            query.setParameter("type", type);
        }
        return query.getResultList();
    }

    public Measurement measurement(UUID familyId, UUID id) {
        access.requireMember(familyId);
        Measurement m = Measurement.findById(id);
        if (m == null || !m.familyId.equals(familyId)) {
            throw ApiException.notFound("Aferição");
        }
        return m;
    }

    @Transactional
    public Measurement record(UUID familyId, UUID personId, MeasurementData data, Origin origin) {
        requirePerson(familyId, personId);
        devices.requireActive(origin.deviceId());
        Measurement existing = Measurement.findById(origin.id());
        if (existing != null) {
            requireSameOrigin(existing.familyId, existing.recordedBy, familyId, "aferição");
            return existing;
        }
        Instant now = Instant.now();
        Measurement m = newMeasurement(origin.id(), familyId, personId, validate(data, now), origin, now);
        m.persist();
        audit.record(familyId, currentUser.id(), MEASUREMENT, m.id, "MEASUREMENT_RECORDED", null, data(m), null);
        return m;
    }

    /** Substitui uma aferição por outra corrigida; a original fica preservada e invalidada. */
    @Transactional
    public Measurement correct(UUID familyId, UUID id, MeasurementData data, UUID deviceId, String reason) {
        access.requireMember(familyId);
        Measurement old = lockMeasurement(familyId, id);
        if (old.voidedAt != null) {
            throw ApiException.conflict("ALREADY_VOIDED", "Esta aferição já foi corrigida ou excluída.");
        }
        devices.requireActive(deviceId);
        Instant now = Instant.now();
        MeasurementData fixed = validate(new MeasurementData(old.type, data.value(), data.value2(),
                old.type == MeasurementType.OTHER ? data.unit() : old.unit,
                old.type == MeasurementType.OTHER ? data.label() : old.label,
                data.method(), data.measuredAt(), data.notes()), now);
        voidMeasurement(old, reason, now);
        Measurement m = newMeasurement(UUID.randomUUID(), familyId, old.personId, fixed,
                new Origin(null, deviceId, now), now);
        m.replacesId = old.id;
        m.persist();
        audit.record(familyId, currentUser.id(), MEASUREMENT, m.id, "MEASUREMENT_CORRECTED", data(old), data(m),
                Texts.clean(reason));
        return m;
    }

    @Transactional
    public void voidMeasurement(UUID familyId, UUID id, String reason) {
        access.requireMember(familyId);
        Measurement m = lockMeasurement(familyId, id);
        if (m.voidedAt != null) {
            return;
        }
        voidMeasurement(m, reason, Instant.now());
        audit.record(familyId, currentUser.id(), MEASUREMENT, m.id, "MEASUREMENT_VOIDED", data(m), null,
                Texts.clean(reason));
    }

    // --- Sintomas -------------------------------------------------------------

    /** Sintomas que estiveram presentes em algum momento do período. */
    public List<SymptomRecord> symptoms(UUID familyId, UUID personId, Instant from, Instant to) {
        requirePerson(familyId, personId);
        requireRange(from, to);
        return em.createQuery("""
                from SymptomRecord s where s.familyId = :family and s.personId = :person and s.voidedAt is null
                 and s.startedAt < :to and (s.endedAt is null or s.endedAt >= :from)
                 order by s.startedAt, s.receivedAt""", SymptomRecord.class)
                .setParameter("family", familyId).setParameter("person", personId)
                .setParameter("from", from).setParameter("to", to)
                .getResultList();
    }

    @Transactional
    public SymptomRecord recordSymptom(UUID familyId, UUID personId, SymptomData data, Origin origin) {
        requirePerson(familyId, personId);
        devices.requireActive(origin.deviceId());
        SymptomRecord existing = SymptomRecord.findById(origin.id());
        if (existing != null) {
            requireSameOrigin(existing.familyId, existing.recordedBy, familyId, "sintoma");
            return existing;
        }
        Instant now = Instant.now();
        SymptomData valid = validate(familyId, data, now);
        SymptomRecord s = new SymptomRecord();
        s.id = origin.id();
        s.familyId = familyId;
        s.personId = personId;
        apply(s, valid);
        s.version = 1;
        s.recordedBy = currentUser.id();
        s.deviceId = origin.deviceId();
        s.recordedAt = recordedAt(origin, now);
        s.receivedAt = now;
        s.persist();
        audit.record(familyId, currentUser.id(), SYMPTOM, s.id, "SYMPTOM_RECORDED", null, data(s), null);
        return s;
    }

    /** Altera um sintoma (ex.: registrar quando terminou), com a versão vista pelo responsável. */
    @Transactional
    public SymptomRecord updateSymptom(UUID familyId, UUID id, SymptomData data, long baseVersion, String reason) {
        access.requireMember(familyId);
        SymptomRecord s = lockSymptom(familyId, id);
        if (s.voidedAt != null) {
            throw ApiException.conflict("ALREADY_VOIDED", "Este sintoma foi excluído.");
        }
        if (s.version != baseVersion) {
            throw new VersionConflictException("O sintoma", s.version);
        }
        Map<String, Object> before = data(s);
        apply(s, validate(familyId, data, Instant.now()));
        s.version++;
        s.updatedBy = currentUser.id();
        s.updatedAt = Instant.now();
        audit.record(familyId, currentUser.id(), SYMPTOM, s.id, "SYMPTOM_UPDATED", before, data(s),
                Texts.clean(reason));
        return s;
    }

    @Transactional
    public void voidSymptom(UUID familyId, UUID id, String reason) {
        access.requireMember(familyId);
        SymptomRecord s = lockSymptom(familyId, id);
        if (s.voidedAt != null) {
            return;
        }
        s.voidedAt = Instant.now();
        s.voidedBy = currentUser.id();
        s.voidReason = requireReason(reason);
        s.version++;
        audit.record(familyId, currentUser.id(), SYMPTOM, s.id, "SYMPTOM_VOIDED", data(s), null, s.voidReason);
    }

    // --- Linhas de referência ---------------------------------------------------

    public List<ReferenceLine> referenceLines(UUID familyId) {
        access.requireMember(familyId);
        return ReferenceLine.list("familyId = ?1 order by type", familyId);
    }

    /** Cria ou substitui a linha de um tipo (para uma pessoa ou para toda a família). */
    @Transactional
    public ReferenceLine saveReferenceLine(UUID familyId, UUID personId, MeasurementType type, BigDecimal value,
            BigDecimal value2, String label) {
        access.requireMember(familyId);
        if (personId != null) {
            requirePerson(familyId, personId);
        }
        if (type == MeasurementType.OTHER) {
            throw ApiException.unprocessable("INVALID_REFERENCE", "Linhas de referência valem para os tipos fixos.");
        }
        if (value2 != null && !type.hasSecondValue()) {
            throw ApiException.unprocessable("INVALID_REFERENCE", "Só a pressão arterial tem segundo valor.");
        }
        checkRange(type.min, type.max, value, "O valor da linha");
        if (value2 != null) {
            checkRange(type.min2, type.max2, value2, "O segundo valor da linha");
        }
        String text = Texts.clean(label);
        if (text == null) {
            throw ApiException.unprocessable("INVALID_REFERENCE",
                    "Descreva a referência (ex.: \"Orientação do pediatra\").");
        }
        var query = personId == null
                ? em.createQuery("from ReferenceLine r where r.familyId = :family and r.type = :type"
                        + " and r.personId is null", ReferenceLine.class)
                : em.createQuery("from ReferenceLine r where r.familyId = :family and r.type = :type"
                        + " and r.personId = :person", ReferenceLine.class).setParameter("person", personId);
        ReferenceLine line = query.setParameter("family", familyId).setParameter("type", type)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultStream().findFirst().orElse(null);
        Map<String, Object> before = line == null ? null : data(line);
        if (line == null) {
            line = new ReferenceLine();
            line.id = UUID.randomUUID();
            line.familyId = familyId;
            line.personId = personId;
            line.type = type;
            line.createdBy = currentUser.id();
        }
        line.value = value;
        line.value2 = value2;
        line.label = text;
        line.updatedAt = Instant.now();
        if (before == null) {
            line.persist();
        }
        audit.record(familyId, currentUser.id(), REFERENCE_LINE, line.id, "REFERENCE_LINE_SAVED", before,
                data(line), null);
        return line;
    }

    @Transactional
    public void deleteReferenceLine(UUID familyId, UUID id) {
        access.requireMember(familyId);
        ReferenceLine line = ReferenceLine.findById(id);
        if (line == null || !line.familyId.equals(familyId)) {
            throw ApiException.notFound("Linha de referência");
        }
        audit.record(familyId, currentUser.id(), REFERENCE_LINE, line.id, "REFERENCE_LINE_DELETED", data(line), null,
                null);
        line.delete();
    }

    // --- Validação --------------------------------------------------------------

    MeasurementData validate(MeasurementData d, Instant now) {
        MeasurementType type = d.type();
        if (type == null || d.value() == null || d.measuredAt() == null) {
            throw invalid("Informe o tipo, o valor e o horário da aferição.");
        }
        if (d.measuredAt().isAfter(now.plus(CLOCK_SKEW))) {
            throw invalid("O horário da aferição não pode estar no futuro.");
        }
        String unit;
        String label;
        if (type == MeasurementType.OTHER) {
            label = Texts.clean(d.label());
            unit = Texts.clean(d.unit());
            if (label == null || unit == null) {
                throw invalid("Informe o que foi medido e a unidade.");
            }
            checkRange(OTHER_MIN, OTHER_MAX, d.value(), "O valor");
        } else {
            label = null;
            unit = type.unit;
            checkRange(type.min, type.max, d.value(), "O valor");
        }
        BigDecimal value2 = null;
        if (type.hasSecondValue()) {
            if (d.value2() == null) {
                throw invalid("Informe a pressão sistólica e a diastólica.");
            }
            checkRange(type.min2, type.max2, d.value2(), "A diastólica");
            if (d.value2().compareTo(d.value()) >= 0) {
                throw invalid("A sistólica (primeiro valor) deve ser maior que a diastólica. Confira a digitação.");
            }
            value2 = d.value2();
        } else if (d.value2() != null) {
            throw invalid("Este tipo de aferição tem um único valor.");
        }
        String method = Texts.clean(d.method());
        if (method != null && !type.methods.contains(method)) {
            throw invalid("Local ou condição da medida inválido para este tipo.");
        }
        return new MeasurementData(type, scale(d.value()), value2 == null ? null : scale(value2), unit, label,
                method, d.measuredAt(), Texts.clean(d.notes()));
    }

    private SymptomData validate(UUID familyId, SymptomData d, Instant now) {
        String description = Texts.clean(d.description());
        if (description == null || d.startedAt() == null) {
            throw ApiException.unprocessable("INVALID_SYMPTOM", "Descreva o sintoma e quando começou.");
        }
        if (d.startedAt().isAfter(now.plus(CLOCK_SKEW))
                || (d.endedAt() != null && d.endedAt().isAfter(now.plus(CLOCK_SKEW)))) {
            throw ApiException.unprocessable("INVALID_SYMPTOM", "Início e fim não podem estar no futuro.");
        }
        if (d.endedAt() != null && d.endedAt().isBefore(d.startedAt())) {
            throw ApiException.unprocessable("INVALID_SYMPTOM", "O fim deve ser depois do início.");
        }
        if (d.treatmentId() != null && Treatment.findInFamily(familyId, d.treatmentId()).isEmpty()) {
            throw ApiException.unprocessable("INVALID_SYMPTOM", "Tratamento não encontrado nesta família.");
        }
        return new SymptomData(description, d.intensity(), d.startedAt(), d.endedAt(), d.treatmentId(),
                Texts.clean(d.notes()));
    }

    private static void checkRange(BigDecimal min, BigDecimal max, BigDecimal value, String what) {
        if (value.compareTo(min) < 0 || value.compareTo(max) > 0) {
            throw invalid(what + " deve estar entre " + min.toPlainString() + " e " + max.toPlainString()
                    + ". Confira a digitação.");
        }
    }

    private static BigDecimal scale(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    private static ApiException invalid(String message) {
        return ApiException.unprocessable("INVALID_MEASUREMENT", message);
    }

    private static String requireReason(String reason) {
        String text = Texts.clean(reason);
        if (text == null) {
            throw ApiException.unprocessable("REASON_REQUIRED", "Informe o motivo.");
        }
        return text;
    }

    private static void requireRange(Instant from, Instant to) {
        if (from == null || to == null || !from.isBefore(to) || Duration.between(from, to).compareTo(MAX_RANGE) > 0) {
            throw ApiException.unprocessable("INVALID_RANGE", "Informe um período válido de até 400 dias.");
        }
    }

    // --- Auxiliares -------------------------------------------------------------

    private void requirePerson(UUID familyId, UUID personId) {
        access.requireMember(familyId);
        Person.findInFamily(familyId, personId).orElseThrow(() -> ApiException.notFound("Pessoa"));
    }

    /** Reenvio do mesmo registro pelo aparelho: devolve o já salvo; id de outra origem é recusado. */
    private void requireSameOrigin(UUID existingFamily, UUID existingAuthor, UUID familyId, String what) {
        if (existingFamily.equals(familyId) && existingAuthor.equals(currentUser.id())) {
            return;
        }
        throw ApiException.conflict("ID_IN_USE", "Este identificador de " + what + " já está em uso.");
    }

    private Measurement newMeasurement(UUID id, UUID familyId, UUID personId, MeasurementData d, Origin origin,
            Instant now) {
        Measurement m = new Measurement();
        m.id = id;
        m.familyId = familyId;
        m.personId = personId;
        m.type = d.type();
        m.value = d.value();
        m.value2 = d.value2();
        m.unit = d.unit();
        m.label = d.label();
        m.method = d.method();
        m.measuredAt = d.measuredAt();
        m.notes = d.notes();
        m.recordedBy = currentUser.id();
        m.deviceId = origin.deviceId();
        m.recordedAt = recordedAt(origin, now);
        m.receivedAt = now;
        return m;
    }

    private void voidMeasurement(Measurement m, String reason, Instant now) {
        m.voidedAt = now;
        m.voidedBy = currentUser.id();
        m.voidReason = requireReason(reason);
    }

    private static Instant recordedAt(Origin origin, Instant now) {
        return origin.recordedAt() == null || origin.recordedAt().isAfter(now) ? now : origin.recordedAt();
    }

    private static void apply(SymptomRecord s, SymptomData d) {
        s.description = d.description();
        s.intensity = d.intensity();
        s.startedAt = d.startedAt();
        s.endedAt = d.endedAt();
        s.treatmentId = d.treatmentId();
        s.notes = d.notes();
    }

    private Measurement lockMeasurement(UUID familyId, UUID id) {
        Measurement m = Measurement.findById(id, LockModeType.PESSIMISTIC_WRITE);
        if (m == null || !m.familyId.equals(familyId)) {
            throw ApiException.notFound("Aferição");
        }
        return m;
    }

    private SymptomRecord lockSymptom(UUID familyId, UUID id) {
        SymptomRecord s = SymptomRecord.findById(id, LockModeType.PESSIMISTIC_WRITE);
        if (s == null || !s.familyId.equals(familyId)) {
            throw ApiException.notFound("Sintoma");
        }
        return s;
    }

    private static Map<String, Object> data(Measurement m) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("type", m.type.name());
        d.put("value", m.value.toPlainString());
        d.put("value2", m.value2 == null ? null : m.value2.toPlainString());
        d.put("unit", m.unit);
        d.put("label", m.label);
        d.put("method", m.method);
        d.put("measuredAt", m.measuredAt.toString());
        return d;
    }

    private static Map<String, Object> data(SymptomRecord s) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("description", s.description);
        d.put("intensity", s.intensity == null ? null : s.intensity.name());
        d.put("startedAt", s.startedAt.toString());
        d.put("endedAt", s.endedAt == null ? null : s.endedAt.toString());
        d.put("treatmentId", s.treatmentId);
        d.put("version", s.version);
        return d;
    }

    private static Map<String, Object> data(ReferenceLine r) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("personId", r.personId);
        d.put("type", r.type.name());
        d.put("value", r.value.toPlainString());
        d.put("value2", r.value2 == null ? null : r.value2.toPlainString());
        d.put("label", r.label);
        return d;
    }
}
