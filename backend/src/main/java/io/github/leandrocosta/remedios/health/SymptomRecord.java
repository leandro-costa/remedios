package io.github.leandrocosta.remedios.health;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Sintoma ou possível reação observada; pode estar em andamento (sem fim). */
@Entity
@Table(name = "symptom_record")
public class SymptomRecord extends PanacheEntityBase {

    public enum Intensity { MILD, MODERATE, SEVERE }

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "person_id", nullable = false)
    public UUID personId;

    @Column(nullable = false)
    public String description;

    @Enumerated(EnumType.STRING)
    public Intensity intensity;

    @Column(name = "started_at", nullable = false)
    public Instant startedAt;

    @Column(name = "ended_at")
    public Instant endedAt;

    @Column(name = "treatment_id")
    public UUID treatmentId;

    public String notes;

    @Column(nullable = false)
    public long version;

    @Column(name = "recorded_by", nullable = false)
    public UUID recordedBy;

    @Column(name = "device_id", nullable = false)
    public UUID deviceId;

    @Column(name = "recorded_at", nullable = false)
    public Instant recordedAt;

    @Column(name = "received_at", nullable = false)
    public Instant receivedAt;

    @Column(name = "updated_by")
    public UUID updatedBy;

    @Column(name = "updated_at")
    public Instant updatedAt;

    @Column(name = "voided_at")
    public Instant voidedAt;

    @Column(name = "voided_by")
    public UUID voidedBy;

    @Column(name = "void_reason")
    public String voidReason;
}
