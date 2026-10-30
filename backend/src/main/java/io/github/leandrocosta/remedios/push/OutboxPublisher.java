package io.github.leandrocosta.remedios.push;

import io.github.leandrocosta.remedios.audit.OutboxEvent;
import io.github.leandrocosta.remedios.family.FamilySettings;
import io.github.leandrocosta.remedios.occurrence.DoseOccurrence;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.treatment.Treatment;
import io.github.leandrocosta.remedios.user.AppUser;
import io.github.leandrocosta.remedios.user.UserNotificationSettings;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jboss.logging.Logger;

/**
 * Publica os eventos da outbox (seção 11.3) como avisos aos responsáveis,
 * conforme a política da família e as preferências de cada um (seção 6.1):
 * por padrão, só eventos importantes e conflitos.
 */
@ApplicationScoped
public class OutboxPublisher {

    private static final Logger LOG = Logger.getLogger(OutboxPublisher.class);
    private static final int MAX_ATTEMPTS = 8;

    private final EntityManager em;
    private final Notifier notifier;
    private final ReminderService reminders;
    private final PushService push;

    public OutboxPublisher(EntityManager em, Notifier notifier, ReminderService reminders, PushService push) {
        this.em = em;
        this.notifier = notifier;
        this.reminders = reminders;
        this.push = push;
    }

    /**
     * Uma notificação planejada para um responsável. {@code detailed} vai para
     * quem permite detalhes na tela bloqueada; {@code generic}, para os demais.
     * "{at}" é trocado pelo horário da dose no fuso de cada aparelho.
     */
    record Notice(UUID user, String title, String detailed, String generic, String tag, String url, boolean silent,
            PushService.Urgency urgency, Instant at) {

        Notice(UUID user, String title, String detailed, String generic, String tag, String url, boolean silent,
                PushService.Urgency urgency) {
            this(user, title, detailed, generic, tag, url, silent, urgency, null);
        }

        Notice at(Instant time) {
            return new Notice(user, title, detailed, generic, tag, url, silent, urgency, time);
        }
    }

    public int publish(Instant now) {
        List<Notifier.Delivery> deliveries = QuarkusTransaction.requiringNew().call(() -> {
            List<OutboxEvent> events = em.createQuery("""
                    from OutboxEvent e where e.status = :pending and e.nextAttemptAt <= :now order by e.createdAt
                    """, OutboxEvent.class)
                    .setParameter("pending", OutboxEvent.Status.PENDING)
                    .setParameter("now", now)
                    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                    .setHint("jakarta.persistence.lock.timeout", -2) // SKIP LOCKED
                    .setMaxResults(100)
                    .getResultList();
            List<Notifier.Delivery> planned = new ArrayList<>();
            for (OutboxEvent e : events) {
                try {
                    if (push.enabled()) {
                        planned.addAll(render(notices(e)));
                    }
                    e.status = OutboxEvent.Status.PUBLISHED;
                    e.publishedAt = now;
                } catch (RuntimeException ex) {
                    LOG.warnf(ex, "Falha ao publicar o evento %s", e.id);
                    e.attempts++;
                    e.lastError = String.valueOf(ex.getMessage());
                    e.nextAttemptAt = now.plus(Duration.ofMinutes(1L << Math.min(e.attempts, 10)));
                    if (e.attempts >= MAX_ATTEMPTS) {
                        e.status = OutboxEvent.Status.FAILED;
                    }
                }
            }
            return planned;
        });
        notifier.deliver(deliveries);
        return deliveries.size();
    }

    // --- Quem recebe o quê ------------------------------------------------------

    List<Notice> notices(OutboxEvent e) {
        Map<String, Object> p = e.payload;
        return switch (e.eventType) {
            case "DOSE_ADMINISTERED", "DOSE_NOT_ADMINISTERED", "DOSE_CORRECTED", "DOSE_CONFLICT_OPENED",
                    "DOSE_CONFLICT_RESOLVED" -> dose(e, uuid(p.get("occurrenceId")));
            case "TREATMENT_CREATED", "TREATMENT_UPDATED", "TREATMENT_STATUS_CHANGED" ->
                treatment(e, uuid(p.get("treatmentId")));
            case "TREATMENT_CONFLICT_OPENED" -> treatmentConflict(e, uuid(p.get("treatmentId")));
            case "MEMBER_JOINED", "MEMBER_REMOVED" -> member(e, uuid(p.get("userId")));
            default -> List.of();
        };
    }

