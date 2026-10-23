package io.github.leandrocosta.remedios.push;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** Inscrição de push de um aparelho. */
@Entity
@Table(name = "push_subscription")
public class PushSubscription extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "user_id", nullable = false)
    public UUID userId;

    @Column(name = "device_id", nullable = false, unique = true)
    public UUID deviceId;

    @Column(nullable = false, unique = true)
    public String endpoint;

    @Column(nullable = false)
    public String p256dh;

    @Column(nullable = false)
    public String auth;

    @Column(nullable = false)
    public String timezone;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "last_success_at")
    public Instant lastSuccessAt;

    @Column(nullable = false)
    public int failures;

    @Column(name = "disabled_at")
    public Instant disabledAt;

    public static List<PushSubscription> activeFor(Collection<UUID> userIds) {
        return userIds.isEmpty() ? List.of() : list("userId in ?1 and disabledAt is null", userIds);
    }
}
