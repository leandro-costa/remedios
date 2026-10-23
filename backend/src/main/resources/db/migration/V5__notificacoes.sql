-- Fase 4: lembretes e avisos por Web Push (seção 6).

-- Inscrição de push de um aparelho (navegador). Uma por aparelho; o endpoint
-- é a URL do serviço de push do navegador.
CREATE TABLE push_subscription (
    id               uuid        PRIMARY KEY,
    user_id          uuid        NOT NULL REFERENCES app_user (id),
    device_id        uuid        NOT NULL UNIQUE REFERENCES device (id),
    endpoint         text        NOT NULL UNIQUE,
    p256dh           text        NOT NULL,
    auth             text        NOT NULL,
    -- Fuso do aparelho, para o horário de silêncio.
    timezone         text        NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_success_at  timestamptz,
    failures         integer     NOT NULL DEFAULT 0,
    -- Desativada quando o serviço de push informa que a inscrição expirou.
    disabled_at      timestamptz
);

CREATE INDEX ix_push_subscription_user ON push_subscription (user_id) WHERE disabled_at IS NULL;

-- Cada lembrete enviado (ou descartado) por dose, pessoa e momento. A linha é
-- inserida antes do envio (ON CONFLICT DO NOTHING): instâncias concorrentes da
-- API não mandam o mesmo lembrete duas vezes.
--   slot = -1: antecipado; 0: no horário; k > 0: k-ésima repetição;
--   slot = 1000: aviso de que a dose foi registrada (substitui o lembrete).
CREATE TABLE reminder_log (
    dose_occurrence_id  uuid        NOT NULL REFERENCES dose_occurrence (id),
    user_id             uuid        NOT NULL REFERENCES app_user (id),
    slot                integer     NOT NULL,
    status              text        NOT NULL CHECK (status IN ('SENT', 'SKIPPED', 'FAILED')),
    reason              text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dose_occurrence_id, user_id, slot)
);

-- "Estou cuidando desta dose" (seção 6.3): reduz os lembretes dos demais por
-- um tempo. Não é administração.
ALTER TABLE dose_occurrence
    ADD COLUMN claimed_by    uuid REFERENCES app_user (id),
    ADD COLUMN claimed_until timestamptz,
    ADD CONSTRAINT ck_dose_occurrence_claim CHECK ((claimed_by IS NULL) = (claimed_until IS NULL));

-- Lembrete avulso criado por um responsável (ex.: "medir a temperatura de novo
-- às 15:00"). Avisa quem criou ou toda a família.
CREATE TABLE custom_reminder (
    id          uuid        PRIMARY KEY,
    family_id   uuid        NOT NULL REFERENCES family (id),
    person_id   uuid        NOT NULL,
    created_by  uuid        NOT NULL REFERENCES app_user (id),
    message     text        NOT NULL CHECK (length(btrim(message)) > 0),
    remind_at   timestamptz NOT NULL,
    notify_all  boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    sent_at     timestamptz,
    cancelled_at timestamptz,
    FOREIGN KEY (family_id, person_id) REFERENCES person (family_id, id)
);

CREATE INDEX ix_custom_reminder_due ON custom_reminder (remind_at)
    WHERE sent_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX ix_custom_reminder_person ON custom_reminder (family_id, person_id, remind_at);
