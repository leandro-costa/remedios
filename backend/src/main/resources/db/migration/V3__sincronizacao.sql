-- Fase 3: operações idempotentes vindas dos aparelhos e conflitos de doses.

-- Tipo da operação (ex.: ADMINISTER, MARK_NOT_ADMINISTERED). O id estável
-- gerado no aparelho continua sendo operation_key, único por aparelho.
ALTER TABLE sync_operation
    ADD COLUMN operation_type text NOT NULL,
    ADD CONSTRAINT ck_sync_operation_processed CHECK ((status = 'RECEIVED') = (processed_at IS NULL));

CREATE INDEX ix_sync_operation_entity ON sync_operation (entity_type, entity_id);
CREATE INDEX ix_sync_conflict_change_conflict ON sync_conflict_change (conflict_id, created_at);

-- Estado da entidade quando o conflito foi aberto (ex.: dose já registrada
-- por outro responsável), exibido na revisão.
ALTER TABLE sync_conflict ADD COLUMN details jsonb;

-- O aplicativo é um PWA: aparelhos podem ser navegadores.
ALTER TABLE device DROP CONSTRAINT device_platform_check;
ALTER TABLE device ADD CONSTRAINT device_platform_check CHECK (platform IN ('ANDROID', 'WEB'));
