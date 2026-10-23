package io.github.leandrocosta.remedios.occurrence;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Administração informada por um responsável. Não é uma verificação física
 * (seção 4.2). Correções invalidam o registro ({@code voidedAt}) em vez de
 * apagá-lo; só um registro válido por ocorrência.
 */
@Entity
@Table(name = "administration_record")
public class AdministrationRecord extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "dose_occurrence_id", nullable = false)
    public UUID doseOccurrenceId;

    @Column(name = "recorded_by", nullable = false)
    public UUID recordedBy;

    @Column(name = "device_id", nullable = false)
    public UUID deviceId;

    @Column(name = "sync_operation_id")
    public UUID syncOperationId;

    /** Horário efetivo informado pelo responsável. */
    @Column(name = "administered_at", nullable = false)
    public Instant administeredAt;

    /** Quando o responsável registrou (no dispositivo). */
    @Column(name = "recorded_at", nullable = false)
    public Instant recordedAt;

    /** Quando o servidor recebeu. */
    @Column(name = "received_at", nullable = false)
    public Instant receivedAt;

    public String notes;

    @Column(name = "voided_at")
    public Instant voidedAt;

    @Column(name = "voided_by")
    public UUID voidedBy;

    @Column(name = "void_reason")
    public String voidReason;

    public static Optional<AdministrationRecord> findValid(UUID occurrenceId) {
        return find("doseOccurrenceId = ?1 and voidedAt is null", occurrenceId).firstResultOptional();
    }

    public static List<AdministrationRecord> listValid(Collection<UUID> occurrenceIds) {
        return occurrenceIds.isEmpty() ? List.of()
                : list("doseOccurrenceId in ?1 and voidedAt is null", occurrenceIds);
    }

    public static List<AdministrationRecord> listAll(UUID occurrenceId) {
        return list("doseOccurrenceId = ?1 order by receivedAt, recordedAt", occurrenceId);
    }
}
