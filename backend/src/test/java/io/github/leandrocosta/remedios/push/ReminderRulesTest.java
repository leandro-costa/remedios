package io.github.leandrocosta.remedios.push;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.leandrocosta.remedios.schedule.TreatmentSchedule;
import io.github.leandrocosta.remedios.user.UserNotificationSettings;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import org.junit.jupiter.api.Test;

class ReminderRulesTest {

    private static final Instant AT = Instant.parse("2026-10-23T11:00:00Z");

    @Test
    void slotsFollowTheScheduleAndPersonalPreferences() {
        TreatmentSchedule s = schedule(10, 15, 4);
        UserNotificationSettings prefs = new UserNotificationSettings();
        List<ReminderService.Slot> slots = ReminderService.slots(AT, s, prefs);
        assertEquals(List.of(-1, 0, 1, 2, 3, 4), slots.stream().map(ReminderService.Slot::number).toList());
        assertEquals(AT.minusSeconds(600), slots.getFirst().at());
        assertEquals(AT.plusSeconds(60 * 60), slots.getLast().at());

        prefs.earlyReminderEnabled = false;
        prefs.repeatIntervalMinutes = 30;
        List<ReminderService.Slot> mine = ReminderService.slots(AT, s, prefs);
        assertEquals(0, mine.getFirst().number());
        assertEquals(AT.plusSeconds(4 * 30 * 60), mine.getLast().at());
    }

    @Test
    void onlyTheLatestDueReminderAndNeverAStaleOne() {
        List<ReminderService.Slot> slots = ReminderService.slots(AT, schedule(10, 15, 4), new UserNotificationSettings());
        Duration max = Duration.ofMinutes(15);
        assertNull(ReminderService.due(slots, AT.minusSeconds(11 * 60), max));
        assertEquals(-1, ReminderService.due(slots, AT.minusSeconds(5 * 60), max).number());
        assertEquals(2, ReminderService.due(slots, AT.plusSeconds(31 * 60), max).number());
        assertNull(ReminderService.due(slots, AT.plusSeconds(3 * 3600), max), "servidor parado: não avisa fora de hora");
    }

    @Test
    void quietHoursCrossingMidnightInTheDeviceTimezone() {
        UserNotificationSettings prefs = new UserNotificationSettings();
        prefs.quietHoursEnabled = true;
        prefs.quietHoursStart = LocalTime.of(22, 0);
        prefs.quietHoursEnd = LocalTime.of(7, 0);
        PushSubscription sub = new PushSubscription();
        sub.timezone = "America/Sao_Paulo"; // UTC-3
        assertTrue(Notifier.quiet(prefs, sub, Instant.parse("2026-10-23T02:00:00Z")));  // 23:00
        assertTrue(Notifier.quiet(prefs, sub, Instant.parse("2026-10-23T09:30:00Z")));  // 06:30
        assertFalse(Notifier.quiet(prefs, sub, Instant.parse("2026-10-23T10:30:00Z"))); // 07:30
        prefs.quietHoursEnabled = false;
        assertFalse(Notifier.quiet(prefs, sub, Instant.parse("2026-10-23T02:00:00Z")));
    }

    private static TreatmentSchedule schedule(int before, int interval, int limit) {
        TreatmentSchedule s = new TreatmentSchedule();
        s.reminderBeforeMinutes = before;
        s.repeatIntervalMinutes = interval;
        s.repeatLimit = limit;
        s.lateToleranceMinutes = 30;
        return s;
    }
}
