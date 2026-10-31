package io.github.leandrocosta.remedios.push;

import io.github.leandrocosta.remedios.family.FamilyMember;
import io.github.leandrocosta.remedios.user.UserNotificationSettings;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Destinatários, preferências pessoais (seção 6.4) e entrega das mensagens. */
@ApplicationScoped
public class Notifier {

    public record Delivery(PushSubscription subscription, PushMessage message, PushService.Urgency urgency,
            Duration ttl) {
    }

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private final PushService push;

    public Notifier(PushService push) {
        this.push = push;
    }

    public List<UUID> members(UUID familyId) {
        return FamilyMember.listActive(familyId).stream().map(m -> m.userId).toList();
    }

    /** Responsáveis que recebem os avisos e lembretes desta pessoa (filtro por pessoa). */
    @SuppressWarnings("unchecked")
    public List<UUID> members(UUID familyId, UUID personId) {
        java.util.Set<UUID> muted = new java.util.HashSet<>(io.quarkus.hibernate.orm.panache.Panache.getEntityManager()
                .createNativeQuery("SELECT user_id FROM notification_mute WHERE family_id = :f AND person_id = :p",
                        UUID.class)
                .setParameter("f", familyId).setParameter("p", personId).getResultList());
        return members(familyId).stream().filter(u -> !muted.contains(u)).toList();
    }

    public Map<UUID, List<PushSubscription>> subscriptions(Collection<UUID> userIds) {
        return PushSubscription.activeFor(userIds).stream().collect(Collectors.groupingBy(s -> s.userId));
    }

    public Map<UUID, UserNotificationSettings> preferences(Collection<UUID> userIds) {
        Map<UUID, UserNotificationSettings> stored = userIds.isEmpty() ? Map.of()
                : UserNotificationSettings.<UserNotificationSettings>list("userId in ?1", userIds).stream()
                        .collect(Collectors.toMap(s -> s.userId, Function.identity()));
        return userIds.stream().distinct().collect(Collectors.toMap(Function.identity(),
                id -> stored.getOrDefault(id, UserNotificationSettings.forUser(id))));
    }

    /** Horário de silêncio no fuso do aparelho; a janela pode atravessar a meia-noite. */
    public static boolean quiet(UserNotificationSettings prefs, PushSubscription subscription, Instant now) {
        if (!prefs.quietHoursEnabled || prefs.quietHoursStart == null || prefs.quietHoursEnd == null) {
            return false;
        }
        LocalTime local = now.atZone(zone(subscription)).toLocalTime();
        LocalTime start = prefs.quietHoursStart;
        LocalTime end = prefs.quietHoursEnd;
        return start.isBefore(end) ? !local.isBefore(start) && local.isBefore(end)
                : !local.isBefore(start) || local.isBefore(end);
    }

    public static String time(Instant at, PushSubscription subscription) {
        return HH_MM.format(at.atZone(zone(subscription)));
    }

    public static List<Integer> vibrate(UserNotificationSettings prefs) {
        return prefs.vibrationEnabled ? List.of(200, 100, 200) : List.of();
    }

    private static ZoneId zone(PushSubscription subscription) {
        try {
            return ZoneId.of(subscription.timezone);
        } catch (DateTimeException e) {
            return ZoneId.of("UTC");
        }
    }

    public void deliver(List<Delivery> deliveries) {
        for (Delivery d : deliveries) {
            push.send(d.subscription(), d.message(), d.urgency(), d.ttl());
        }
    }
}
