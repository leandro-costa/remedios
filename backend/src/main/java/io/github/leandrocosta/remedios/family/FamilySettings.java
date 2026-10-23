package io.github.leandrocosta.remedios.family;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Padrões compartilhados da família (seção 6.4). Servem de valores iniciais
 * para novos tratamentos; alterá-los não muda tratamentos existentes.
 */
@Entity
@Table(name = "family_settings")
public class FamilySettings extends PanacheEntityBase {

    public enum ConfirmationPolicy { IMPORTANT_ONLY, ALL, NONE }

    @Id
    @Column(name = "family_id")
    public UUID familyId;

    @Column(name = "reminder_before_minutes", nullable = false)
    public int reminderBeforeMinutes = 10;

    @Column(name = "repeat_interval_minutes", nullable = false)
    public int repeatIntervalMinutes = 15;

    @Column(name = "repeat_limit", nullable = false)
    public int repeatLimit = 4;

    @Column(name = "late_tolerance_minutes", nullable = false)
    public int lateToleranceMinutes = 30;

    @Enumerated(EnumType.STRING)
    @Column(name = "confirmation_policy", nullable = false)
    public ConfirmationPolicy confirmationPolicy = ConfirmationPolicy.IMPORTANT_ONLY;

    @Column(nullable = false)
    public long version = 1;

    @Column(name = "updated_by")
    public UUID updatedBy;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;
}
