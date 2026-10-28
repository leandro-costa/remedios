package io.github.leandrocosta.remedios.family;

import io.quarkus.security.Authenticated;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import java.util.UUID;

@Path("/api/invitations")
@Authenticated
public class InvitationResource {

    public record AcceptInvitation(@NotBlank String code) {
    }

    public record Accepted(UUID familyId, FamilyMember.Role role) {
    }

    private final FamilyService families;

    public InvitationResource(FamilyService families) {
        this.families = families;
    }

    @POST
    @Path("/accept")
    public Accepted accept(@Valid @NotNull AcceptInvitation request) {
        FamilyMember member = families.accept(request.code());
        return new Accepted(member.familyId, member.role);
    }
}
