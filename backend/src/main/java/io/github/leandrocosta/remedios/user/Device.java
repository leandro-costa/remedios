package io.github.leandrocosta.remedios.user;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Aparelho de um usuário. O id é gerado no próprio aparelho (UUID estável),
 * para que registros feitos offline já saiam com a origem (seção 4.2).
 */
@Entity
@Table(name = "device")
public class Device extends PanacheEntityBase {

    public enum Platform { ANDROID }

    public enum Status { ACTIVE, REVOKED }

    @Id
    public UUID id;

    @Column(name = "user_id", nullable = false)
    public UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Platform platform;

    public String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Status status;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "last_seen_at")
    public Instant lastSeenAt;

    @Column(name = "revoked_at")
    public Instant revokedAt;

    public static List<Device> listForUser(UUID userId) {
        return list("userId = ?1 order by createdAt", userId);
    }
}
