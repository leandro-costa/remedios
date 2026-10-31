# Convenções do projeto

- **Versões:** use sempre a versão estável mais recente de tudo (Java, Quarkus,
  PostgreSQL, Maven, plugins, imagens Docker, GitHub Actions). Verifique a
  versão atual antes de adicionar ou atualizar uma dependência; não use betas,
  RCs nem milestones. Fixe versões exatas.
- **Ambiente:** tudo roda pelo `docker compose` na raiz (`compose.yaml`):
  banco, API, app e testes. O CI usa o mesmo compose.
- **App:** PWA em `frontend/` (React + Vite + TypeScript), com dependências npm
  fixadas em versões exatas (`save-exact`). Toda tela deve funcionar com a
  cópia offline e nunca indicar "sincronizado" com registros pendentes.
  Toda leitura passa por `useCached` com chave estável (nunca o horário exato
  da consulta) e entra no pré-carregamento (`frontend/src/sync/prefetch.ts`),
  com a mesma chave da tela (`frontend/src/lib/queries.ts`).
- **Offline em tudo:** toda gravação é feita primeiro no aparelho (fila em
  `frontend/src/sync/outbox.ts`, `mutate`), aparece na hora com "Aguardando
  envio" e sincroniza quando houver conexão. Na API, toda gravação aceita
  `Idempotency-Key`, e os cadastros aceitam `id` gerado no aparelho. Só
  exige conexão o que não faz sentido sem ela (veja `docs/decisoes.md`).
- **Esquema:** só pelas migrações Flyway em
  `backend/src/main/resources/db/migration`; nunca altere uma migração já
  publicada, crie uma nova.
- **Idioma:** interface, documentação e mensagens da API em português do Brasil.
- **Domínio:** o sistema organiza informações; nunca calcula, ajusta ou sugere
  doses (ver `docs/especificacao.md`).
