package io.github.leandrocosta.remedios.push;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Lembrete avulso criado por um responsável (ex.: "medir a temperatura de novo"). */
@Entity
@Table(name = "custom_reminder")
public class CustomReminder extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "family_id", nullable = false)
    public UUID familyId;

    @Column(name = "person_id", nullable = false)
    public UUID personId;

    @Column(name = "created_by", nullable = false)
    public UUID createdBy;

    @Column(nullable = false)
    public String message;

    @Column(name = "remind_at", nullable = false)
    public Instant remindAt;

    @Column(name = "notify_all", nullable = false)
    public boolean notifyAll;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "sent_at")
    public Instant sentAt;

    @Column(name = "cancelled_at")
    public Instant cancelledAt;
}
