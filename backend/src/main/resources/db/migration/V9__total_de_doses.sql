-- Término por número de doses (prescrição "por 5 dias, 2 vezes ao dia" = 10
-- doses). O início do tratamento é a primeira dose; a agenda gera doses até
-- completar o total. Doses canceladas (alteração, suspensão) não contam; dose
-- não dada conta e não é reposta (o app não sugere compensação, seção 6.2).
-- Término por data e por número de doses são excludentes.
ALTER TABLE treatment
    ADD COLUMN dose_count integer CHECK (dose_count BETWEEN 1 AND 2000),
    ADD CONSTRAINT ck_treatment_end_or_count CHECK (dose_count IS NULL OR end_at IS NULL);
