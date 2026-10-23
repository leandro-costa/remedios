package io.github.leandrocosta.remedios.schedule;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.leandrocosta.remedios.schedule.OccurrenceSlots.Slot;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class OccurrenceSlotsTest {

    private static final Instant START = Instant.parse("2026-10-20T03:00:00Z"); // 00:00 em São Paulo

    @Test
    void dailyTimesInLocalTimezone() {
        ScheduleRule rule = daily("America/Sao_Paulo", 1, "20:00", "08:00").normalized();
        List<Slot> slots = OccurrenceSlots.between(rule, START, START, Instant.parse("2026-10-22T03:00:00Z"));

        assertEquals(List.of(
                Instant.parse("2026-10-20T11:00:00Z"), Instant.parse("2026-10-20T23:00:00Z"),
                Instant.parse("2026-10-21T11:00:00Z"), Instant.parse("2026-10-21T23:00:00Z")),
                slots.stream().map(Slot::at).toList());
        assertEquals("2026-10-20T08:00#1", slots.getFirst().key());
    }

    @Test
    void everyOtherDayCountsFromTreatmentStart() {
        ScheduleRule rule = daily("UTC", 2, "09:00").normalized();
        Instant start = Instant.parse("2026-10-20T00:00:00Z");
        List<Slot> slots = OccurrenceSlots.between(rule, start, Instant.parse("2026-10-21T00:00:00Z"),
                Instant.parse("2026-10-27T00:00:00Z"));

        assertEquals(List.of(Instant.parse("2026-10-22T09:00:00Z"), Instant.parse("2026-10-24T09:00:00Z"),
                Instant.parse("2026-10-26T09:00:00Z")), slots.stream().map(Slot::at).toList());
    }

    @Test
    void repeatedTimeMeansTwoDistinctDoses() {
        ScheduleRule rule = daily("UTC", 1, "08:00", "08:00").normalized();
        Instant day = Instant.parse("2026-10-20T00:00:00Z");
        List<Slot> slots = OccurrenceSlots.between(rule, day, day, day.plusSeconds(86_400));

        assertEquals(2, slots.size());
        assertEquals(slots.get(0).at(), slots.get(1).at());
        assertEquals(List.of("2026-10-20T08:00#1", "2026-10-20T08:00#2"), slots.stream().map(Slot::key).toList());
    }

    @Test
    void weeklyOnSelectedDays() {
        ScheduleRule rule = new ScheduleRule(ScheduleRule.Type.WEEKLY, "UTC", List.of(LocalTime.of(7, 0)), null,
                Set.of(DayOfWeek.MONDAY, DayOfWeek.THURSDAY), null, null, null).normalized();
        List<Slot> slots = OccurrenceSlots.between(rule, START, Instant.parse("2026-10-19T00:00:00Z"),
                Instant.parse("2026-10-26T00:00:00Z"));

        assertEquals(List.of(Instant.parse("2026-10-19T07:00:00Z"), Instant.parse("2026-10-22T07:00:00Z")),
                slots.stream().map(Slot::at).toList());
    }

    @Test
    void intervalUsesElapsedHoursAcrossDaylightSavingChange() {
        // Nova York adianta o relógio em 2026-03-08 às 02:00.
        ScheduleRule rule = new ScheduleRule(ScheduleRule.Type.INTERVAL, "America/New_York", null, null, null, 8,
                LocalTime.of(6, 0), null).normalized();
        Instant start = Instant.parse("2026-03-07T05:00:00Z"); // 00:00 local
        List<Slot> slots = OccurrenceSlots.between(rule, start, start, Instant.parse("2026-03-09T05:00:00Z"));

        Instant first = Instant.parse("2026-03-07T11:00:00Z"); // 06:00 EST
        for (int i = 0; i < slots.size(); i++) {
            assertEquals(first.plusSeconds(8L * 3600 * i), slots.get(i).at());
        }
        assertEquals(6, slots.size());
    }

    @Test
    void intervalResumesFromTheRightDoseWhenGeneratingLater() {
        ScheduleRule rule = new ScheduleRule(ScheduleRule.Type.INTERVAL, "UTC", null, null, null, 6,
                LocalTime.of(0, 0), null).normalized();
        Instant start = Instant.parse("2026-10-20T00:00:00Z");
        List<Slot> slots = OccurrenceSlots.between(rule, start, Instant.parse("2026-10-21T01:00:00Z"),
                Instant.parse("2026-10-21T13:00:00Z"));

        assertEquals(List.of(Instant.parse("2026-10-21T06:00:00Z"), Instant.parse("2026-10-21T12:00:00Z")),
                slots.stream().map(Slot::at).toList());
    }

    @Test
    void nonexistentLocalTimeMovesPastTheGap() {
        // 02:30 não existe em Nova York em 2026-03-08: vira 03:30 EDT (07:30Z).
        ScheduleRule rule = daily("America/New_York", 1, "02:30").normalized();
        Instant day = Instant.parse("2026-03-08T05:00:00Z");
        List<Slot> slots = OccurrenceSlots.between(rule, day, day, day.plusSeconds(86_400));

        assertEquals(Instant.parse("2026-03-08T07:30:00Z"), slots.getFirst().at());
    }

    @Test
    void generationWindowsDoNotOverlap() {
        ScheduleRule rule = daily("UTC", 1, "00:00", "12:00").normalized();
        Instant a = Instant.parse("2026-10-20T00:00:00Z");
        Instant b = Instant.parse("2026-10-20T12:00:00Z");
        Instant c = Instant.parse("2026-10-21T00:00:00Z");

        List<Slot> first = OccurrenceSlots.between(rule, a, a, b);
        List<Slot> second = OccurrenceSlots.between(rule, a, b, c);
        assertEquals(1, first.size());
        assertEquals(1, second.size());
        assertTrue(first.getFirst().at().isBefore(second.getFirst().at()));
    }

    static ScheduleRule daily(String zone, int everyDays, String... times) {
        return new ScheduleRule(ScheduleRule.Type.DAILY, zone, List.of(times).stream().map(LocalTime::parse).toList(),
                everyDays, null, null, null, null);
    }
}
