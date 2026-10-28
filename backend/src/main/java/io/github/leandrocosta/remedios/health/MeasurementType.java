package io.github.leandrocosta.remedios.health;

import java.math.BigDecimal;
import java.util.List;

/**
 * Tipos de aferição. As faixas servem só para pegar erros de digitação
 * (ex.: 380 em vez de 38,0); não têm significado clínico e o sistema não
 * classifica os valores.
 */
public enum MeasurementType {
    TEMPERATURE("°C", "30", "45", null, null, List.of("AXILLARY", "ORAL", "RECTAL", "EAR", "FOREHEAD")),
    HEART_RATE("bpm", "20", "250", null, null, List.of()),
    BLOOD_PRESSURE("mmHg", "50", "260", "30", "160", List.of()),
    OXYGEN_SATURATION("%", "50", "100", null, null, List.of()),
    BLOOD_GLUCOSE("mg/dL", "10", "800", null, null, List.of("FASTING", "BEFORE_MEAL", "AFTER_MEAL", "RANDOM")),
    WEIGHT("kg", "0.3", "400", null, null, List.of()),
    /** Outro tipo, com nome e unidade informados pelo responsável. */
    OTHER(null, null, null, null, null, List.of());

    /** Unidade fixa; null em OTHER. */
    public final String unit;
    final BigDecimal min;
    final BigDecimal max;
    final BigDecimal min2;
    final BigDecimal max2;
    /** Locais/condições aceitos; vazio = campo não se aplica. */
    public final List<String> methods;

    MeasurementType(String unit, String min, String max, String min2, String max2, List<String> methods) {
        this.unit = unit;
        this.min = min == null ? null : new BigDecimal(min);
        this.max = max == null ? null : new BigDecimal(max);
        this.min2 = min2 == null ? null : new BigDecimal(min2);
        this.max2 = max2 == null ? null : new BigDecimal(max2);
        this.methods = methods;
    }

    public boolean hasSecondValue() {
        return this == BLOOD_PRESSURE;
    }
}
