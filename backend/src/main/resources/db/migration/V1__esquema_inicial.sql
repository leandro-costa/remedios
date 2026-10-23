-- Esquema inicial (especificação, seção 9).
--
-- Convenções:
--   * identificadores UUID gerados pela aplicação (ou pelo dispositivo, para
--     operações offline), nunca pelo banco;
--   * instantes em timestamptz (UTC); o fuso de exibição pertence à agenda;
--   * enumerações como text + CHECK, para facilitar migrações futuras;
--   * consistência entre família, pessoa, conta e tratamento reforçada por
--     chaves estrangeiras compostas sempre que possível (seção 3.3).

-- ---------------------------------------------------------------------------
-- Família, contas e participação
-- ---------------------------------------------------------------------------

CREATE TABLE family (
    id          uuid        PRIMARY KEY,
    name        text        NOT NULL CHECK (length(btrim(name)) > 0),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
    id            uuid        PRIMARY KEY,
    auth_subject  text        NOT NULL UNIQUE,
    display_name  text        NOT NULL CHECK (length(btrim(display_name)) > 0),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE family_member (
    id          uuid        PRIMARY KEY,
    family_id   uuid        NOT NULL REFERENCES family (id),
    user_id     uuid        NOT NULL REFERENCES app_user (id),
    role        text        NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
    status      text        NOT NULL CHECK (status IN ('ACTIVE', 'REMOVED')),
    joined_at   timestamptz NOT NULL,
    removed_at  timestamptz,
    UNIQUE (family_id, user_id),
    CHECK ((status = 'REMOVED') = (removed_at IS NOT NULL))
);

CREATE INDEX ix_family_member_user_status ON family_member (user_id, status);

-- Convites de responsáveis (seção 4.1). Não constava da lista da seção 9.1;
-- o código é entregue uma única vez ao administrador e só o hash é guardado.
CREATE TABLE family_invitation (
    id           uuid        PRIMARY KEY,
    family_id    uuid        NOT NULL REFERENCES family (id),
    code_hash    text        NOT NULL UNIQUE,
    role         text        NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
    status       text        NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED')),
    created_by   uuid        NOT NULL REFERENCES app_user (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    accepted_by  uuid        REFERENCES app_user (id),
    accepted_at  timestamptz,
    CHECK ((status = 'ACCEPTED') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);

CREATE INDEX ix_family_invitation_family_status ON family_invitation (family_id, status);

-- ---------------------------------------------------------------------------
-- Pessoas acompanhadas
-- ---------------------------------------------------------------------------

CREATE TABLE person (
    id            uuid        PRIMARY KEY,
    family_id     uuid        NOT NULL REFERENCES family (id),
    -- Conta associada ao perfil (adulto com conta). Uma coluna = no máximo uma
    -- conta por perfil; a FK composta garante que a conta pertence à mesma
    -- família; o UNIQUE impede dois perfis para a mesma conta na família.
    user_id       uuid,
    display_name  text        NOT NULL CHECK (length(btrim(display_name)) > 0),
    birth_date    date,
    active        boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (family_id, id),
    UNIQUE (family_id, user_id),
    FOREIGN KEY (family_id, user_id) REFERENCES family_member (family_id, user_id)
);

CREATE INDEX ix_person_family_active ON person (family_id, active);

-- ---------------------------------------------------------------------------
-- Configurações
-- ---------------------------------------------------------------------------

-- Padrões da família (seção 6.4). Valores iniciais acordados na seção 6.1;
-- são configuração do produto, não recomendação médica. Alterá-los não muda
-- tratamentos já cadastrados.
CREATE TABLE family_settings (
    family_id                uuid        PRIMARY KEY REFERENCES family (id),
    reminder_before_minutes  integer     NOT NULL DEFAULT 10 CHECK (reminder_before_minutes BETWEEN 0 AND 1440),
    repeat_interval_minutes  integer     NOT NULL DEFAULT 15 CHECK (repeat_interval_minutes BETWEEN 1 AND 1440),
    -- Decisão em aberto 5: limite provisório.
    repeat_limit             integer     NOT NULL DEFAULT 4  CHECK (repeat_limit BETWEEN 0 AND 100),
    late_tolerance_minutes   integer     NOT NULL DEFAULT 30 CHECK (late_tolerance_minutes BETWEEN 0 AND 1440),
    confirmation_policy      text        NOT NULL DEFAULT 'IMPORTANT_ONLY'
                                         CHECK (confirmation_policy IN ('IMPORTANT_ONLY', 'ALL', 'NONE')),
    version                  bigint      NOT NULL DEFAULT 1,
    updated_by               uuid        REFERENCES app_user (id),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Preferências pessoais (seção 6.4). Afetam apenas como o usuário recebe
-- avisos; nunca a agenda compartilhada.
CREATE TABLE user_notification_settings (
    user_id                     uuid        PRIMARY KEY REFERENCES app_user (id),
    sound_enabled               boolean     NOT NULL DEFAULT true,
    vibration_enabled           boolean     NOT NULL DEFAULT true,
    early_reminder_enabled      boolean     NOT NULL DEFAULT true,
    -- NULL = seguir o intervalo do tratamento.
    repeat_interval_minutes     integer     CHECK (repeat_interval_minutes BETWEEN 1 AND 1440),
    confirmation_notifications  boolean     NOT NULL DEFAULT false,
    quiet_hours_enabled         boolean     NOT NULL DEFAULT false,
    quiet_hours_start           time,
    quiet_hours_end             time,
    sync_notice_mode            text        NOT NULL DEFAULT 'NOTIFY' CHECK (sync_notice_mode IN ('NOTIFY', 'SILENT')),
    -- Seção 12: sem detalhes sensíveis na tela bloqueada por padrão.
    lock_screen_details         boolean     NOT NULL DEFAULT false,
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT quiet_hours_enabled OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- Medicamentos e tratamentos
-- ---------------------------------------------------------------------------

-- Catálogo opcional; family_id NULL = item global.
CREATE TABLE medication (
    id          uuid        PRIMARY KEY,
    family_id   uuid        REFERENCES family (id),
    name        text        NOT NULL CHECK (length(btrim(name)) > 0),
    form        text,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE treatment (
    id              uuid        PRIMARY KEY,
    family_id       uuid        NOT NULL REFERENCES family (id),
    person_id       uuid        NOT NULL,
    medication_id   uuid        REFERENCES medication (id),
    name            text        NOT NULL CHECK (length(btrim(name)) > 0),
    kind            text        NOT NULL CHECK (kind IN ('CONTINUOUS', 'OCCASIONAL')),
    -- Transcrição da prescrição; o sistema nunca calcula nem ajusta.
    prescribed_dose text        NOT NULL CHECK (length(btrim(prescribed_dose)) > 0),
    route           text,
    instructions    text,
    status          text        NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED')),
    start_at        timestamptz NOT NULL,
    end_at          timestamptz,
    version         bigint      NOT NULL,
    created_by      uuid        NOT NULL REFERENCES app_user (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid        NOT NULL REFERENCES app_user (id),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (family_id, id),
    FOREIGN KEY (family_id, person_id) REFERENCES person (family_id, id),
    CHECK (end_at IS NULL OR end_at > start_at),
    CHECK (version >= 1)
);

CREATE INDEX ix_treatment_person_status ON treatment (person_id, status);
CREATE INDEX ix_treatment_family_status ON treatment (family_id, status);

CREATE TABLE treatment_schedule (
    id                       uuid        PRIMARY KEY,
    treatment_id             uuid        NOT NULL REFERENCES treatment (id),
    -- RRULE (RFC 5545) interpretada no fuso abaixo (decisão em aberto 6).
    recurrence_rule          text        NOT NULL,
    timezone                 text        NOT NULL,
    reminder_before_minutes  integer     NOT NULL CHECK (reminder_before_minutes BETWEEN 0 AND 1440),
    repeat_interval_minutes  integer     NOT NULL CHECK (repeat_interval_minutes BETWEEN 1 AND 1440),
    repeat_limit             integer     NOT NULL CHECK (repeat_limit BETWEEN 0 AND 100),
    late_tolerance_minutes   integer     NOT NULL CHECK (late_tolerance_minutes BETWEEN 0 AND 1440),
    active                   boolean     NOT NULL DEFAULT true,
    version                  bigint      NOT NULL DEFAULT 1,
    created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_treatment_schedule_treatment ON treatment_schedule (treatment_id);

CREATE TABLE treatment_revision (
    id              uuid        PRIMARY KEY,
    treatment_id    uuid        NOT NULL REFERENCES treatment (id),
    version         bigint      NOT NULL,
    base_version    bigint,
    snapshot        jsonb       NOT NULL,
    -- A partir de quando a mudança vale (seção 4.5, passo 2).
    effective_from  timestamptz NOT NULL,
    change_reason   text,
    created_by      uuid        NOT NULL REFERENCES app_user (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (treatment_id, version),
    CHECK (base_version IS NULL OR base_version < version)
);

-- ---------------------------------------------------------------------------
-- Dispositivos, ocorrências e administrações
-- ---------------------------------------------------------------------------

CREATE TABLE device (
    id            uuid        PRIMARY KEY,
    user_id       uuid        NOT NULL REFERENCES app_user (id),
    platform      text        NOT NULL CHECK (platform IN ('ANDROID')),
    name          text,
    status        text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz,
    revoked_at    timestamptz,
    CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE INDEX ix_device_user ON device (user_id);

CREATE TABLE dose_occurrence (
    id                uuid        PRIMARY KEY,
    family_id         uuid        NOT NULL,
    treatment_id      uuid        NOT NULL,
    schedule_id       uuid        NOT NULL REFERENCES treatment_schedule (id),
    -- Chave lógica gerada pela regra de recorrência (ex.: "2026-10-22T08:00#1").
    -- Impede gerar duas vezes a mesma ocorrência sem proibir duas doses
    -- legítimas no mesmo horário (sufixos distintos).
    slot_key          text        NOT NULL,
    scheduled_at      timestamptz NOT NULL,
    schedule_version  bigint      NOT NULL,
    status            text        NOT NULL CHECK (status IN (
                          'SCHEDULED', 'PENDING', 'ADMINISTERED',
                          'NOT_ADMINISTERED', 'CANCELLED', 'REVIEW_REQUIRED')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (schedule_id, slot_key),
    FOREIGN KEY (family_id, treatment_id) REFERENCES treatment (family_id, id)
);

CREATE INDEX ix_dose_occurrence_treatment_time ON dose_occurrence (treatment_id, scheduled_at);
-- Ocorrências em aberto no escopo da família (tela Hoje).
CREATE INDEX ix_dose_occurrence_family_open ON dose_occurrence (family_id, scheduled_at)
    WHERE status IN ('SCHEDULED', 'PENDING', 'REVIEW_REQUIRED');

-- ---------------------------------------------------------------------------
-- Sincronização
-- ---------------------------------------------------------------------------

CREATE TABLE sync_operation (
    id             uuid        PRIMARY KEY,
    family_id      uuid        NOT NULL REFERENCES family (id),
    device_id      uuid        NOT NULL REFERENCES device (id),
    actor_id       uuid        NOT NULL REFERENCES app_user (id),
    -- UUID estável gerado no dispositivo e repetido em cada reenvio (seção 10.1).
    operation_key  uuid        NOT NULL,
    entity_type    text        NOT NULL,
    entity_id      uuid        NOT NULL,
    base_version   bigint,
    payload        jsonb       NOT NULL,
    status         text        NOT NULL CHECK (status IN ('RECEIVED', 'APPLIED', 'CONFLICT', 'REJECTED')),
    result         jsonb,
    received_at    timestamptz NOT NULL DEFAULT now(),
    processed_at   timestamptz,
    UNIQUE (device_id, operation_key)
);

CREATE TABLE administration_record (
    id                  uuid        PRIMARY KEY,
    -- No máximo uma administração válida por ocorrência (seção 5.3).
    dose_occurrence_id  uuid        NOT NULL UNIQUE REFERENCES dose_occurrence (id),
    recorded_by         uuid        NOT NULL REFERENCES app_user (id),
    device_id           uuid        NOT NULL REFERENCES device (id),
    sync_operation_id   uuid        REFERENCES sync_operation (id),
    administered_at     timestamptz NOT NULL,
    recorded_at         timestamptz NOT NULL,
    received_at         timestamptz NOT NULL DEFAULT now(),
    notes               text
);

CREATE TABLE sync_conflict (
    id            uuid        PRIMARY KEY,
    family_id     uuid        NOT NULL REFERENCES family (id),
    entity_type   text        NOT NULL,
    entity_id     uuid        NOT NULL,
    base_version  bigint,
    status        text        NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
    reason        text        NOT NULL,
    resolution    jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    resolved_by   uuid        REFERENCES app_user (id),
    resolved_at   timestamptz,
    CHECK ((status = 'RESOLVED') = (resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);

-- Um único conflito aberto por entidade; novas propostas entram nele.
CREATE UNIQUE INDEX ux_sync_conflict_open_entity ON sync_conflict (entity_type, entity_id)
    WHERE status = 'OPEN';
CREATE INDEX ix_sync_conflict_family_status ON sync_conflict (family_id, status);

CREATE TABLE sync_conflict_change (
    id             uuid        PRIMARY KEY,
    conflict_id    uuid        NOT NULL REFERENCES sync_conflict (id),
    operation_id   uuid        NOT NULL REFERENCES sync_operation (id),
    base_version   bigint,
    proposed_data  jsonb       NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conflict_id, operation_id)
);

CREATE TABLE sync_cursor (
    id                      uuid        PRIMARY KEY,
    device_id               uuid        NOT NULL REFERENCES device (id),
    family_id               uuid        NOT NULL REFERENCES family (id),
    last_received_sequence  bigint      NOT NULL DEFAULT 0,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (device_id, family_id)
);

-- ---------------------------------------------------------------------------
-- Auditoria e outbox
-- ---------------------------------------------------------------------------

CREATE TABLE audit_event (
    id           uuid        PRIMARY KEY,
    family_id    uuid        NOT NULL REFERENCES family (id),
    actor_id     uuid        NOT NULL REFERENCES app_user (id),
    device_id    uuid        REFERENCES device (id),
    entity_type  text        NOT NULL,
    entity_id    uuid        NOT NULL,
    event_type   text        NOT NULL,
    before_data  jsonb,
    after_data   jsonb,
    reason       text,
    occurred_at  timestamptz NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_audit_event_family_time ON audit_event (family_id, occurred_at);
CREATE INDEX ix_audit_event_entity ON audit_event (entity_type, entity_id, occurred_at);

CREATE TABLE outbox_event (
    id               uuid        PRIMARY KEY,
    family_id        uuid        NOT NULL REFERENCES family (id),
    event_type       text        NOT NULL,
    aggregate_type   text        NOT NULL,
    aggregate_id     uuid        NOT NULL,
    payload          jsonb       NOT NULL,
    status           text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at  timestamptz NOT NULL DEFAULT now(),
    last_error       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    published_at     timestamptz,
    CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL))
);

CREATE INDEX ix_outbox_event_pending ON outbox_event (next_attempt_at) WHERE status = 'PENDING';
