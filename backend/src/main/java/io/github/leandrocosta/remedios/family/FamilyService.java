package io.github.leandrocosta.remedios.family;

import io.github.leandrocosta.remedios.common.ClientIds;
import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.VersionConflictException;
import io.github.leandrocosta.remedios.user.AppUser;
import io.github.leandrocosta.remedios.user.CurrentUser;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@ApplicationScoped
public class FamilyService {

    static final String FAMILY = "FAMILY";
    static final String MEMBER = "FAMILY_MEMBER";
    static final String INVITATION = "FAMILY_INVITATION";
    static final String SETTINGS = "FAMILY_SETTINGS";

    private static final SecureRandom RANDOM = new SecureRandom();

    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final AuditService audit;
    private final Duration invitationTtl;

    public FamilyService(CurrentUser currentUser, FamilyAccess access, AuditService audit,
            @ConfigProperty(name = "remedios.invitation.ttl") Duration invitationTtl) {
        this.currentUser = currentUser;
        this.access = access;
        this.audit = audit;
        this.invitationTtl = invitationTtl;
    }

    // --- Família --------------------------------------------------------------

    @Transactional
    public FamilyMember create(UUID requestedId, String name) {
        UUID actor = currentUser.id();
        Instant now = Instant.now();

        Family family = new Family();
        family.id = ClientIds.choose(requestedId, id -> Family.findById(id) != null);
        family.name = name.strip();
        family.createdAt = now;
        family.persist();

        FamilySettings settings = new FamilySettings();
        settings.familyId = family.id;
        settings.updatedBy = actor;
        settings.updatedAt = now;
        settings.persist();

        FamilyMember member = newMember(family.id, actor, FamilyMember.Role.ADMIN, now);
        member.persist();

        audit.record(family.id, actor, FAMILY, family.id, "FAMILY_CREATED", null, Map.of("name", family.name),
                null);
        audit.record(family.id, actor, MEMBER, member.id, "MEMBER_JOINED", null, memberData(member), null);
        return member;
    }

    @Transactional
    public Family rename(UUID familyId, String name) {
        access.requireAdmin(familyId);
        Family family = Family.findById(familyId);
        String before = family.name;
        family.name = name.strip();
        audit.record(familyId, currentUser.id(), FAMILY, familyId, "FAMILY_RENAMED", Map.of("name", before),
                Map.of("name", family.name), null);
        return family;
    }

    // --- Membros --------------------------------------------------------------

    @Transactional
    public FamilyMember changeRole(UUID familyId, UUID userId, FamilyMember.Role role) {
        access.requireAdmin(familyId);
        Family.lock(familyId);
        FamilyMember member = FamilyMember.findActive(familyId, userId)
                .orElseThrow(() -> ApiException.notFound("Membro"));
        if (member.role == role) {
            return member;
        }
        if (member.role == FamilyMember.Role.ADMIN && FamilyMember.countActiveAdmins(familyId) <= 1) {
            throw ApiException.conflict("LAST_ADMIN", "A família precisa manter ao menos um administrador.");
        }
        Map<String, Object> before = memberData(member);
        member.role = role;
        audit.record(familyId, currentUser.id(), MEMBER, member.id, "MEMBER_ROLE_CHANGED", before,
                memberData(member), null);
        return member;
    }

    /** Remove um membro. Administradores removem qualquer membro; os demais, apenas a si mesmos. */
    @Transactional
    public void removeMember(UUID familyId, UUID userId) {
        FamilyMember self = access.requireMember(familyId);
        if (!self.isAdmin() && !self.userId.equals(userId)) {
            throw ApiException.forbidden("Somente administradores podem remover outros membros.");
        }
        Family.lock(familyId);
        FamilyMember member = FamilyMember.findActive(familyId, userId)
                .orElseThrow(() -> ApiException.notFound("Membro"));
        if (member.role == FamilyMember.Role.ADMIN && FamilyMember.countActiveAdmins(familyId) <= 1) {
            throw ApiException.conflict("LAST_ADMIN", "A família precisa manter ao menos um administrador.");
        }
        Map<String, Object> before = memberData(member);
        member.status = FamilyMember.Status.REMOVED;
        member.removedAt = Instant.now();
        audit.record(familyId, currentUser.id(), MEMBER, member.id, "MEMBER_REMOVED", before, memberData(member),
                null);
        audit.publish(familyId, "MEMBER_REMOVED", MEMBER, member.id, Map.of("userId", userId));
    }

    // --- Convites -------------------------------------------------------------

    public record IssuedInvitation(FamilyInvitation invitation, String code) {
    }

    @Transactional
    public IssuedInvitation invite(UUID familyId, FamilyMember.Role role) {
        access.requireAdmin(familyId);
        byte[] raw = new byte[24];
        RANDOM.nextBytes(raw);
        String code = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        Instant now = Instant.now();

        FamilyInvitation invitation = new FamilyInvitation();
        invitation.id = UUID.randomUUID();
        invitation.familyId = familyId;
        invitation.codeHash = hash(code);
        invitation.role = role;
        invitation.status = FamilyInvitation.Status.PENDING;
        invitation.createdBy = currentUser.id();
        invitation.createdAt = now;
        invitation.expiresAt = now.plus(invitationTtl);
        invitation.persist();

        audit.record(familyId, currentUser.id(), INVITATION, invitation.id, "INVITATION_CREATED", null,
                Map.of("role", role, "expiresAt", invitation.expiresAt.toString()), null);
        return new IssuedInvitation(invitation, code);
    }

