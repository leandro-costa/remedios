package io.github.leandrocosta.remedios.audit;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Evento gravado na mesma transação da alteração e publicado depois por um
 * processo separado (transactional outbox, seção 11.3).
 */
@Entity
@Table(name = "outbox_event")
public class OutboxEvent extends PanacheEntityBase {

    public enum Status { PENDING, PUBLISHED, FAILED }

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "event_type", nullable = false)
    public String eventType;

    @Column(name = "aggregate_type", nullable = false)
    public String aggregateType;

    @Column(name = "aggregate_id", nullable = false)
    public UUID aggregateId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    public Map<String, Object> payload;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Status status;

    @Column(nullable = false)
    public int attempts;

    @Column(name = "next_attempt_at", nullable = false)
    public Instant nextAttemptAt;

    @Column(name = "last_error")
    public String lastError;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "published_at")
    public Instant publishedAt;
}
