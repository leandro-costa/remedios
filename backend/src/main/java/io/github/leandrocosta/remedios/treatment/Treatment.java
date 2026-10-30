package io.github.leandrocosta.remedios.treatment;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.LockModeType;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Tratamento de uma pessoa. Dose, via e instruções são transcrições da
 * prescrição: o sistema as guarda e exibe, nunca as calcula ou ajusta.
 */
@Entity
@Table(name = "treatment")
public class Treatment extends PanacheEntityBase {

    /** {@code AS_NEEDED}: "se necessário", sem agenda; cada dose é registrada quando é dada. */
    public enum Kind { CONTINUOUS, OCCASIONAL, AS_NEEDED }

    public enum Status {
        /** Cadastrado, aguardando conferência antes de ativar a agenda (seção 4.1, passo 6). */
        DRAFT,
        ACTIVE,
        SUSPENDED,
        ENDED;

        private static final Map<Status, Set<Status>> ALLOWED = Map.of(
                DRAFT, EnumSet.of(ACTIVE, ENDED),
                ACTIVE, EnumSet.of(SUSPENDED, ENDED),
                SUSPENDED, EnumSet.of(ACTIVE, ENDED),
                ENDED, EnumSet.noneOf(Status.class));

        public boolean canTransitionTo(Status target) {
            return ALLOWED.get(this).contains(target);
        }
    }

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "person_id", nullable = false)
    public UUID personId;

    @Column(name = "medication_id")
    public UUID medicationId;

    @Column(nullable = false)
    public String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Kind kind;

    @Column(name = "prescribed_dose", nullable = false)
    public String prescribedDose;

    public String route;

    public String instructions;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Status status;

    @Column(name = "start_at", nullable = false)
    public Instant startAt;

    @Column(name = "end_at")
    public Instant endAt;

    /** Término por número de doses (excludente com {@code endAt}); a primeira é a de {@code startAt}. */
    @Column(name = "dose_count")
    public Integer doseCount;

    /** Regra de agenda (ScheduleRule em JSON); obrigatória para ativar. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "schedule_rule")
    public Map<String, Object> scheduleRule;

    /** Versão compartilhada; controlada pela aplicação, não pelo Hibernate. */
    @Column(nullable = false)
    public long version;

    @Column(name = "created_by", nullable = false)
    public UUID createdBy;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "updated_by", nullable = false)
    public UUID updatedBy;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    public static Optional<Treatment> findInFamily(UUID familyId, UUID treatmentId) {
        return find("familyId = ?1 and id = ?2", familyId, treatmentId).firstResultOptional();
    }

    public static Optional<Treatment> lockInFamily(UUID familyId, UUID treatmentId) {
        return find("familyId = ?1 and id = ?2", familyId, treatmentId)
                .withLock(LockModeType.PESSIMISTIC_WRITE)
                .firstResultOptional();
    }
}
