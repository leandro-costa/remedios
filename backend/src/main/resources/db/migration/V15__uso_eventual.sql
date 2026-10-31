-- Uso eventual: cada pessoa tem uma receita padrão, só com itens "se
-- necessário" (ex.: dipirona se febre), que nunca termina sozinha. O id é o
-- da própria pessoa: o aparelho sabe qual é mesmo offline, e dois aparelhos
-- não criam duas.
ALTER TABLE prescription
    ADD COLUMN kind text NOT NULL DEFAULT 'REGULAR' CHECK (kind IN ('REGULAR', 'EVENTUAL')),
    ADD CONSTRAINT ck_prescription_eventual_id CHECK (kind <> 'EVENTUAL' OR id = person_id);
