package io.github.leandrocosta.remedios.family;

import io.github.leandrocosta.remedios.user.AppUser;
import io.github.leandrocosta.remedios.user.CurrentUser;
import io.quarkus.security.Authenticated;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Path("/api/families")
@Authenticated
public class FamilyResource {

    public record CreateFamily(@NotBlank @Size(max = 120) String name) {
    }

    public record FamilyView(UUID id, String name, FamilyMember.Role myRole, Instant createdAt) {
    }

    public record MemberView(UUID userId, String displayName, FamilyMember.Role role, Instant joinedAt) {
    }

    public record ChangeRole(@NotNull FamilyMember.Role role) {
    }

    public record CreateInvitation(FamilyMember.Role role) {
    }

    /** O código só é devolvido na criação; o servidor guarda apenas o hash. */
    public record IssuedInvitationView(UUID id, String code, FamilyMember.Role role, Instant expiresAt) {
    }

    public record InvitationView(UUID id, FamilyMember.Role role, UUID createdBy, Instant createdAt,
            Instant expiresAt) {
    }

    public record SettingsView(int reminderBeforeMinutes, int repeatIntervalMinutes, int repeatLimit,
            int lateToleranceMinutes, FamilySettings.ConfirmationPolicy confirmationPolicy, long version) {

        static SettingsView of(FamilySettings s) {
            return new SettingsView(s.reminderBeforeMinutes, s.repeatIntervalMinutes, s.repeatLimit,
                    s.lateToleranceMinutes, s.confirmationPolicy, s.version);
        }
    }

    public record UpdateSettings(
            @NotNull @Min(0) @Max(1440) Integer reminderBeforeMinutes,
            @NotNull @Min(1) @Max(1440) Integer repeatIntervalMinutes,
            @NotNull @Min(0) @Max(100) Integer repeatLimit,
            @NotNull @Min(0) @Max(1440) Integer lateToleranceMinutes,
            @NotNull FamilySettings.ConfirmationPolicy confirmationPolicy,
            @NotNull Long baseVersion) {
    }

    private final FamilyService families;
    private final FamilyAccess access;
    private final CurrentUser currentUser;

    public FamilyResource(FamilyService families, FamilyAccess access, CurrentUser currentUser) {
        this.families = families;
        this.access = access;
        this.currentUser = currentUser;
    }

    @POST
    public Response create(@Valid @NotNull CreateFamily request) {
        FamilyMember member = families.create(request.name());
        Family family = Family.findById(member.familyId);
        return Response.status(Response.Status.CREATED).entity(view(family, member)).build();
    }

    @GET
    public List<FamilyView> mine() {
        return FamilyMember.listActiveForUser(currentUser.id()).stream()
                .map(m -> view(Family.findById(m.familyId), m))
                .toList();
    }

    @GET
    @Path("/{familyId}")
    public FamilyView get(@PathParam("familyId") UUID familyId) {
        FamilyMember member = access.requireMember(familyId);
        return view(Family.findById(familyId), member);
    }

    @PUT
    @Path("/{familyId}")
    public FamilyView rename(@PathParam("familyId") UUID familyId, @Valid @NotNull CreateFamily request) {
        Family family = families.rename(familyId, request.name());
        return view(family, access.requireMember(familyId));
    }

    // --- Membros --------------------------------------------------------------

    @GET
    @Path("/{familyId}/members")
    public List<MemberView> members(@PathParam("familyId") UUID familyId) {
        access.requireMember(familyId);
        List<FamilyMember> members = FamilyMember.listActive(familyId);
        Map<UUID, AppUser> users = AppUser.<AppUser>list("id in ?1", members.stream().map(m -> m.userId).toList())
                .stream().collect(Collectors.toMap(u -> u.id, Function.identity()));
        return members.stream()
                .map(m -> new MemberView(m.userId, users.get(m.userId).displayName, m.role, m.joinedAt))
                .toList();
    }

    @PUT
    @Path("/{familyId}/members/{userId}/role")
    public MemberView changeRole(@PathParam("familyId") UUID familyId, @PathParam("userId") UUID userId,
            @Valid @NotNull ChangeRole request) {
        FamilyMember m = families.changeRole(familyId, userId, request.role());
        AppUser user = AppUser.findById(userId);
        return new MemberView(m.userId, user.displayName, m.role, m.joinedAt);
    }

    @DELETE
    @Path("/{familyId}/members/{userId}")
    public Response removeMember(@PathParam("familyId") UUID familyId, @PathParam("userId") UUID userId) {
        families.removeMember(familyId, userId);
        return Response.noContent().build();
    }

    // --- Convites -------------------------------------------------------------

    @POST
    @Path("/{familyId}/invitations")
    public Response invite(@PathParam("familyId") UUID familyId, @Valid CreateInvitation request) {
        FamilyMember.Role role = request == null || request.role() == null ? FamilyMember.Role.MEMBER
                : request.role();
        FamilyService.IssuedInvitation issued = families.invite(familyId, role);
        FamilyInvitation i = issued.invitation();
        return Response.status(Response.Status.CREATED)
                .entity(new IssuedInvitationView(i.id, issued.code(), i.role, i.expiresAt))
                .build();
    }

    @GET
    @Path("/{familyId}/invitations")
    public List<InvitationView> invitations(@PathParam("familyId") UUID familyId) {
        return families.pendingInvitations(familyId).stream()
                .map(i -> new InvitationView(i.id, i.role, i.createdBy, i.createdAt, i.expiresAt))
                .toList();
    }

    @DELETE
    @Path("/{familyId}/invitations/{invitationId}")
    public Response revokeInvitation(@PathParam("familyId") UUID familyId,
            @PathParam("invitationId") UUID invitationId) {
        families.revokeInvitation(familyId, invitationId);
        return Response.noContent().build();
    }

    // --- Padrões --------------------------------------------------------------

    @GET
    @Path("/{familyId}/settings")
    public SettingsView settings(@PathParam("familyId") UUID familyId) {
        return SettingsView.of(families.settings(familyId));
    }

    @PUT
    @Path("/{familyId}/settings")
    public SettingsView updateSettings(@PathParam("familyId") UUID familyId,
            @Valid @NotNull UpdateSettings r) {
        return SettingsView.of(families.updateSettings(familyId, new FamilyService.SettingsChange(
                r.reminderBeforeMinutes(), r.repeatIntervalMinutes(), r.repeatLimit(), r.lateToleranceMinutes(),
                r.confirmationPolicy(), r.baseVersion())));
    }

    private static FamilyView view(Family family, FamilyMember member) {
        return new FamilyView(family.id, family.name, member.role, family.createdAt);
    }
}
