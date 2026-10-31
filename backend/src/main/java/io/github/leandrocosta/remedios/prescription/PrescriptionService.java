package io.github.leandrocosta.remedios.prescription;

import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.ClientIds;
import io.github.leandrocosta.remedios.common.Texts;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.treatment.Treatment;
import io.github.leandrocosta.remedios.treatment.TreatmentService;
import io.github.leandrocosta.remedios.user.CurrentUser;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.time.LocalDate;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Receitas: cadastro, situação (calculada pelos itens) e ações sobre todos os itens de uma vez. */
@ApplicationScoped
public class PrescriptionService {

    static final String PRESCRIPTION = "PRESCRIPTION";

    public record PrescriptionData(String title, String prescriber, LocalDate prescribedOn, String notes) {
    }

    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final AuditService audit;
    private final TreatmentService treatments;

    public PrescriptionService(CurrentUser currentUser, FamilyAccess access, AuditService audit,
            TreatmentService treatments) {
        this.currentUser = currentUser;
        this.access = access;
        this.audit = audit;
        this.treatments = treatments;
    }

    /**
     * Situação da receita pelos itens: ativa se algum item está ativo; senão
     * suspensa se algum está suspenso; senão rascunho se algum ainda não foi
     * ativado (ou se não há itens); senão encerrada.
     */
    public static Treatment.Status status(List<Treatment> items) {
        Set<Treatment.Status> s = EnumSet.noneOf(Treatment.Status.class);
        items.forEach(i -> s.add(i.status));
        if (s.contains(Treatment.Status.ACTIVE)) {
            return Treatment.Status.ACTIVE;
        }
        if (s.contains(Treatment.Status.SUSPENDED)) {
            return Treatment.Status.SUSPENDED;
        }
        if (s.isEmpty() || s.contains(Treatment.Status.DRAFT)) {
            return Treatment.Status.DRAFT;
        }
        return Treatment.Status.ENDED;
    }

    public List<Prescription> list(UUID familyId, UUID personId) {
        access.requireMember(familyId);
        return personId == null
                ? Prescription.list("familyId = ?1 and deletedAt is null order by createdAt desc", familyId)
                : Prescription.list("familyId = ?1 and personId = ?2 and deletedAt is null order by createdAt desc",
                        familyId, personId);
    }

    public Prescription get(UUID familyId, UUID id) {
        access.requireMember(familyId);
        return Prescription.findInFamily(familyId, id).orElseThrow(() -> ApiException.notFound("Receita"));
    }

    public static List<Treatment> items(UUID prescriptionId) {
        return Treatment.list("prescriptionId = ?1 and deletedAt is null order by createdAt", prescriptionId);
    }

    @Transactional
    public Prescription create(UUID familyId, UUID requestedId, UUID personId, PrescriptionData data) {
        access.requireMember(familyId);
        Person person = Person.findInFamily(familyId, personId)
                .orElseThrow(() -> ApiException.unprocessable("PERSON_NOT_FOUND",
                        "A pessoa informada não pertence a esta família."));
        if (!person.active) {
            throw ApiException.unprocessable("PERSON_INACTIVE", "Não é possível cadastrar receita para um perfil inativo.");
        }
        if (personId.equals(requestedId)) {
            throw ApiException.unprocessable("RESERVED_ID", "Este identificador é do uso eventual da pessoa.");
        }
        Instant now = Instant.now();
        Prescription p = new Prescription();
        p.id = ClientIds.choose(requestedId, id -> Prescription.findById(id) != null);
        p.familyId = familyId;
        p.personId = personId;
        apply(p, data);
        p.createdBy = currentUser.id();
        p.createdAt = now;
        p.updatedAt = now;
        p.persist();
        audit.record(familyId, currentUser.id(), PRESCRIPTION, p.id, "PRESCRIPTION_CREATED", null, snapshot(p), null);
        return p;
    }

    @Transactional
    public Prescription update(UUID familyId, UUID id, PrescriptionData data) {
        Prescription p = get(familyId, id);
        Map<String, Object> before = snapshot(p);
        String title = p.title;
        apply(p, data);
        if (p.kind == Prescription.Kind.EVENTUAL) {
            p.title = title; // o uso eventual mantém o nome
        }
        p.updatedAt = Instant.now();
        audit.record(familyId, currentUser.id(), PRESCRIPTION, p.id, "PRESCRIPTION_UPDATED", before, snapshot(p), null);
        return p;
    }

    /**
     * Suspende, reativa ou encerra todos os itens possíveis de uma vez. Itens
     * em rascunho são ativados um a um (cada um pode perguntar pelas doses
     * anteriores); ao encerrar, rascunhos são descartados junto.
     */
    @Transactional
    public Prescription changeStatus(UUID familyId, UUID id, Treatment.Status target, String reason) {
        Prescription p = get(familyId, id);
        Set<Treatment.Status> from = switch (target) {
            case SUSPENDED -> EnumSet.of(Treatment.Status.ACTIVE);
            case ACTIVE -> EnumSet.of(Treatment.Status.SUSPENDED);
            case ENDED -> EnumSet.of(Treatment.Status.DRAFT, Treatment.Status.ACTIVE, Treatment.Status.SUSPENDED);
            default -> throw ApiException.unprocessable("INVALID_STATUS",
                    "A receita pode ser suspensa, reativada ou encerrada.");
        };
        Instant now = Instant.now();
        for (Treatment t : items(p.id)) {
            if (from.contains(t.status)) {
                treatments.changeStatus(familyId, t.id, target,
                        new TreatmentService.Change(t.version, now, Texts.clean(reason)));
            }
        }
        return p;
    }

    /** Receita cadastrada por engano: exclui (oculta) os itens e a receita. Só administradores. */
    @Transactional
    public void delete(UUID familyId, UUID id, String reason) {
        access.requireAdmin(familyId);
        Prescription p = get(familyId, id);
        String why = Texts.clean(reason);
        for (Treatment t : items(p.id)) {
            treatments.delete(familyId, t.id, t.version, why);
        }
        Instant now = Instant.now();
        p.deletedAt = now;
        p.deletedBy = currentUser.id();
        p.deleteReason = why;
        p.updatedAt = now;
        audit.record(familyId, currentUser.id(), PRESCRIPTION, p.id, "PRESCRIPTION_DELETED", snapshot(p), null, why);
    }

    private static void apply(Prescription p, PrescriptionData data) {
        p.title = Texts.clean(data.title());
        p.prescriber = Texts.clean(data.prescriber());
        p.prescribedOn = data.prescribedOn();
        p.notes = Texts.clean(data.notes());
    }

    private static Map<String, Object> snapshot(Prescription p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("personId", p.personId.toString());
        m.put("title", p.title);
        m.put("prescriber", p.prescriber);
        m.put("prescribedOn", p.prescribedOn == null ? null : p.prescribedOn.toString());
        m.put("notes", p.notes);
        return m;
    }
}
