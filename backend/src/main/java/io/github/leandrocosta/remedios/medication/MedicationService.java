package io.github.leandrocosta.remedios.medication;

import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.ClientIds;
import io.github.leandrocosta.remedios.common.Texts;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.user.CurrentUser;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Medicamentos da família (reaproveitados entre tratamentos). */
@ApplicationScoped
public class MedicationService {

    static final String MEDICATION = "MEDICATION";
    static final int MAX_SUBSTANCES = 20;

    public record SubstanceData(String substance, String concentration) {
    }

    public record MedicationData(String name, String form, String manufacturer, String category, String notes,
            List<SubstanceData> substances) {
    }

    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final AuditService audit;

    public MedicationService(CurrentUser currentUser, FamilyAccess access, AuditService audit) {
        this.currentUser = currentUser;
        this.access = access;
        this.audit = audit;
    }

    public List<Medication> list(UUID familyId) {
        access.requireMember(familyId);
        return Medication.list("familyId = ?1 order by lower(name), createdAt", familyId);
    }

    public Medication get(UUID familyId, UUID id) {
        access.requireMember(familyId);
        return Medication.findInFamily(familyId, id).orElseThrow(() -> ApiException.notFound("Medicamento"));
    }

    @Transactional
    public Medication create(UUID familyId, UUID requestedId, MedicationData data) {
        access.requireMember(familyId);
        Instant now = Instant.now();
        Medication m = new Medication();
        m.id = ClientIds.choose(requestedId, id -> Medication.findById(id) != null);
        m.familyId = familyId;
        m.createdBy = currentUser.id();
        m.createdAt = now;
        apply(m, data, now);
        m.persist();
        audit.record(familyId, currentUser.id(), MEDICATION, m.id, "MEDICATION_CREATED", null, snapshot(m), null);
        return m;
    }

    @Transactional
    public Medication update(UUID familyId, UUID id, MedicationData data) {
        Medication m = get(familyId, id);
        Map<String, Object> before = snapshot(m);
        apply(m, data, Instant.now());
        audit.record(familyId, currentUser.id(), MEDICATION, m.id, "MEDICATION_UPDATED", before, snapshot(m), null);
        return m;
    }

    /**
     * O medicamento de um tratamento: o informado (da família) ou, sem ele, o
     * da família com o mesmo nome, criado se ainda não existir. Assim todo
     * tratamento fica ligado a um medicamento reaproveitável, mesmo vindo de
     * um aparelho que só mandou o nome.
     */
    @Transactional(Transactional.TxType.MANDATORY)
    public Medication forTreatment(UUID familyId, UUID medicationId, String name) {
        if (medicationId != null) {
            return Medication.findInFamily(familyId, medicationId)
                    .orElseThrow(() -> ApiException.unprocessable("UNKNOWN_MEDICATION",
                            "Medicamento não encontrado nesta família."));
        }
        return Medication.findByName(familyId, name).orElseGet(() -> {
            Instant now = Instant.now();
            Medication m = new Medication();
            m.id = UUID.randomUUID();
            m.familyId = familyId;
            m.name = Texts.clean(name);
            m.createdBy = currentUser.id();
            m.createdAt = now;
            m.updatedAt = now;
            m.persist();
            audit.record(familyId, currentUser.id(), MEDICATION, m.id, "MEDICATION_CREATED", null, snapshot(m),
                    "Criado ao cadastrar um tratamento");
            return m;
        });
    }

    private static void apply(Medication m, MedicationData data, Instant now) {
        List<Medication.Substance> substances = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (SubstanceData s : data.substances() == null ? List.<SubstanceData>of() : data.substances()) {
            String name = s == null ? null : Texts.clean(s.substance());
            if (name == null) {
                continue;
            }
            if (!seen.add(name.toLowerCase(Locale.ROOT))) {
                throw ApiException.unprocessable("DUPLICATE_SUBSTANCE", "Substância repetida: " + name + ".");
            }
            substances.add(new Medication.Substance(name, Texts.clean(s.concentration())));
        }
        if (substances.size() > MAX_SUBSTANCES) {
            throw ApiException.unprocessable("TOO_MANY_SUBSTANCES",
                    "Informe no máximo " + MAX_SUBSTANCES + " substâncias.");
        }
        m.name = Texts.clean(data.name());
        m.form = Texts.clean(data.form());
        m.manufacturer = Texts.clean(data.manufacturer());
        m.category = Texts.clean(data.category());
        m.notes = Texts.clean(data.notes());
        m.substances.clear();
        m.substances.addAll(substances);
        m.updatedAt = now;
    }

    static Map<String, Object> snapshot(Medication m) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("name", m.name);
        s.put("form", m.form);
        s.put("manufacturer", m.manufacturer);
        s.put("category", m.category);
        s.put("notes", m.notes);
        s.put("substances", m.substances.stream().map(x -> {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("substance", x.substance);
            e.put("concentration", x.concentration);
            return e;
        }).toList());
        return s;
    }
}
