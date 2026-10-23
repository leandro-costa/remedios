package io.github.leandrocosta.remedios.sync;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Operação recebida de um aparelho (seção 10.1). O par (aparelho, chave) é
 * único: reenviar a mesma operação devolve o resultado anterior sem repetir
 * os efeitos.
 */
@Entity
@Table(name = "sync_operation")
public class SyncOperation extends PanacheEntityBase {

    public enum Status { RECEIVED, APPLIED, CONFLICT, REJECTED }

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "device_id", nullable = false)
    public UUID deviceId;

    @Column(name = "actor_id", nullable = false)
    public UUID actorId;

    @Column(name = "operation_key", nullable = false)
    public UUID operationKey;

    @Column(name = "operation_type", nullable = false)
    public String operationType;

    @Column(name = "entity_type", nullable = false)
    public String entityType;

    @Column(name = "entity_id", nullable = false)
    public UUID entityId;

    @Column(name = "base_version")
    public Long baseVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    public Map<String, Object> payload;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Status status;

    @JdbcTypeCode(SqlTypes.JSON)
    public Map<String, Object> result;

    @Column(name = "received_at", nullable = false)
    public Instant receivedAt;

    @Column(name = "processed_at")
    public Instant processedAt;

    public void finish(Status status, Map<String, Object> result) {
        this.status = status;
        this.result = result;
        this.processedAt = Instant.now();
    }

    public static Optional<SyncOperation> find(UUID deviceId, UUID operationKey) {
        return find("deviceId = ?1 and operationKey = ?2", deviceId, operationKey).firstResultOptional();
    }
}
