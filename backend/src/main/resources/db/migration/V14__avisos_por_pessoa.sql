-- Filtro de avisos por pessoa: o responsável não recebe lembretes nem avisos
-- das pessoas listadas aqui. Sem linha = recebe (padrão: todos recebem tudo).
-- O administrador escolhe para qualquer responsável; cada um, para si.
CREATE TABLE notification_mute (
    family_id   uuid        NOT NULL REFERENCES family (id),
    user_id     uuid        NOT NULL REFERENCES app_user (id),
    person_id   uuid        NOT NULL REFERENCES person (id),
    created_by  uuid        NOT NULL REFERENCES app_user (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, person_id)
);
CREATE INDEX ix_notification_mute_family ON notification_mute (family_id, person_id);