    public List<FamilyInvitation> pendingInvitations(UUID familyId) {
        access.requireAdmin(familyId);
        return FamilyInvitation.list("familyId = ?1 and status = ?2 and expiresAt > ?3 order by createdAt",
                familyId, FamilyInvitation.Status.PENDING, Instant.now());
    }

    @Transactional
    public void revokeInvitation(UUID familyId, UUID invitationId) {
        access.requireAdmin(familyId);
        FamilyInvitation invitation = FamilyInvitation.findById(invitationId);
        if (invitation == null || !invitation.familyId.equals(familyId)) {
            throw ApiException.notFound("Convite");
        }
        if (invitation.status != FamilyInvitation.Status.PENDING) {
            throw ApiException.conflict("INVITATION_NOT_PENDING", "O convite já foi usado ou revogado.");
        }
        invitation.status = FamilyInvitation.Status.REVOKED;
        audit.record(familyId, currentUser.id(), INVITATION, invitation.id, "INVITATION_REVOKED", null, null,
                null);
    }

    /** Aceita um convite. Um ex-membro removido volta a ficar ativo com o papel do convite. */
    @Transactional
    public FamilyMember accept(String code) {
        AppUser user = currentUser.get();
        Instant now = Instant.now();
        FamilyInvitation invitation = FamilyInvitation.lockByCodeHash(hash(code.strip()))
                .filter(i -> i.isUsable(now))
                .orElseThrow(() -> ApiException.notFound("Convite válido"));
        Family.lock(invitation.familyId);

        FamilyMember member = FamilyMember.find(invitation.familyId, user.id).orElse(null);
        Map<String, Object> before = null;
        if (member == null) {
            member = newMember(invitation.familyId, user.id, invitation.role, now);
            member.persist();
        } else if (member.isActive()) {
            throw ApiException.conflict("ALREADY_MEMBER", "Você já participa desta família.");
        } else {
            before = memberData(member);
            member.status = FamilyMember.Status.ACTIVE;
            member.role = invitation.role;
            member.joinedAt = now;
            member.removedAt = null;
        }

        invitation.status = FamilyInvitation.Status.ACCEPTED;
        invitation.acceptedBy = user.id;
        invitation.acceptedAt = now;

        audit.record(invitation.familyId, user.id, MEMBER, member.id, "MEMBER_JOINED", before, memberData(member),
                null);
        audit.publish(invitation.familyId, "MEMBER_JOINED", MEMBER, member.id, Map.of("userId", user.id));
        return member;
    }

    // --- Padrões --------------------------------------------------------------

    public record SettingsChange(int reminderBeforeMinutes, int repeatIntervalMinutes, int repeatLimit,
            int lateToleranceMinutes, FamilySettings.ConfirmationPolicy confirmationPolicy, long baseVersion) {
    }

    public FamilySettings settings(UUID familyId) {
        access.requireMember(familyId);
        return FamilySettings.findById(familyId);
    }

    @Transactional
    public FamilySettings updateSettings(UUID familyId, SettingsChange change) {
        access.requireAdmin(familyId);
        FamilySettings s = FamilySettings.findById(familyId, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        if (s.version != change.baseVersion()) {
            throw new VersionConflictException("Os padrões da família", s.version);
        }
        Map<String, Object> before = settingsData(s);
        s.reminderBeforeMinutes = change.reminderBeforeMinutes();
        s.repeatIntervalMinutes = change.repeatIntervalMinutes();
        s.repeatLimit = change.repeatLimit();
        s.lateToleranceMinutes = change.lateToleranceMinutes();
        s.confirmationPolicy = change.confirmationPolicy();
        s.version++;
        s.updatedBy = currentUser.id();
        s.updatedAt = Instant.now();
        audit.record(familyId, currentUser.id(), SETTINGS, familyId, "FAMILY_SETTINGS_UPDATED", before,
                settingsData(s), null);
        return s;
    }

    // --- Auxiliares -----------------------------------------------------------

    private static FamilyMember newMember(UUID familyId, UUID userId, FamilyMember.Role role, Instant now) {
        FamilyMember member = new FamilyMember();
        member.id = UUID.randomUUID();
        member.familyId = familyId;
        member.userId = userId;
        member.role = role;
        member.status = FamilyMember.Status.ACTIVE;
        member.joinedAt = now;
        return member;
    }

    private static Map<String, Object> memberData(FamilyMember m) {
        return Map.of("userId", m.userId, "role", m.role, "status", m.status);
    }

    private static Map<String, Object> settingsData(FamilySettings s) {
        return Map.of("reminderBeforeMinutes", s.reminderBeforeMinutes,
                "repeatIntervalMinutes", s.repeatIntervalMinutes,
                "repeatLimit", s.repeatLimit,
                "lateToleranceMinutes", s.lateToleranceMinutes,
                "confirmationPolicy", s.confirmationPolicy,
                "version", s.version);
    }

    static String hash(String code) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(code.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
