# Convenções do projeto

- **Versões:** use sempre a versão estável mais recente de tudo (Java, Quarkus,
  PostgreSQL, Maven, plugins, imagens Docker, GitHub Actions). Verifique a
  versão atual antes de adicionar ou atualizar uma dependência; não use betas,
  RCs nem milestones. Fixe versões exatas.
- **Ambiente:** tudo roda pelo `docker compose` na raiz (`compose.yaml`):
  banco, API e testes. O CI usa o mesmo compose.
- **Esquema:** só pelas migrações Flyway em
  `backend/src/main/resources/db/migration`; nunca altere uma migração já
  publicada, crie uma nova.
- **Idioma:** interface, documentação e mensagens da API em português do Brasil.
- **Domínio:** o sistema organiza informações; nunca calcula, ajusta ou sugere
  doses (ver `docs/especificacao.md`).
