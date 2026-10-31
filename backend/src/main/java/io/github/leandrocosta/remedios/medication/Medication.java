package io.github.leandrocosta.remedios.medication;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embeddable;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Medicamento da família, reaproveitado entre tratamentos: nome (comercial ou
 * genérico), forma, fabricante e as substâncias com a concentração do rótulo.
 * Só organiza; o app não compara nem sugere doses.
 */
@Entity
@Table(name = "medication")
public class Medication extends PanacheEntityBase {

    /** Substância (princípio ativo) e concentração, como no rótulo. */
    @Embeddable
    public static class Substance {

        @Column(name = "substance", nullable = false)
        public String substance;

        public String concentration;

        public Substance() {
        }

        public Substance(String substance, String concentration) {
            this.substance = substance;
            this.concentration = concentration;
        }
    }

    @Id
    public UUID id;

    @Column(name = "family_id")
    public UUID familyId;

    @Column(nullable = false)
    public String name;

    /** Forma farmacêutica (comprimido, gotas, xarope…). */
    public String form;

    public String manufacturer;

    /** Categoria regulatória da ANVISA, quando veio do catálogo. */
    public String category;

    public String notes;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "medication_substance", joinColumns = @JoinColumn(name = "medication_id"))
    @OrderColumn(name = "position")
    public List<Substance> substances = new ArrayList<>();

    @Column(name = "created_by")
    public UUID createdBy;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    public static Optional<Medication> findInFamily(UUID familyId, UUID id) {
        return find("familyId = ?1 and id = ?2", familyId, id).firstResultOptional();
    }

    /** O medicamento da família com este nome (sem diferenciar maiúsculas), se houver. */
    public static Optional<Medication> findByName(UUID familyId, String name) {
        String key = name == null ? "" : name.strip().toLowerCase(java.util.Locale.ROOT);
        return find("familyId = ?1 and lower(trim(name)) = ?2 order by createdAt", familyId, key)
                .firstResultOptional();
    }
}
