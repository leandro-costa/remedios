package io.github.leandrocosta.remedios.person;

import io.github.leandrocosta.remedios.common.ClientIds;
import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.Texts;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.family.FamilyMember;
import io.github.leandrocosta.remedios.user.CurrentUser;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@ApplicationScoped
public class PersonService {

    static final String PERSON = "PERSON";

    public record PersonData(String displayName, LocalDate birthDate, UUID userId, boolean active) {
    }

    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final AuditService audit;

    public PersonService(CurrentUser currentUser, FamilyAccess access, AuditService audit) {
        this.currentUser = currentUser;
        this.access = access;
        this.audit = audit;
    }

    public List<Person> list(UUID familyId, Boolean active) {
        access.requireMember(familyId);
        return active == null
                ? Person.list("familyId = ?1 order by displayName", familyId)
                : Person.list("familyId = ?1 and active = ?2 order by displayName", familyId, active);
    }

    public Person get(UUID familyId, UUID personId) {
        access.requireMember(familyId);
        return Person.findInFamily(familyId, personId).orElseThrow(() -> ApiException.notFound("Pessoa"));
    }

    @Transactional
    public Person create(UUID familyId, UUID requestedId, PersonData data) {
        access.requireMember(familyId);
        validate(familyId, null, data);
        Instant now = Instant.now();
        Person person = new Person();
        person.id = ClientIds.choose(requestedId, id -> Person.findById(id) != null);
        person.familyId = familyId;
        apply(person, data);
        person.createdAt = now;
        person.updatedAt = now;
        person.persist();
        audit.record(familyId, currentUser.id(), PERSON, person.id, "PERSON_CREATED", null, data(person), null);
        return person;
    }

    @Transactional
    public Person update(UUID familyId, UUID personId, PersonData data) {
        Person person = get(familyId, personId);
        validate(familyId, personId, data);
        Map<String, Object> before = data(person);
        apply(person, data);
        person.updatedAt = Instant.now();
        audit.record(familyId, currentUser.id(), PERSON, person.id, "PERSON_UPDATED", before, data(person), null);
        return person;
    }

    private static void validate(UUID familyId, UUID personId, PersonData data) {
        if (data.birthDate() != null && data.birthDate().isAfter(LocalDate.now())) {
            throw ApiException.unprocessable("INVALID_BIRTH_DATE", "A data de nascimento não pode estar no futuro.");
        }
        if (data.userId() == null) {
            return;
        }
        if (FamilyMember.findActive(familyId, data.userId()).isEmpty()) {
            throw ApiException.unprocessable("USER_NOT_MEMBER",
                    "Só é possível associar o perfil a uma conta que participa da família.");
        }
        Person.findLinked(familyId, data.userId())
                .filter(other -> !other.id.equals(personId))
                .ifPresent(other -> {
                    throw ApiException.conflict("USER_ALREADY_LINKED",
                            "Esta conta já está associada a outro perfil da família.");
                });
    }

    private static void apply(Person person, PersonData data) {
        person.displayName = Texts.clean(data.displayName());
        person.birthDate = data.birthDate();
        person.userId = data.userId();
        person.active = data.active();
    }

    private static Map<String, Object> data(Person p) {
        Map<String, Object> m = new HashMap<>();
        m.put("displayName", p.displayName);
        m.put("birthDate", p.birthDate == null ? null : p.birthDate.toString());
        m.put("userId", p.userId);
        m.put("active", p.active);
        return m;
    }
}
