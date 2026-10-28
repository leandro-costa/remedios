package io.github.leandrocosta.remedios.push;

import io.github.leandrocosta.remedios.occurrence.DoseOccurrence;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.schedule.TreatmentSchedule;
import io.github.leandrocosta.remedios.treatment.Treatment;
import io.github.leandrocosta.remedios.user.UserNotificationSettings;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Lembretes de dose (seção 6.2): antecipado, no horário e repetições enquanto
 * a dose estiver em aberto, até o limite da agenda. Parar de lembrar nunca
 * significa que a dose foi dada.
 */
@ApplicationScoped
public class ReminderService {

    static final int SLOT_EARLY = -1;
    /** Aviso que substitui o lembrete quando a dose é decidida. */
    static final int SLOT_DONE = 1000;
    /** Lembrete adiado ("Lembrar daqui a pouco"): 200 + número do adiamento. */
    static final int SLOT_SNOOZE = 200;

    private final EntityManager em;
    private final Notifier notifier;
    private final PushService push;
    private final CustomReminderService custom;
    private final Duration maxDelay;

    public ReminderService(EntityManager em, Notifier notifier, PushService push, CustomReminderService custom,
            @ConfigProperty(name = "remedios.reminders.max-delay") Duration maxDelay) {
        this.em = em;
        this.notifier = notifier;
        this.push = push;
        this.custom = custom;
        this.maxDelay = maxDelay;
    }

    record Slot(int number, Instant at) {
    }

    /** Lembrete adiado por um responsável; {@code times} numera o adiamento. */
    record Snooze(Instant remindAt, int times) {
    }

    /** Envia os lembretes devidos até {@code now}. Seguro com várias instâncias (ver reminder_log). */
    public int tick(Instant now) {
        if (!push.enabled()) {
            return 0;
        }
        List<Notifier.Delivery> deliveries = new ArrayList<>(
                QuarkusTransaction.requiringNew().call(() -> plan(now)));
        deliveries.addAll(QuarkusTransaction.requiringNew().call(() -> custom.plan(now)));
        notifier.deliver(deliveries);
        return deliveries.size();
    }

    /** Lembretes devidos de uma dose, para um responsável (puro, sem banco). */
    static List<Slot> slots(Instant scheduledAt, TreatmentSchedule s, UserNotificationSettings prefs) {
        List<Slot> slots = new ArrayList<>();
        if (s.reminderBeforeMinutes > 0 && prefs.earlyReminderEnabled) {
            slots.add(new Slot(SLOT_EARLY, scheduledAt.minus(Duration.ofMinutes(s.reminderBeforeMinutes))));
        }
        slots.add(new Slot(0, scheduledAt));
        int interval = prefs.repeatIntervalMinutes != null ? prefs.repeatIntervalMinutes : s.repeatIntervalMinutes;
        for (int k = 1; k <= s.repeatLimit; k++) {
            slots.add(new Slot(k, scheduledAt.plus(Duration.ofMinutes((long) k * interval))));
        }
        return slots;
    }

    /**
     * Lembrete devido considerando um adiamento: até a hora pedida, nenhum
     * lembrete da agenda é enviado; na hora, vai um lembrete próprio, e
     * depois a agenda segue normalmente. A dose não muda de horário.
     */
    static Slot due(List<Slot> slots, Snooze snooze, Instant now, Duration maxDelay) {
        if (snooze == null || snooze.remindAt() == null) {
            return due(slots, now, maxDelay);
        }
        if (now.isBefore(snooze.remindAt())) {
            return null;
        }
        List<Slot> all = new ArrayList<>(slots);
        all.add(new Slot(SLOT_SNOOZE + snooze.times(), snooze.remindAt()));
        return due(all, now, maxDelay);
    }

    /** O lembrete mais recente já vencido, se ainda não estiver velho demais (ex.: servidor parado). */
    static Slot due(List<Slot> slots, Instant now, Duration maxDelay) {
        Slot latest = null;
        for (Slot slot : slots) {
            if (!slot.at().isAfter(now) && (latest == null || slot.at().isAfter(latest.at()))) {
                latest = slot;
            }
        }
        return latest == null || Duration.between(latest.at(), now).compareTo(maxDelay) > 0 ? null : latest;
    }

