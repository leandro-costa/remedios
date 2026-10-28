package io.github.leandrocosta.remedios.family;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.LockModeType;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Entity
@Table(name = "family_invitation")
public class FamilyInvitation extends PanacheEntityBase {

    public enum Status { PENDING, ACCEPTED, REVOKED }

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "code_hash", nullable = false, unique = true)
    public String codeHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public FamilyMember.Role role;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Status status;

    @Column(name = "created_by", nullable = false)
    public UUID createdBy;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    public Instant expiresAt;

    @Column(name = "accepted_by")
    public UUID acceptedBy;

    @Column(name = "accepted_at")
    public Instant acceptedAt;

    public boolean isUsable(Instant now) {
        return status == Status.PENDING && now.isBefore(expiresAt);
    }

    public static Optional<FamilyInvitation> lockByCodeHash(String codeHash) {
        return find("codeHash", codeHash).withLock(LockModeType.PESSIMISTIC_WRITE).firstResultOptional();
    }
}
