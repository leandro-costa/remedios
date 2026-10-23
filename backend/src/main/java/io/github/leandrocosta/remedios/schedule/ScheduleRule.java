package io.github.leandrocosta.remedios.schedule;

import io.github.leandrocosta.remedios.common.ApiException;
import java.time.DateTimeException;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * Regra de agenda de um tratamento, transcrita da prescrição. O sistema apenas
 * distribui os horários informados; não sugere nem ajusta intervalos.
 *
 * <ul>
 * <li>{@code DAILY}: horários fixos ({@code times}) a cada {@code everyDays}
 * dias, contados a partir do dia de início do tratamento;</li>
 * <li>{@code WEEKLY}: horários fixos nos dias da semana {@code daysOfWeek};</li>
 * <li>{@code INTERVAL}: a cada {@code everyHours} horas corridas, a partir de
 * {@code firstDoseAt} no dia de início.</li>
 * </ul>
 *
 * Horários são do relógio local de {@code timezone}. Horários repetidos na
 * lista representam doses distintas no mesmo horário.
 */
public record ScheduleRule(
        Type type,
        String timezone,
        List<LocalTime> times,
        Integer everyDays,
        Set<DayOfWeek> daysOfWeek,
        Integer everyHours,
        LocalTime firstDoseAt,
        Reminders reminders) {

    public enum Type { DAILY, WEEKLY, INTERVAL }

    /** Parâmetros de lembrete próprios do tratamento; ausentes = padrões da família. */
    public record Reminders(
            Integer reminderBeforeMinutes,
            Integer repeatIntervalMinutes,
            Integer repeatLimit,
            Integer lateToleranceMinutes) {
    }

    static final int MAX_TIMES_PER_DAY = 24;

    public ZoneId zone() {
        return ZoneId.of(timezone);
    }

    /** Valida e devolve a forma canônica (horários ordenados, sem segundos, campos irrelevantes nulos). */
    public ScheduleRule normalized() {
        if (type == null) {
            throw invalid("Informe o tipo de agenda (DAILY, WEEKLY ou INTERVAL).");
        }
        if (timezone == null || timezone.isBlank()) {
            throw invalid("Informe o fuso horário da agenda (ex.: America/Sao_Paulo).");
        }
        try {
            ZoneId.of(timezone);
        } catch (DateTimeException e) {
            throw invalid("Fuso horário desconhecido: " + timezone + ".");
        }
        Reminders r = normalizedReminders();
        return switch (type) {
            case DAILY -> {
                int days = everyDays == null ? 1 : everyDays;
                if (days < 1 || days > 365) {
                    throw invalid("O intervalo em dias deve estar entre 1 e 365.");
                }
                yield new ScheduleRule(type, timezone, normalizedTimes(), days, null, null, null, r);
            }
            case WEEKLY -> {
                if (daysOfWeek == null || daysOfWeek.isEmpty()) {
                    throw invalid("Informe ao menos um dia da semana.");
                }
                yield new ScheduleRule(type, timezone, normalizedTimes(), null, EnumSet.copyOf(daysOfWeek), null,
                        null, r);
            }
            case INTERVAL -> {
                if (everyHours == null || everyHours < 1 || everyHours > 168) {
                    throw invalid("O intervalo em horas deve estar entre 1 e 168.");
                }
                if (firstDoseAt == null) {
                    throw invalid("Informe o horário da primeira dose.");
                }
                yield new ScheduleRule(type, timezone, null, null, null, everyHours,
                        firstDoseAt.truncatedTo(ChronoUnit.MINUTES), r);
            }
        };
    }

    private List<LocalTime> normalizedTimes() {
        if (times == null || times.isEmpty()) {
            throw invalid("Informe ao menos um horário.");
        }
        if (times.size() > MAX_TIMES_PER_DAY) {
            throw invalid("Informe no máximo " + MAX_TIMES_PER_DAY + " horários por dia.");
        }
        if (times.stream().anyMatch(t -> t == null)) {
            throw invalid("Horário inválido.");
        }
        return times.stream().map(t -> t.truncatedTo(ChronoUnit.MINUTES)).sorted().toList();
    }

    private Reminders normalizedReminders() {
        if (reminders == null) {
            return null;
        }
        check(reminders.reminderBeforeMinutes(), 0, 1440, "A antecedência do lembrete");
        check(reminders.repeatIntervalMinutes(), 1, 1440, "O intervalo de repetição");
        check(reminders.repeatLimit(), 0, 100, "O limite de repetições");
        check(reminders.lateToleranceMinutes(), 0, 1440, "A tolerância de atraso");
        return reminders;
    }

    private static void check(Integer value, int min, int max, String what) {
        if (value != null && (value < min || value > max)) {
            throw invalid(what + " deve estar entre " + min + " e " + max + ".");
        }
    }

    private static ApiException invalid(String message) {
        return ApiException.unprocessable("INVALID_SCHEDULE", message);
    }
}
