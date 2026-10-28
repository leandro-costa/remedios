package io.github.leandrocosta.remedios.schedule;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Calcula os horários concretos de uma regra num intervalo. Função pura: não
 * acessa banco nem relógio.
 *
 * <p>Horário de verão (decisão em aberto 6): um horário local inexistente
 * (relógio adiantado) é deslocado para depois do salto; um horário ambíguo
 * (relógio atrasado) usa a primeira ocorrência. No tipo {@code INTERVAL} o
 * intervalo é de horas corridas, independente do relógio local.
 */
public final class OccurrenceSlots {

    /** Limite de segurança por chamada. */
    static final int MAX_SLOTS = 5000;

    /**
     * Horário calculado. {@code key} identifica logicamente a dose dentro da
     * versão da agenda e é estável entre gerações repetidas.
     */
    public record Slot(Instant at, String key) {
    }

    private OccurrenceSlots() {
    }

    /**
     * Doses com {@code from <= horário < to}.
     *
     * @param anchor início do tratamento: fixa o dia inicial de DAILY e INTERVAL
     */
    public static List<Slot> between(ScheduleRule rule, Instant anchor, Instant from, Instant to) {
        List<Slot> slots = new ArrayList<>();
        if (!from.isBefore(to)) {
            return slots;
        }
        ZoneId zone = rule.zone();
        LocalDate anchorDate = anchor.atZone(zone).toLocalDate();
        switch (rule.type()) {
            case DAILY, WEEKLY -> {
                LocalDate first = from.atZone(zone).toLocalDate().minusDays(1);
                LocalDate last = to.atZone(zone).toLocalDate().plusDays(1);
                for (LocalDate date = first; !date.isAfter(last) && slots.size() < MAX_SLOTS; date = date.plusDays(1)) {
                    if (!matches(rule, anchorDate, date)) {
                        continue;
                    }
                    LocalTime previous = null;
                    int ordinal = 0;
                    for (LocalTime time : rule.times()) {
                        ordinal = time.equals(previous) ? ordinal + 1 : 1;
                        previous = time;
                        Instant at = ZonedDateTime.ofLocal(LocalDateTime.of(date, time), zone, null).toInstant();
                        if (!at.isBefore(from) && at.isBefore(to)) {
                            slots.add(new Slot(at, date + "T" + time + "#" + ordinal));
                        }
                    }
                }
            }
            case INTERVAL -> {
                Instant first = ZonedDateTime.ofLocal(LocalDateTime.of(anchorDate, rule.firstDoseAt()), zone, null)
                        .toInstant();
                Duration period = Duration.ofHours(rule.everyHours());
                long k = 0;
                if (from.isAfter(first)) {
                    long elapsed = Duration.between(first, from).toSeconds();
                    k = Math.ceilDiv(elapsed, period.toSeconds());
                }
                for (Instant at = first.plus(period.multipliedBy(k)); at.isBefore(to) && slots.size() < MAX_SLOTS;
                        at = at.plus(period)) {
                    slots.add(new Slot(at, at.truncatedTo(ChronoUnit.SECONDS) + "#1"));
                }
            }
        }
        return slots;
    }

    private static boolean matches(ScheduleRule rule, LocalDate anchorDate, LocalDate date) {
        return switch (rule.type()) {
            case DAILY -> {
                long days = ChronoUnit.DAYS.between(anchorDate, date);
                yield days >= 0 && days % rule.everyDays() == 0;
            }
            case WEEKLY -> rule.daysOfWeek().contains(date.getDayOfWeek());
            case INTERVAL -> throw new IllegalStateException();
        };
    }
}
