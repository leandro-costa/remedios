-- Tratamento cadastrado por engano: "excluído" some das listas, da tela Hoje,
-- do histórico e das contagens, mas não é apagado. O registro, as doses e a
-- trilha de auditoria continuam no banco (e na exportação da família).
ALTER TABLE treatment
    ADD COLUMN deleted_at    timestamptz,
    ADD COLUMN deleted_by    uuid REFERENCES app_user (id),
    ADD COLUMN delete_reason text,
    ADD CONSTRAINT ck_treatment_deleted
        CHECK ((deleted_at IS NULL) = (deleted_by IS NULL) AND (deleted_at IS NULL) = (delete_reason IS NULL));
