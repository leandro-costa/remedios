-- Uso "se necessário" (ex.: paracetamol se febre). O tratamento não tem agenda:
-- cada dose é registrada quando é dada e vira uma ocorrência já administrada,
-- sem versão de agenda. O app mostra a última dose e quantas foram dadas nas
-- últimas 24 horas; nunca diz quando a próxima pode ser dada (seção 1).
ALTER TABLE treatment
    DROP CONSTRAINT treatment_kind_check,
    ADD CONSTRAINT treatment_kind_check CHECK (kind IN ('CONTINUOUS', 'OCCASIONAL', 'AS_NEEDED')),
    -- Sem agenda e sem total de doses.
    ADD CONSTRAINT ck_treatment_as_needed
        CHECK (kind <> 'AS_NEEDED' OR (schedule_rule IS NULL AND dose_count IS NULL));

-- Doses "se necessário" não pertencem a uma versão de agenda; a chave lógica
-- é 'prn:' seguida do id da dose (gerado no aparelho).
ALTER TABLE dose_occurrence
    ALTER COLUMN schedule_id DROP NOT NULL,
    ALTER COLUMN schedule_version DROP NOT NULL,
    ADD CONSTRAINT ck_dose_occurrence_schedule
        CHECK ((schedule_id IS NULL) = (slot_key LIKE 'prn:%') AND (schedule_id IS NULL) = (schedule_version IS NULL));
