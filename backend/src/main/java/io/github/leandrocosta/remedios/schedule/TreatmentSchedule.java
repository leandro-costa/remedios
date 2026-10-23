package io.github.leandrocosta.remedios.schedule;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.LockModeType;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Versão materializada da agenda de um tratamento, com vigência. */
@Entity
@Table(name = "treatment_schedule")
public class TreatmentSchedule extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "treatment_id", nullable = false)
    public UUID treatmentId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    public Map<String, Object> rule;

    @Column(nullable = false)
    public String timezone;

    @Column(name = "reminder_before_minutes", nullable = false)
    public int reminderBeforeMinutes;

    @Column(name = "repeat_interval_minutes", nullable = false)
    public int repeatIntervalMinutes;

    @Column(name = "repeat_limit", nullable = false)
    public int repeatLimit;

    @Column(name = "late_tolerance_minutes", nullable = false)
    public int lateToleranceMinutes;

    @Column(nullable = false)
    public long version;

    @Column(name = "valid_from", nullable = false)
    public Instant validFrom;

    @Column(name = "valid_until")
    public Instant validUntil;

    @Column(name = "generated_until")
    public Instant generatedUntil;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    public static Optional<TreatmentSchedule> lockCurrent(UUID treatmentId) {
        return find("treatmentId = ?1 and validUntil is null", treatmentId)
                .withLock(LockModeType.PESSIMISTIC_WRITE)
                .firstResultOptional();
    }

    public static long lastVersion(UUID treatmentId) {
        return getEntityManager()
                .createQuery("select coalesce(max(s.version), 0) from TreatmentSchedule s where s.treatmentId = :t",
                        Long.class)
                .setParameter("t", treatmentId)
                .getSingleResult();
    }
}
