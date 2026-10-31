package io.github.leandrocosta.remedios.prescription;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/**
 * Receita: agrupa os tratamentos (itens) de uma pessoa, como numa receita do
 * médico. Cada item tem medicamento, dose, agenda e situação próprios; a
 * situação da receita é calculada a partir deles.
 */
@Entity
@Table(name = "prescription")
public class Prescription extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "person_id", nullable = false)
    public UUID personId;

    public String title;

    public String prescriber;

    @Column(name = "prescribed_on")
    public LocalDate prescribedOn;

    public String notes;

    @Column(name = "created_by", nullable = false)
    public UUID createdBy;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    @Column(name = "deleted_at")
    public Instant deletedAt;

    @Column(name = "deleted_by")
    public UUID deletedBy;

    @Column(name = "delete_reason")
    public String deleteReason;

    public static Optional<Prescription> findInFamily(UUID familyId, UUID id) {
        return find("familyId = ?1 and id = ?2 and deletedAt is null", familyId, id).firstResultOptional();
    }
}
