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

/**
 * Linha de referência de um gráfico, definida pela família conforme
 * orientação de um profissional de saúde. Apenas visual.
 */
@Entity
@Table(name = "reference_line")
public class ReferenceLine extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    /** null = vale para todas as pessoas da família. */
    @Column(name = "person_id")
    public UUID personId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public MeasurementType type;

    @Column(nullable = false, precision = 8, scale = 2)
    public BigDecimal value;

    @Column(precision = 8, scale = 2)
    public BigDecimal value2;

    @Column(nullable = false)
    public String label;

    @Column(name = "created_by", nullable = false)
    public UUID createdBy;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;
}
