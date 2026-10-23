-- Aferições, sintomas e linhas de referência (seção 2.2: registro de sintomas
-- e possíveis reações). O sistema guarda e mostra; não interpreta valores,
-- não diagnostica e não sugere medicamentos.

-- Aferição: valor medido por um responsável, num horário. Imutável: uma
-- correção invalida o registro (voided_*) e cria outro que aponta para ele
-- (replaces_id). O id é gerado no aparelho, o que torna o envio offline
-- idempotente.
CREATE TABLE measurement (
    id                 uuid          PRIMARY KEY,
    family_id          uuid          NOT NULL,
    person_id          uuid          NOT NULL,
    type               text          NOT NULL CHECK (type IN (
                           'TEMPERATURE', 'HEART_RATE', 'BLOOD_PRESSURE', 'OXYGEN_SATURATION',
                           'BLOOD_GLUCOSE', 'WEIGHT', 'OTHER')),
    -- Valor principal (sistólica, na pressão arterial).
    value              numeric(8, 2) NOT NULL,
    -- Segundo valor: diastólica, só na pressão arterial.
    value2             numeric(8, 2),
    unit               text          NOT NULL,
    -- Nome do que foi medido, para OTHER.
    label              text,
    -- Local/condição da medida (ex.: AXILLARY para temperatura, FASTING para glicemia).
    method             text,
    measured_at        timestamptz   NOT NULL,
    notes              text,
    recorded_by        uuid          NOT NULL REFERENCES app_user (id),
    device_id          uuid          NOT NULL REFERENCES device (id),
    recorded_at        timestamptz   NOT NULL,
    received_at        timestamptz   NOT NULL DEFAULT now(),
    replaces_id        uuid          REFERENCES measurement (id),
    voided_at          timestamptz,
    voided_by          uuid          REFERENCES app_user (id),
    void_reason        text,
    FOREIGN KEY (family_id, person_id) REFERENCES person (family_id, id),
    CHECK ((type = 'BLOOD_PRESSURE') = (value2 IS NOT NULL)),
    CHECK ((type = 'OTHER') = (label IS NOT NULL)),
    CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL))
);

-- Gráficos: série de um tipo por pessoa, só registros válidos.
CREATE INDEX ix_measurement_series ON measurement (family_id, person_id, type, measured_at)
    WHERE voided_at IS NULL;
-- Um registro só pode ser substituído uma vez.
CREATE UNIQUE INDEX ux_measurement_replaces ON measurement (replaces_id) WHERE replaces_id IS NOT NULL;

-- Sintoma ou possível reação observada. Pode ficar "em andamento" (sem fim).
CREATE TABLE symptom_record (
    id            uuid        PRIMARY KEY,
    family_id     uuid        NOT NULL,
    person_id     uuid        NOT NULL,
    description   text        NOT NULL CHECK (length(btrim(description)) > 0),
    intensity     text        CHECK (intensity IN ('MILD', 'MODERATE', 'SEVERE')),
    started_at    timestamptz NOT NULL,
    ended_at      timestamptz,
    -- Tratamento suspeito, quando o responsável registra como possível reação.
    treatment_id  uuid,
    notes         text,
    version       bigint      NOT NULL DEFAULT 1,
    recorded_by   uuid        NOT NULL REFERENCES app_user (id),
    device_id     uuid        NOT NULL REFERENCES device (id),
    recorded_at   timestamptz NOT NULL,
    received_at   timestamptz NOT NULL DEFAULT now(),
    updated_by    uuid        REFERENCES app_user (id),
    updated_at    timestamptz,
    voided_at     timestamptz,
    voided_by     uuid        REFERENCES app_user (id),
    void_reason   text,
    FOREIGN KEY (family_id, person_id) REFERENCES person (family_id, id),
    FOREIGN KEY (family_id, treatment_id) REFERENCES treatment (family_id, id),
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL))
);

CREATE INDEX ix_symptom_record_person_time ON symptom_record (family_id, person_id, started_at)
    WHERE voided_at IS NULL;

-- Linha de referência no gráfico, definida pela família conforme orientação
-- de um profissional de saúde. É só uma marca visual: o sistema não classifica
-- valores nem emite alertas por ela. person_id NULL vale para toda a família;
-- a linha da pessoa prevalece.
CREATE TABLE reference_line (
    id          uuid          PRIMARY KEY,
    family_id   uuid          NOT NULL REFERENCES family (id),
    person_id   uuid,
    type        text          NOT NULL CHECK (type IN (
                    'TEMPERATURE', 'HEART_RATE', 'BLOOD_PRESSURE', 'OXYGEN_SATURATION',
                    'BLOOD_GLUCOSE', 'WEIGHT')),
    value       numeric(8, 2) NOT NULL,
    -- Segunda linha: diastólica, só na pressão arterial (opcional).
    value2      numeric(8, 2),
    label       text          NOT NULL CHECK (length(btrim(label)) > 0),
    created_by  uuid          NOT NULL REFERENCES app_user (id),
    updated_at  timestamptz   NOT NULL DEFAULT now(),
    FOREIGN KEY (family_id, person_id) REFERENCES person (family_id, id),
    CHECK (type = 'BLOOD_PRESSURE' OR value2 IS NULL),
    UNIQUE NULLS NOT DISTINCT (family_id, person_id, type)
);
