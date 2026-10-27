# Operação: cópias de segurança e restauração

O banco guarda dados de saúde, inclusive de crianças (seção 12). Perder o
histórico ou expor uma cópia são os dois riscos que este guia cobre.

## Fazer uma cópia

```bash
scripts/backup.sh                       # backups/remedios-AAAAMMDD-HHMMSS.dump
scripts/backup.sh /caminho/arquivo.dump
```

A cópia é um `pg_dump` em formato *custom*, comprimido, com permissão `600`. A
pasta `backups/` não vai para o repositório (`.gitignore`). O script usa o
PostgreSQL do `docker compose`. Para outro servidor, defina `PG_EXEC=""` e as
variáveis `PGHOST`, `PGPORT`, `PGUSER` e `PGPASSWORD`.

## Conferir uma cópia sem tocar no banco

```bash
scripts/restore-test.sh                 # faz uma cópia nova e confere
scripts/restore-test.sh arquivo.dump    # confere uma cópia existente
```

O teste restaura a cópia num banco separado (`remedios_restore_test`) e
compara cada tabela com o banco atual: quantidade de linhas e um hash do
conteúdo. A comparação inclui o histórico das migrações. No fim, o banco
separado é apagado. Qualquer diferença faz o teste falhar.

O **CI roda esse teste a cada mudança**, logo depois dos testes de ponta a
ponta, com os dados que eles criaram. Com `--exigir-dados`, o teste falha se
as tabelas principais estiverem vazias.

## Restaurar de verdade

```bash
docker compose stop api
scripts/restore.sh backups/remedios-AAAAMMDD-HHMMSS.dump --confirmar
docker compose start api
```

A restauração **apaga o banco atual**; sem `--confirmar`, o script não faz
nada. Ao subir, a API aplica as migrações que faltarem (Flyway).

### Depois de restaurar

Os aparelhos guardam a própria fila de registros não enviados. Ao voltar a
conexão, eles reenviam essa fila: o que se perdeu entre a cópia e a falha e
ainda estava num aparelho volta ao servidor. O reenvio é seguro (seção 10.1).
Dois cuidados:

- **Avisar os responsáveis** que o histórico voltou ao momento da cópia e
  pedir que abram o app para enviar o que tiverem.
- **Respostas guardadas para reenvio.** A tabela `client_operation` também
  volta ao momento da cópia. Uma operação feita depois da cópia é executada de
  novo ao ser reenviada, o que é o comportamento desejado.

## Política proposta (decisão pendente)

Valores sugeridos, a confirmar antes da produção:

| Item | Proposta |
| --- | --- |
| Frequência | diária (ex.: 03:00), por `cron` ou timer do systemd chamando `scripts/backup.sh` |
| Retenção | 14 cópias diárias + 8 semanais + 6 mensais |
| Local | fora do servidor (ex.: Object Storage da nuvem usada), em região diferente |
| Cifra | antes de sair do servidor (ex.: `age` ou `gpg` com chave guardada fora da nuvem) |
| Perda máxima aceitável (RPO) | 24 h no servidor; os aparelhos reenviam o que tiverem |
| Ensaio | `scripts/restore-test.sh` mensal sobre a cópia mais recente, com registro do resultado |
| Acesso | só quem administra o servidor; cópias contam como dado de saúde (LGPD) |

Exemplo de agendamento (`crontab -e` do usuário que roda o compose):

```cron
0 3 * * * cd /srv/remedios && scripts/backup.sh >> /var/log/remedios-backup.log 2>&1
```
