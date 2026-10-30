package io.github.leandrocosta.remedios.treatment;

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

/** Fotografia imutável de cada versão do tratamento. */
@Entity
@Table(name = "treatment_revision")
public class TreatmentRevision extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "treatment_id", nullable = false)
    public UUID treatmentId;

    @Column(nullable = false)
    public long version;

    @Column(name = "base_version")
    public Long baseVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    public Map<String, Object> snapshot;

    @Column(name = "effective_from", nullable = false)
    public Instant effectiveFrom;

    @Column(name = "change_reason")
    public String changeReason;

    /** Nulo quando foi o próprio sistema (ex.: fim do período previsto). */
    @Column(name = "created_by")
    public UUID createdBy;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    public static List<TreatmentRevision> forTreatment(UUID treatmentId) {
        return list("treatmentId = ?1 order by version", treatmentId);
    }
}