    private List<Notifier.Delivery> plan(Instant now) {
        List<Object[]> rows = em.createQuery("""
                select o, s from DoseOccurrence o, TreatmentSchedule s
                 where s.id = o.scheduleId and o.status = :open
                   and o.scheduledAt > :from and o.scheduledAt < :to
                """, Object[].class)
                .setParameter("open", DoseOccurrence.Status.SCHEDULED)
                .setParameter("from", now.minus(Duration.ofHours(48)))
                .setParameter("to", now.plus(Duration.ofMinutes(1441)))
                .getResultList();
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<UUID, Treatment> treatments = Treatment.<Treatment>list("id in ?1",
                rows.stream().map(r -> ((DoseOccurrence) r[0]).treatmentId).distinct().toList()).stream()
                .collect(Collectors.toMap(t -> t.id, Function.identity()));
        Map<UUID, Person> persons = Person.<Person>list("id in ?1",
                treatments.values().stream().map(t -> t.personId).distinct().toList()).stream()
                .collect(Collectors.toMap(p -> p.id, Function.identity()));

        Map<String, Snooze> snoozes = snoozes(rows.stream().map(r -> ((DoseOccurrence) r[0]).id).toList());

        List<Notifier.Delivery> deliveries = new ArrayList<>();
        Map<UUID, List<UUID>> membersByFamily = new java.util.HashMap<>();
        for (Object[] row : rows) {
            DoseOccurrence o = (DoseOccurrence) row[0];
            TreatmentSchedule s = (TreatmentSchedule) row[1];
            List<UUID> members = membersByFamily.computeIfAbsent(o.familyId, notifier::members);
            Map<UUID, List<PushSubscription>> subscriptions = notifier.subscriptions(members);
            if (subscriptions.isEmpty()) {
                continue;
            }
            Map<UUID, UserNotificationSettings> prefs = notifier.preferences(subscriptions.keySet());
            Treatment t = treatments.get(o.treatmentId);
            Person p = persons.get(t.personId);
            boolean claimed = o.claimedBy != null && o.claimedUntil.isAfter(now);

            for (Map.Entry<UUID, List<PushSubscription>> entry : subscriptions.entrySet()) {
                UUID user = entry.getKey();
                UserNotificationSettings pref = prefs.get(user);
                Slot slot = due(slots(o.scheduledAt, s, pref), snoozes.get(o.id + ":" + user), now, maxDelay);
                if (slot == null) {
                    continue;
                }
                if (claimed && !o.claimedBy.equals(user)) {
                    log(o.id, user, slot.number(), "SKIPPED", "Outro responsável está cuidando da dose");
                    continue;
                }
                List<PushSubscription> targets = entry.getValue().stream()
                        .filter(sub -> !Notifier.quiet(pref, sub, now)).toList();
                if (targets.isEmpty()) {
                    log(o.id, user, slot.number(), "SKIPPED", "Horário de silêncio");
                    continue;
                }
                if (!log(o.id, user, slot.number(), "SENT", null)) {
                    continue; // já enviado (por esta ou outra instância)
                }
                boolean late = now.isAfter(o.scheduledAt.plus(Duration.ofMinutes(s.lateToleranceMinutes)));
                for (PushSubscription sub : targets) {
                    deliveries.add(new Notifier.Delivery(sub, message(o, slot, late, t, p, pref, sub, s),
                            PushService.Urgency.HIGH, Duration.ofMinutes(30)));
                }
            }
        }
        return deliveries;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Snooze> snoozes(List<UUID> occurrences) {
        List<Object[]> rows = em.createNativeQuery("""
                SELECT dose_occurrence_id, user_id, remind_at, times FROM reminder_snooze
                 WHERE remind_at IS NOT NULL AND dose_occurrence_id IN (:ids)
                """, Object[].class)
                .setParameter("ids", occurrences).getResultList();
        Map<String, Snooze> result = new java.util.HashMap<>();
        for (Object[] r : rows) {
            Instant at = r[2] instanceof java.time.OffsetDateTime t ? t.toInstant() : (Instant) r[2];
            result.put(r[0] + ":" + r[1], new Snooze(at, ((Number) r[3]).intValue()));
        }
        return result;
    }

    private static PushMessage message(DoseOccurrence o, Slot slot, boolean late, Treatment t, Person p,
            UserNotificationSettings pref, PushSubscription sub, TreatmentSchedule s) {
        String at = Notifier.time(o.scheduledAt, sub);
        boolean snoozed = slot.number() > SLOT_SNOOZE && slot.number() < SLOT_DONE;
        String title = switch (slot.number()) {
            case SLOT_EARLY -> "Dose em " + s.reminderBeforeMinutes + " min";
            case 0 -> "Hora da dose";
            default -> late ? "Dose atrasada" : snoozed ? "Lembrete da dose" : "Dose pendente";
        };
        // Tela bloqueada: sem nome do medicamento por padrão (seção 12).
        String body = pref.lockScreenDetails
                ? p.displayName + " · " + t.name + " · " + t.prescribedDose + " (" + at + ")"
                : "Dose prevista para as " + at + ". Toque para ver.";
        return new PushMessage(title, body, "dose-" + o.id, "/doses/" + o.id, !pref.soundEnabled, true,
                Notifier.vibrate(pref));
    }

    /** Reserva o lembrete; false se já existia. */
    boolean log(UUID occurrence, UUID user, int slot, String status, String reason) {
        return em.createNativeQuery("""
                INSERT INTO reminder_log (dose_occurrence_id, user_id, slot, status, reason)
                VALUES (:o, :u, :slot, :status, :reason) ON CONFLICT DO NOTHING
                """)
                .setParameter("o", occurrence).setParameter("u", user).setParameter("slot", slot)
                .setParameter("status", status).setParameter("reason", reason)
                .executeUpdate() == 1;
    }

    /** Quem recebeu algum lembrete desta dose (para substituí-lo quando ela for decidida). */
    @SuppressWarnings("unchecked")
    public List<UUID> reminded(UUID occurrence) {
        return em.createNativeQuery("""
                SELECT DISTINCT user_id FROM reminder_log
                 WHERE dose_occurrence_id = :o AND slot < :done AND status = 'SENT'
                """, UUID.class)
                .setParameter("o", occurrence).setParameter("done", SLOT_DONE)
                .getResultList();
    }
}
