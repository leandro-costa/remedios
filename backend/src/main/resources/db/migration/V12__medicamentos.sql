-- Medicamento como cadastro da família, reaproveitado entre tratamentos, com
-- as substâncias (princípios ativos) e a concentração de cada uma. O nome é o
-- que a família usa (comercial ou genérico). O app guarda e mostra; não
-- compara doses nem sugere troca de medicamento.
ALTER TABLE medication
    ADD COLUMN manufacturer text,
    -- Categoria regulatória da ANVISA, quando veio do catálogo (Genérico, Similar, Novo…).
    ADD COLUMN category     text,
    ADD COLUMN created_by   uuid REFERENCES app_user (id),
    ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now();

CREATE INDEX ix_medication_family ON medication (family_id, lower(name));

CREATE TABLE medication_substance (
    medication_id  uuid    NOT NULL REFERENCES medication (id) ON DELETE CASCADE,
    position       integer NOT NULL CHECK (position >= 0),
    substance      text    NOT NULL CHECK (length(btrim(substance)) > 0),
    -- Como no rótulo (ex.: "750 mg", "250 mg/5 ml"); o app nunca calcula.
    concentration  text,
    PRIMARY KEY (medication_id, position)
);

-- Tratamentos já cadastrados ganham um medicamento da família com o mesmo
-- nome (um por nome, sem diferenciar maiúsculas), para poderem ser reaproveitados.
INSERT INTO medication (id, family_id, name, created_at, updated_at)
SELECT gen_random_uuid(), t.family_id, min(btrim(t.name)), min(t.created_at), now()
  FROM treatment t
 WHERE t.medication_id IS NULL
 GROUP BY t.family_id, lower(btrim(t.name));

UPDATE treatment t
   SET medication_id = m.id
  FROM medication m
 WHERE t.medication_id IS NULL
   AND m.family_id = t.family_id
   AND lower(btrim(m.name)) = lower(btrim(t.name));

-- Catálogo de medicamentos registrados na ANVISA (dados abertos), importado
-- periodicamente e copiado para o aparelho para sugerir nome, substâncias e
-- fabricante ao digitar. Só registros ativos.
CREATE TABLE anvisa_product (
    id            bigserial PRIMARY KEY,
    name          text NOT NULL,
    -- Princípios ativos como vêm da ANVISA, separados por vírgula.
    substances    text,
    manufacturer  text,
    category      text
);

CREATE TABLE anvisa_import (
    id             integer     PRIMARY KEY CHECK (id = 1),
    -- Muda a cada importação com conteúdo diferente: o aparelho só baixa de novo quando muda.
    version        text        NOT NULL,
    source         text        NOT NULL,
    product_count  integer     NOT NULL,
    imported_at    timestamptz NOT NULL
);
