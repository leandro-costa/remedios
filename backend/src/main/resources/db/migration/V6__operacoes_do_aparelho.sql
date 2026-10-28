-- Gravações feitas offline (seção 10.1): toda operação enviada pelo aparelho
-- leva um id estável (cabeçalho Idempotency-Key). O resultado fica guardado,
-- e um reenvio recebe a mesma resposta, sem repetir os efeitos.
CREATE TABLE client_operation (
    user_id       uuid        NOT NULL REFERENCES app_user (id),
    operation_id  uuid        NOT NULL,
    method        text        NOT NULL,
    path          text        NOT NULL,
    -- Nulos enquanto a operação está em andamento.
    status_code   integer,
    response      text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    completed_at  timestamptz,
    PRIMARY KEY (user_id, operation_id)
);

CREATE INDEX ix_client_operation_created ON client_operation (created_at);
