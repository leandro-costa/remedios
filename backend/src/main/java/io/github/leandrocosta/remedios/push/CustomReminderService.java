package io.github.leandrocosta.remedios.push;

import io.github.leandrocosta.remedios.common.ClientIds;
import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.common.Texts;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.user.CurrentUser;
import io.github.leandrocosta.remedios.user.UserNotificationSettings;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.transaction.Transactional;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@ApplicationScoped
public class CustomReminderService {

    static final String ENTITY = "CUSTOM_REMINDER";

    private final EntityManager em;
    private final Notifier notifier;
    private final CurrentUser currentUser;
    private final FamilyAccess access;
    private final AuditService audit;
    private final Duration maxDelay;

    public CustomReminderService(EntityManager em, Notifier notifier, CurrentUser currentUser, FamilyAccess access,
            AuditService audit, @ConfigProperty(name = "remedios.reminders.max-delay") Duration maxDelay) {
        this.em = em;
        this.notifier = notifier;
        this.currentUser = currentUser;
        this.access = access;
        this.audit = audit;
        this.maxDelay = maxDelay;
    }

    public List<CustomReminder> pending(UUID familyId, UUID personId) {
        access.requireMember(familyId);
        return CustomReminder.list("familyId = ?1 and personId = ?2 and sentAt is null and cancelledAt is null "
                + "order by remindAt", familyId, personId);
    }

    @Transactional
    public CustomReminder create(UUID familyId, UUID personId, UUID requestedId, String message, Instant remindAt, boolean notifyAll) {
        access.requireMember(familyId);
        Person.findInFamily(familyId, personId).orElseThrow(() -> ApiException.notFound("Pessoa"));
        String text = Texts.clean(message);
        if (text == null) {
            throw ApiException.unprocessable("INVALID_REMINDER", "Escreva o lembrete.");
        }
        Instant now = Instant.now();
        if (remindAt.isBefore(now.minus(Duration.ofMinutes(1))) || remindAt.isAfter(now.plus(Duration.ofDays(30)))) {
            throw ApiException.unprocessable("INVALID_REMINDER", "Escolha um horário entre agora e os próximos 30 dias.");
        }
        CustomReminder r = new CustomReminder();
        r.id = ClientIds.choose(requestedId, id -> CustomReminder.findById(id) != null);
        r.familyId = familyId;
        r.personId = personId;
        r.createdBy = currentUser.id();
        r.message = text;
        r.remindAt = remindAt;
        r.notifyAll = notifyAll;
        r.createdAt = now;
        r.persist();
        audit.record(familyId, currentUser.id(), ENTITY, r.id, "REMINDER_CREATED", null,
                Map.of("remindAt", remindAt.toString(), "notifyAll", notifyAll), null);
        return r;
    }

    @Transactional
    public void cancel(UUID familyId, UUID id) {
        access.requireMember(familyId);
        CustomReminder r = CustomReminder.findById(id);
        if (r == null || !r.familyId.equals(familyId)) {
            throw ApiException.notFound("Lembrete");
        }
        if (r.sentAt == null && r.cancelledAt == null) {
            r.cancelledAt = Instant.now();
            audit.record(familyId, currentUser.id(), ENTITY, r.id, "REMINDER_CANCELLED", null, null, null);
        }
    }

    /** Lembretes avulsos vencidos; marca como enviados na mesma transação (bloqueio sem espera). */
    List<Notifier.Delivery> plan(Instant now) {
        List<CustomReminder> due = em.createQuery("""
                from CustomReminder r where r.sentAt is null and r.cancelledAt is null and r.remindAt <= :now
                 order by r.remindAt""", CustomReminder.class)
                .setParameter("now", now)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setHint("jakarta.persistence.lock.timeout", -2) // SKIP LOCKED
                .setMaxResults(100)
                .getResultList();
        List<Notifier.Delivery> deliveries = new ArrayList<>();
        for (CustomReminder r : due) {
            r.sentAt = now;
            if (Duration.between(r.remindAt, now).compareTo(maxDelay.multipliedBy(4)) > 0) {
                continue; // velho demais (servidor ficou parado): não avisa fora de hora
            }
            List<UUID> users = r.notifyAll ? notifier.members(r.familyId, r.personId) : List.of(r.createdBy);
            Map<UUID, UserNotificationSettings> prefs = notifier.preferences(users);
            Person person = Person.findById(r.personId);
            notifier.subscriptions(users).forEach((user, subs) -> {
                UserNotificationSettings pref = prefs.get(user);
                for (PushSubscription sub : subs) {
                    String body = pref.lockScreenDetails ? person.displayName + ": " + r.message
                            : "Lembrete das " + Notifier.time(r.remindAt, sub) + ". Toque para ver.";
                    deliveries.add(new Notifier.Delivery(sub, new PushMessage("Lembrete", body, "reminder-" + r.id,
                            "/saude?pessoa=" + r.personId, !pref.soundEnabled, true, Notifier.vibrate(pref)),
                            PushService.Urgency.HIGH, Duration.ofHours(1)));
                }
            });
        }
        return deliveries;
    }
}
