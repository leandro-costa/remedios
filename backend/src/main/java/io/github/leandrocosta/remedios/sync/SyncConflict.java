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

/** Divergência aguardando revisão humana (seções 10.2 e 10.3). */
@Entity
@Table(name = "sync_conflict")
public class SyncConflict extends PanacheEntityBase {

    public enum Status { OPEN, RESOLVED }

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "entity_type", nullable = false)
    public String entityType;

    @Column(name = "entity_id", nullable = false)
    public UUID entityId;

    @Column(name = "base_version")
    public Long baseVersion;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Status status;

    @Column(nullable = false)
    public String reason;

    @JdbcTypeCode(SqlTypes.JSON)
    public Map<String, Object> details;

    @JdbcTypeCode(SqlTypes.JSON)
    public Map<String, Object> resolution;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "resolved_by")
    public UUID resolvedBy;

    @Column(name = "resolved_at")
    public Instant resolvedAt;

    public static Optional<SyncConflict> findOpen(String entityType, UUID entityId) {
        return find("entityType = ?1 and entityId = ?2 and status = ?3", entityType, entityId, Status.OPEN)
                .firstResultOptional();
    }
}
