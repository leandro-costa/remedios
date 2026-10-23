package io.github.leandrocosta.remedios.sync;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Proposta preservada dentro de um conflito. */
@Entity
@Table(name = "sync_conflict_change")
public class SyncConflictChange extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "conflict_id", nullable = false)
    public UUID conflictId;

    @Column(name = "operation_id", nullable = false)
    public UUID operationId;

    @Column(name = "base_version")
    public Long baseVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "proposed_data", nullable = false)
    public Map<String, Object> proposedData;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    public static List<SyncConflictChange> forConflict(UUID conflictId) {
        return list("conflictId = ?1 order by createdAt", conflictId);
    }
}
