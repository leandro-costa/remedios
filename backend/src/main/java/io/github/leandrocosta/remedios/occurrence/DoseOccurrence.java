package io.github.leandrocosta.remedios.occurrence;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.LockModeType;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Dose prevista para um horário concreto (seção 5.1).
 *
 * <p>Persistimos {@code SCHEDULED} até haver um desfecho; "pendente" (horário
 * alcançado) e "atrasada" (além da tolerância) são calculados na leitura a
 * partir do horário previsto, sem job para mudar o estado.
 */
@Entity
@Table(name = "dose_occurrence")
public class DoseOccurrence extends PanacheEntityBase {

    public enum Status { SCHEDULED, PENDING, ADMINISTERED, NOT_ADMINISTERED, CANCELLED, REVIEW_REQUIRED }

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "treatment_id", nullable = false)
    public UUID treatmentId;

    /** Nulo nas doses "se necessário", que não pertencem a uma agenda. */
    @Column(name = "schedule_id")
    public UUID scheduleId;

    @Column(name = "slot_key", nullable = false)
    public String slotKey;

    @Column(name = "scheduled_at", nullable = false)
    public Instant scheduledAt;

    @Column(name = "schedule_version")
    public Long scheduleVersion;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Status status;

    @Column(nullable = false)
    public long version;

    @Column(name = "status_reason")
    public String statusReason;

    @Column(name = "status_changed_by")
    public UUID statusChangedBy;

    @Column(name = "status_changed_at")
    public Instant statusChangedAt;

    /** "Estou cuidando desta dose" (seção 6.3): não é administração. */
    @Column(name = "claimed_by")
    public UUID claimedBy;

    @Column(name = "claimed_until")
    public Instant claimedUntil;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    public boolean isOpen() {
        return status == Status.SCHEDULED || status == Status.PENDING;
    }

    public static Optional<DoseOccurrence> findInFamily(UUID familyId, UUID id) {
        return find("familyId = ?1 and id = ?2", familyId, id).firstResultOptional();
    }

    public static Optional<DoseOccurrence> lockInFamily(UUID familyId, UUID id) {
        return find("familyId = ?1 and id = ?2", familyId, id)
                .withLock(LockModeType.PESSIMISTIC_WRITE)
                .firstResultOptional();
    }
}
