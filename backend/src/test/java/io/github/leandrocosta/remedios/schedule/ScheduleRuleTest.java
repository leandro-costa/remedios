package io.github.leandrocosta.remedios.schedule;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.github.leandrocosta.remedios.common.ApiException;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class ScheduleRuleTest {

    @Test
    void normalizesTimesAndDropsIrrelevantFields() {
        ScheduleRule rule = new ScheduleRule(ScheduleRule.Type.DAILY, "UTC",
                List.of(LocalTime.of(20, 0, 30), LocalTime.of(8, 0)), null, Set.of(java.time.DayOfWeek.MONDAY), 4,
                LocalTime.NOON, null).normalized();

        assertEquals(List.of(LocalTime.of(8, 0), LocalTime.of(20, 0)), rule.times());
        assertEquals(1, rule.everyDays());
        assertNull(rule.daysOfWeek());
        assertNull(rule.everyHours());
        assertNull(rule.firstDoseAt());
    }

    @Test
    void rejectsInvalidRules() {
        assertInvalid(new ScheduleRule(null, "UTC", List.of(LocalTime.NOON), null, null, null, null, null));
        assertInvalid(new ScheduleRule(ScheduleRule.Type.DAILY, "Lua/Base", List.of(LocalTime.NOON), null, null, null,
                null, null));
        assertInvalid(new ScheduleRule(ScheduleRule.Type.DAILY, "UTC", List.of(), null, null, null, null, null));
        assertInvalid(new ScheduleRule(ScheduleRule.Type.DAILY, "UTC", List.of(LocalTime.NOON), 0, null, null, null,
                null));
        assertInvalid(new ScheduleRule(ScheduleRule.Type.WEEKLY, "UTC", List.of(LocalTime.NOON), null, Set.of(), null,
                null, null));
        assertInvalid(new ScheduleRule(ScheduleRule.Type.INTERVAL, "UTC", null, null, null, 0, LocalTime.NOON, null));
        assertInvalid(new ScheduleRule(ScheduleRule.Type.INTERVAL, "UTC", null, null, null, 8, null, null));
        assertInvalid(new ScheduleRule(ScheduleRule.Type.DAILY, "UTC", List.of(LocalTime.NOON), null, null, null,
                null, new ScheduleRule.Reminders(null, 0, null, null)));
    }

    private static void assertInvalid(ScheduleRule rule) {
        ApiException e = assertThrows(ApiException.class, rule::normalized);
        assertEquals("INVALID_SCHEDULE", e.code);
    }
}
