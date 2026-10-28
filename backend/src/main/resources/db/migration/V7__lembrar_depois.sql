-- "Lembrar daqui a pouco": adia só o lembrete de uma dose, para um
-- responsável. A dose continua no horário previsto (e fica atrasada depois da
-- tolerância), e as próximas doses não mudam. Não é registro de dose.
CREATE TABLE reminder_snooze (
    dose_occurrence_id  uuid        NOT NULL REFERENCES dose_occurrence (id),
    user_id             uuid        NOT NULL REFERENCES app_user (id),
    -- NULL: adiamento cancelado (os lembretes da agenda seguem normalmente).
    remind_at           timestamptz,
    -- Quantas vezes este responsável adiou o lembrete desta dose: cada adiamento
    -- vira um lembrete próprio no reminder_log (slot 200 + times).
    times               integer     NOT NULL DEFAULT 1 CHECK (times BETWEEN 1 AND 100),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dose_occurrence_id, user_id)
);