    private List<Notice> dose(OutboxEvent e, UUID occurrenceId) {
        DoseOccurrence o = DoseOccurrence.findById(occurrenceId);
        if (o == null) {
            return List.of();
        }
        Treatment t = Treatment.findById(o.treatmentId);
        Person person = Person.findById(t.personId);
        UUID actor = o.statusChangedBy;
        String who = name(actor);
        FamilySettings.ConfirmationPolicy policy = policy(e.familyId);
        Set<UUID> reminded = new HashSet<>(reminders.reminded(o.id));
        List<UUID> members = notifier.members(e.familyId);
        Map<UUID, UserNotificationSettings> prefs = notifier.preferences(members);
        String detail = person.displayName + " · " + t.name;
        String tag = "dose-" + o.id;
        String url = "/doses/" + o.id;

        boolean asNeeded = t.kind == Treatment.Kind.AS_NEEDED;
        // Doses "se necessário" dadas nas 24 h até esta (inclusive): ajuda quem não deu a saber.
        long last24h = asNeeded && "DOSE_ADMINISTERED".equals(e.eventType) ? DoseOccurrence.count(
                "treatmentId = ?1 and status = ?2 and scheduledAt > ?3 and scheduledAt <= ?4", t.id,
                DoseOccurrence.Status.ADMINISTERED, o.scheduledAt.minus(java.time.Duration.ofHours(24)),
                o.scheduledAt) : 0;
        String count = last24h == 1 ? "1 dose nas últimas 24 h" : last24h + " doses nas últimas 24 h";

        List<Notice> notices = new ArrayList<>();
        for (UUID user : members) {
            boolean other = !user.equals(actor);
            boolean wasReminded = reminded.contains(user);
            UserNotificationSettings pref = prefs.get(user);
            switch (e.eventType) {
                case "DOSE_ADMINISTERED" -> {
                    if (asNeeded) {
                        // "Se necessário": avisa os outros responsáveis a cada dose, com a contagem de 24 h.
                        if (other && policy != FamilySettings.ConfirmationPolicy.NONE) {
                            notices.add(new Notice(user, "Dose registrada", who + " deu " + detail + " às {at} · "
                                    + count, who + " registrou uma dose às {at} · " + count, tag, url, false,
                                    PushService.Urgency.NORMAL));
                        }
                        continue;
                    }
                    // Confirmação de rotina só para quem pediu (padrão: não, seção 6.2.8).
                    boolean confirm = other && (policy == FamilySettings.ConfirmationPolicy.ALL
                            || pref.confirmationNotifications);
                    if (confirm || wasReminded) {
                        notices.add(new Notice(user, "Dose registrada", who + " registrou: " + detail + " ({at})",
                                who + " registrou a dose das {at}.", tag, url, !confirm, PushService.Urgency.NORMAL));
                    }
                }
                case "DOSE_NOT_ADMINISTERED" -> {
                    boolean important = other && policy != FamilySettings.ConfirmationPolicy.NONE;
                    if (important || wasReminded) {
                        notices.add(new Notice(user, "Dose não administrada", who + " registrou que não foi dada: "
                                + detail + " ({at})", who + " registrou que a dose das {at} não foi dada.", tag, url,
                                !important, PushService.Urgency.NORMAL));
                    }
                }
                case "DOSE_CORRECTED" -> {
                    if (other && policy != FamilySettings.ConfirmationPolicy.NONE) {
                        notices.add(new Notice(user, "Registro corrigido", who + " corrigiu: " + detail + " ({at})",
                                who + " corrigiu o registro da dose das {at}.", tag, url, false,
                                PushService.Urgency.NORMAL));
                    }
                }
                // Conflitos sempre avisam todos (seção 6.2.9).
                case "DOSE_CONFLICT_OPENED" -> notices.add(new Notice(user, "Registros divergentes",
                        "Confira a dose de " + detail + " ({at})", "Confira a dose das {at}: os registros não combinam.",
                        tag, url, false, PushService.Urgency.HIGH));
                case "DOSE_CONFLICT_RESOLVED" -> {
                    if (other && policy != FamilySettings.ConfirmationPolicy.NONE) {
                        notices.add(new Notice(user, "Conferência concluída", who + " concluiu a conferência: "
                                + detail + " ({at})", who + " concluiu a conferência da dose das {at}.", tag, url,
                                false, PushService.Urgency.NORMAL));
                    }
                }
                default -> {
                }
            }
        }
        return notices.stream().map(n -> n.at(o.scheduledAt)).toList();
    }

