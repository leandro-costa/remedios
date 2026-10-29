-- Correção de dados: uma alteração de tratamento com vigência anterior ao
-- início de uma versão ainda não iniciada deixava em aberto as doses da versão
-- de antes, e a nova versão gerava os mesmos horários de novo (doses em
-- duplicidade). O código foi corrigido (ScheduleService.stop); aqui, as doses
-- já duplicadas são canceladas.
--
-- Cancela só doses em aberto ('SCHEDULED') de uma versão da agenda que já
-- tinha sido substituída naquele horário (existe versão posterior vigente a
-- partir de antes da dose). Doses registradas (dadas, não dadas, em
-- conferência) não mudam.
UPDATE dose_occurrence o
   SET status = 'CANCELLED',
       status_reason = 'Dose em duplicidade após alteração do tratamento (correção automática)',
       status_changed_at = now(),
       updated_at = now(),
       version = o.version + 1
  FROM treatment_schedule s
 WHERE o.schedule_id = s.id
   AND o.status = 'SCHEDULED'
   AND EXISTS (SELECT 1
                 FROM treatment_schedule later
                WHERE later.treatment_id = s.treatment_id
                  AND later.version > s.version
                  AND later.valid_from <= o.scheduled_at
                  AND (later.valid_until IS NULL OR later.valid_until > later.valid_from));

-- Vigências: cada versão termina quando começa a próxima versão efetiva.
UPDATE treatment_schedule s
   SET valid_until = GREATEST(s.valid_from, n.next_from)
  FROM (SELECT s1.id, MIN(s2.valid_from) AS next_from
          FROM treatment_schedule s1
          JOIN treatment_schedule s2 ON s2.treatment_id = s1.treatment_id AND s2.version > s1.version
         GROUP BY s1.id) n
 WHERE n.id = s.id
   AND n.next_from IS NOT NULL
   AND (s.valid_until IS NULL OR s.valid_until > GREATEST(s.valid_from, n.next_from));
