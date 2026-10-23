package io.github.leandrocosta.remedios.person;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/** Pessoa acompanhada: criança sem conta ou adulto associado a uma conta (seção 3.3). */
@Entity
@Table(name = "person")
public class Person extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "user_id")
    public UUID userId;

    @Column(name = "display_name", nullable = false)
    public String displayName;

    @Column(name = "birth_date")
    public LocalDate birthDate;

    @Column(nullable = false)
    public boolean active = true;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    public static Optional<Person> findInFamily(UUID familyId, UUID personId) {
        return find("familyId = ?1 and id = ?2", familyId, personId).firstResultOptional();
    }

    public static Optional<Person> findLinked(UUID familyId, UUID userId) {
        return find("familyId = ?1 and userId = ?2", familyId, userId).firstResultOptional();
    }
}
