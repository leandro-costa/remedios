-- Fase 2: agenda, ocorrências e registro de administrações.

-- ---------------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------------

-- Regra de agenda desejada: faz parte do conteúdo versionado do tratamento
-- (entra nas revisões). NULL só é aceito enquanto o tratamento é rascunho.
ALTER TABLE treatment ADD COLUMN schedule_rule jsonb;

-- treatment_schedule passa a guardar versões materializadas da regra, cada uma
-- com sua vigência. Toda vez que a geração de ocorrências precisa recomeçar
-- (regra ou período alterados, suspensão e reativação), a versão atual é
-- encerrada e outra é criada; as ocorrências passadas continuam ligadas à
-- versão que as gerou. A regra estruturada (JSON) substitui o texto RRULE.
ALTER TABLE treatment_schedule
    DROP COLUMN recurrence_rule,
    DROP COLUMN active,
    ADD COLUMN rule            jsonb       NOT NULL,
    ADD COLUMN valid_from      timestamptz NOT NULL,
    ADD COLUMN valid_until     timestamptz,
    -- Até onde as ocorrências já foram geradas (horizonte).
    ADD COLUMN generated_until timestamptz,
    ADD CONSTRAINT ck_treatment_schedule_validity CHECK (valid_until IS NULL OR valid_until >= valid_from),
    ADD CONSTRAINT uq_treatment_schedule_version UNIQUE (treatment_id, version);

ALTER TABLE treatment_schedule ALTER COLUMN version DROP DEFAULT;

-- No máximo uma versão vigente por tratamento.
CREATE UNIQUE INDEX ux_treatment_schedule_current ON treatment_schedule (treatment_id)
    WHERE valid_until IS NULL;

-- ---------------------------------------------------------------------------
-- Ocorrências
-- ---------------------------------------------------------------------------

ALTER TABLE dose_occurrence
    -- Controle otimista para correções (e, na Fase 3, para a sincronização).
    ADD COLUMN version           bigint      NOT NULL DEFAULT 1,
    -- Motivo do último estado (dose não administrada, cancelamento, correção).
    ADD COLUMN status_reason     text,
    ADD COLUMN status_changed_by uuid        REFERENCES app_user (id),
    ADD COLUMN status_changed_at timestamptz;

CREATE INDEX ix_dose_occurrence_family_time ON dose_occurrence (family_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- Administrações
-- ---------------------------------------------------------------------------

-- Correções não apagam registros: o registro anterior é invalidado (voided) e
-- um novo é criado. A unicidade passa a valer só para o registro válido,
-- mantendo "no máximo uma administração válida por ocorrência" (seção 5.3).
ALTER TABLE administration_record
    DROP CONSTRAINT administration_record_dose_occurrence_id_key,
    ADD COLUMN voided_at   timestamptz,
    ADD COLUMN voided_by   uuid REFERENCES app_user (id),
    ADD COLUMN void_reason text,
    ADD CONSTRAINT ck_administration_record_void
        CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL));

CREATE UNIQUE INDEX ux_administration_record_valid ON administration_record (dose_occurrence_id)
    WHERE voided_at IS NULL;
CREATE INDEX ix_administration_record_occurrence ON administration_record (dose_occurrence_id, recorded_at);
