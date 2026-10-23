package io.github.leandrocosta.remedios.family;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.LockModeType;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "family")
public class Family extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(nullable = false)
    public String name;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    /**
     * Bloqueia a linha da família até o fim da transação. Serializa operações
     * que dependem do conjunto de membros (ex.: preservar ao menos um
     * administrador).
     */
    public static Family lock(UUID id) {
        return findById(id, LockModeType.PESSIMISTIC_WRITE);
    }
}
