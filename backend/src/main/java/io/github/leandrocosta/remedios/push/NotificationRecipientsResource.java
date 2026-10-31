package io.github.leandrocosta.remedios.push;

import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.family.FamilyMember;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.user.AppUser;
import io.github.leandrocosta.remedios.user.CurrentUser;
import io.quarkus.security.Authenticated;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Quem recebe os avisos e lembretes de cada pessoa da família. Por padrão,
 * todos os responsáveis recebem de todas; o administrador escolhe para
 * qualquer responsável, e cada um pode escolher para si.
 */
@Path("/api/families/{familyId}/notification-recipients")
@Authenticated
public class NotificationRecipientsResource {

    /** {@code mutedPersonIds}: pessoas de quem o responsável não recebe avisos nem lembretes. */
    public record RecipientView(UUID userId, String displayName, boolean admin, List<UUID> mutedPersonIds) {
    }

    public record Update(@NotNull @Size(max = 200) List<UUID> mutedPersonIds) {
    }

    private final FamilyAccess access;
    private final CurrentUser currentUser;
    private final AuditService audit;
    private final EntityManager em;

    public NotificationRecipientsResource(FamilyAccess access, CurrentUser currentUser, AuditService audit,
            EntityManager em) {
        this.access = access;
        this.currentUser = currentUser;
        this.audit = audit;
        this.em = em;
    }

    @GET
    public List<RecipientView> list(@PathParam("familyId") UUID familyId) {
        access.requireMember(familyId);
        return FamilyMember.listActive(familyId).stream().map(m -> view(familyId, m)).toList();
    }

    @PUT
    @Path("/{userId}")
    @Transactional
    public RecipientView update(@PathParam("familyId") UUID familyId, @PathParam("userId") UUID userId,
            @Valid @NotNull Update r) {
        FamilyMember me = access.requireMember(familyId);
        if (!userId.equals(currentUser.id()) && !me.isAdmin()) {
            throw ApiException.forbidden("Somente administradores escolhem os avisos de outro responsável.");
        }
        FamilyMember member = FamilyMember.listActive(familyId).stream().filter(m -> m.userId.equals(userId))
                .findFirst().orElseThrow(() -> ApiException.notFound("Responsável"));
        Set<UUID> muted = new HashSet<>(r.mutedPersonIds());
        for (UUID person : muted) {
            if (Person.findInFamily(familyId, person).isEmpty()) {
                throw ApiException.unprocessable("PERSON_NOT_FOUND", "A pessoa informada não pertence a esta família.");
            }
        }
        List<UUID> before = muted(familyId, userId);
        em.createNativeQuery("DELETE FROM notification_mute WHERE family_id = :f AND user_id = :u")
                .setParameter("f", familyId).setParameter("u", userId).executeUpdate();
        for (UUID person : muted) {
            em.createNativeQuery("""
                    INSERT INTO notification_mute (family_id, user_id, person_id, created_by)
                    VALUES (:f, :u, :p, :by)
                    """).setParameter("f", familyId).setParameter("u", userId).setParameter("p", person)
                    .setParameter("by", currentUser.id()).executeUpdate();
        }
        audit.record(familyId, currentUser.id(), "NOTIFICATION_RECIPIENTS", userId, "NOTIFICATION_RECIPIENTS_CHANGED",
                Map.of("mutedPersonIds", before), Map.of("mutedPersonIds", List.copyOf(muted)), null);
        return view(familyId, member);
    }

    private RecipientView view(UUID familyId, FamilyMember m) {
        AppUser user = AppUser.findById(m.userId);
        return new RecipientView(m.userId, user == null ? null : user.displayName, m.isAdmin(), muted(familyId, m.userId));
    }

    @SuppressWarnings("unchecked")
    private List<UUID> muted(UUID familyId, UUID userId) {
        return em.createNativeQuery("SELECT person_id FROM notification_mute WHERE family_id = :f AND user_id = :u",
                UUID.class).setParameter("f", familyId).setParameter("u", userId).getResultList();
    }
}