    private List<Notice> treatment(OutboxEvent e, UUID treatmentId) {
        Treatment t = Treatment.findById(treatmentId);
        if (t == null || policy(e.familyId) == FamilySettings.ConfirmationPolicy.NONE) {
            return List.of();
        }
        Person person = Person.findById(t.personId);
        String who = name(t.updatedBy);
        String verb = switch (e.eventType) {
            case "TREATMENT_CREATED" -> "cadastrou";
            case "TREATMENT_STATUS_CHANGED" -> switch (t.status) {
                case ACTIVE -> "ativou";
                case SUSPENDED -> "suspendeu";
                case ENDED -> "encerrou";
                default -> "alterou";
            };
            default -> "alterou";
        };
        return notifier.members(e.familyId).stream().filter(u -> !u.equals(t.updatedBy))
                .map(u -> new Notice(u, "Tratamento atualizado", who + " " + verb + ": " + t.name + " (" + person.displayName + ")",
                        who + " " + verb + " um tratamento.", "treatment-" + t.id, "/tratamentos/" + t.id, false,
                        PushService.Urgency.NORMAL))
                .toList();
    }

    /** Alteração de tratamento preservada para conferência: avisa todos (seção 6.2.9). */
    private List<Notice> treatmentConflict(OutboxEvent e, UUID treatmentId) {
        Treatment t = Treatment.findById(treatmentId);
        if (t == null) {
            return List.of();
        }
        Person person = Person.findById(t.personId);
        return notifier.members(e.familyId).stream()
                .map(u -> new Notice(u, "Alteração para conferir", "Confira o tratamento " + t.name + " ("
                        + person.displayName + "): há uma alteração feita sem conexão.",
                        "Um tratamento tem uma alteração feita sem conexão para conferir.", "treatment-" + t.id,
                        "/conflitos", false, PushService.Urgency.HIGH))
                .toList();
    }

    private List<Notice> member(OutboxEvent e, UUID memberId) {
        if (policy(e.familyId) == FamilySettings.ConfirmationPolicy.NONE) {
            return List.of();
        }
        String who = name(memberId);
        String text = "MEMBER_JOINED".equals(e.eventType) ? who + " entrou na família." : who + " saiu da família.";
        return notifier.members(e.familyId).stream().filter(u -> !u.equals(memberId))
                .map(u -> new Notice(u, "Família", text, text, "member-" + memberId, "/familia", false,
                        PushService.Urgency.NORMAL))
                .toList();
    }

    // --- Montagem ---------------------------------------------------------------

    private List<Notifier.Delivery> render(List<Notice> notices) {
        if (notices.isEmpty()) {
            return List.of();
        }
        Set<UUID> users = new HashSet<>(notices.stream().map(Notice::user).toList());
        Map<UUID, List<PushSubscription>> subs = notifier.subscriptions(users);
        Map<UUID, UserNotificationSettings> prefs = notifier.preferences(users);
        List<Notifier.Delivery> deliveries = new ArrayList<>();
        for (Notice n : notices) {
            UserNotificationSettings pref = prefs.get(n.user());
            for (PushSubscription sub : subs.getOrDefault(n.user(), List.of())) {
                // Horário de silêncio: só conflitos (urgentes) e substituições silenciosas passam.
                if (n.urgency() != PushService.Urgency.HIGH && !n.silent() && Notifier.quiet(pref, sub, Instant.now())) {
                    continue;
                }
                String body = pref.lockScreenDetails ? n.detailed() : n.generic();
                if (n.at() != null) {
                    body = body.replace("{at}", Notifier.time(n.at(), sub));
                }
                deliveries.add(new Notifier.Delivery(sub, new PushMessage(n.title(), body, n.tag(), n.url(),
                        n.silent() || !pref.soundEnabled, !n.silent(), n.silent() ? List.of() : Notifier.vibrate(pref)),
                        n.urgency(), Duration.ofHours(12)));
            }
        }
        return deliveries;
    }

    private static FamilySettings.ConfirmationPolicy policy(UUID familyId) {
        FamilySettings s = FamilySettings.findById(familyId);
        return s == null ? FamilySettings.ConfirmationPolicy.IMPORTANT_ONLY : s.confirmationPolicy;
    }

    private static String name(UUID userId) {
        AppUser u = userId == null ? null : AppUser.findById(userId);
        return u == null ? "Alguém" : u.displayName;
    }

    private static UUID uuid(Object value) {
        return value == null ? null : UUID.fromString(String.valueOf(value));
    }
}
