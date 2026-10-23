package io.github.leandrocosta.remedios.health;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Aferição registrada por um responsável. Imutável; correções criam outro registro. */
@Entity
@Table(name = "measurement")
public class Measurement extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "person_id", nullable = false)
    public UUID personId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public MeasurementType type;

    @Column(nullable = false, precision = 8, scale = 2)
    public BigDecimal value;

    @Column(precision = 8, scale = 2)
    public BigDecimal value2;

    @Column(nullable = false)
    public String unit;

    public String label;

    public String method;

    @Column(name = "measured_at", nullable = false)
    public Instant measuredAt;

    public String notes;

    @Column(name = "recorded_by", nullable = false)
    public UUID recordedBy;

    @Column(name = "device_id", nullable = false)
    public UUID deviceId;

    @Column(name = "recorded_at", nullable = false)
    public Instant recordedAt;

    @Column(name = "received_at", nullable = false)
    public Instant receivedAt;

    @Column(name = "replaces_id")
    public UUID replacesId;

    @Column(name = "voided_at")
    public Instant voidedAt;

    @Column(name = "voided_by")
    public UUID voidedBy;

    @Column(name = "void_reason")
    public String voidReason;
}
