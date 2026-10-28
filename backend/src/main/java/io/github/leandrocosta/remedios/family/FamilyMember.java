package io.github.leandrocosta.remedios.family;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Entity
@Table(name = "family_member")
public class FamilyMember extends PanacheEntityBase {

    public enum Role { ADMIN, MEMBER }

    public enum Status { ACTIVE, REMOVED }

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "user_id", nullable = false)
    public UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Role role;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Status status;

    @Column(name = "joined_at", nullable = false)
    public Instant joinedAt;

    @Column(name = "removed_at")
    public Instant removedAt;

    public boolean isActive() {
        return status == Status.ACTIVE;
    }

    public boolean isAdmin() {
        return isActive() && role == Role.ADMIN;
    }

    public static Optional<FamilyMember> find(UUID familyId, UUID userId) {
        return find("familyId = ?1 and userId = ?2", familyId, userId).firstResultOptional();
    }

    public static Optional<FamilyMember> findActive(UUID familyId, UUID userId) {
        return find(familyId, userId).filter(FamilyMember::isActive);
    }

    public static List<FamilyMember> listActive(UUID familyId) {
        return list("familyId = ?1 and status = ?2 order by joinedAt", familyId, Status.ACTIVE);
    }

    public static List<FamilyMember> listActiveForUser(UUID userId) {
        return list("userId = ?1 and status = ?2 order by joinedAt", userId, Status.ACTIVE);
    }

    public static long countActiveAdmins(UUID familyId) {
        return count("familyId = ?1 and status = ?2 and role = ?3", familyId, Status.ACTIVE, Role.ADMIN);
    }
}
