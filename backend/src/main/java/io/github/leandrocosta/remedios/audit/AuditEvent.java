package io.github.leandrocosta.remedios.audit;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Registro imutável de uma alteração relevante (seção 9.2). */
@Entity
@Table(name = "audit_event")
public class AuditEvent extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "actor_id")
    public UUID actorId;

    @Column(name = "device_id")
    public UUID deviceId;

    @Column(name = "entity_type", nullable = false)
    public String entityType;

    @Column(name = "entity_id", nullable = false)
    public UUID entityId;

    @Column(name = "event_type", nullable = false)
    public String eventType;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_data")
    public Map<String, Object> beforeData;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_data")
    public Map<String, Object> afterData;

    public String reason;

    @Column(name = "occurred_at", nullable = false)
    public Instant occurredAt;

    @Column(name = "received_at", nullable = false)
    public Instant receivedAt;
}
