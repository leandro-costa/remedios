-- Receita: agrupa os tratamentos (itens) de uma pessoa, como numa receita do
-- médico com várias prescrições. Cada item continua sendo um tratamento, com
-- medicamento, dose, agenda (ou "se necessário"), período e situação próprios.
-- A situação da receita é calculada a partir dos itens.
CREATE TABLE prescription (
    id             uuid        PRIMARY KEY,
    family_id      uuid        NOT NULL REFERENCES family (id),
    person_id      uuid        NOT NULL REFERENCES person (id),
    -- Ex.: "Infecção de garganta"; sem título, o app mostra os medicamentos.
    title          text,
    prescriber     text,
    prescribed_on  date,
    notes          text,
    created_by     uuid        NOT NULL REFERENCES app_user (id),
    created_at     timestamptz NOT NULL,
    updated_at     timestamptz NOT NULL,
    deleted_at     timestamptz,
    deleted_by     uuid        REFERENCES app_user (id),
    delete_reason  text
);
CREATE INDEX ix_prescription_family_person ON prescription (family_id, person_id);

-- Cada tratamento existente vira uma receita com um item (mesma pessoa,
-- mesmo autor e data; excluídos continuam excluídos).
ALTER TABLE treatment ADD COLUMN prescription_id uuid REFERENCES prescription (id);
CREATE TEMPORARY TABLE tmp_receita AS SELECT id AS treatment_id, gen_random_uuid() AS prescription_id FROM treatment;
INSERT INTO prescription (id, family_id, person_id, created_by, created_at, updated_at, deleted_at, deleted_by,
                          delete_reason)
SELECT r.prescription_id, t.family_id, t.person_id, t.created_by, t.created_at, t.updated_at, t.deleted_at,
       t.deleted_by, t.delete_reason
  FROM treatment t JOIN tmp_receita r ON r.treatment_id = t.id;
UPDATE treatment t SET prescription_id = r.prescription_id FROM tmp_receita r WHERE r.treatment_id = t.id;
DROP TABLE tmp_receita;
ALTER TABLE treatment ALTER COLUMN prescription_id SET NOT NULL;
CREATE INDEX ix_treatment_prescription ON treatment (prescription_id);

-- Ações do próprio sistema (ex.: encerrar um item ao fim do período previsto)
-- ficam na auditoria sem autor.
ALTER TABLE audit_event ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE treatment_revision ALTER COLUMN created_by DROP NOT NULL;
