# Demandas futuras

Funcionalidades combinadas para depois do MVP. Cada item descreve o objetivo,
os requisitos e os cuidados de segurança, para orientar a implementação quando
for priorizado.

## Cadastro de tratamento a partir da foto da receita

**Origem:** pedido do responsável pelo produto; amplia o item "Foto da receita e
documentos anexos" da seção 2.2 da especificação.

### Objetivo

Tirar uma foto da receita no app e receber uma **sugestão de cadastro** dos
medicamentos e dos horários (agenda e lembretes), para conferir e salvar.
Hoje, tudo é digitado à mão.

### Fluxo proposto

1. Em **Tratamentos → Novo**, escolher **"Ler da receita"** e fotografar (ou
   escolher uma imagem da galeria). Uma receita pode ter vários medicamentos.
2. O app extrai o texto e monta uma sugestão para cada medicamento:
   - nome;
   - dose como escrita na receita;
   - via;
   - frequência ("de 8 em 8 horas", "2x ao dia", "por 7 dias");
   - duração e instruções ("após as refeições").
3. Para cada sugestão, o responsável vê **lado a lado** o trecho da foto de onde
   ela saiu e o formulário de tratamento já preenchido. Campos de leitura
   duvidosa vêm destacados e vazios, nunca "chutados".
4. O responsável escolhe a pessoa, corrige o que precisar, define o horário da
   primeira dose e passa pela mesma tela **"Confira antes de salvar"** de hoje.
5. Os tratamentos nascem como **rascunho**. A agenda só é ativada depois da
   conferência, como no fluxo atual.
6. A foto pode ficar anexada ao tratamento, para consulta (opcional, com
   consentimento).

### Regras que não mudam

- **Nada é salvo nem ativado automaticamente.** A sugestão só preenche o
  formulário; quem confirma é o responsável, campo a campo.
- **O sistema não calcula nem ajusta doses** (seção 1). A dose é transcrita
  como está escrita. Ilegível ou ambígua, fica em branco para o responsável
  preencher.
- **Frequência vira agenda** só quando a receita é explícita ("8/8 h" →
  `INTERVAL` de 8 horas). Expressões vagas ("se necessário", "quando tiver
  dor") não geram agenda e ficam indicadas para o responsável decidir.
- **Sem confirmação de medicamento:** o app não compara com bulas nem diz se o
  medicamento ou a dose estão corretos.
- **Aviso visível:** "Confira com a receita original. Em caso de dúvida,
  pergunte ao médico ou farmacêutico."

### Decisões a tomar

1. **Onde ler a receita:**
   - no próprio aparelho: OCR local, privado, funciona offline e é menos preciso
     em letra cursiva;
   - num serviço de IA com visão: lê melhor manuscritos, mas envia dado de saúde
     a terceiro.
   A escolha depende do item 2.
2. **LGPD:** a receita é dado de saúde, muitas vezes de criança. É preciso:
   - consentimento explícito antes de enviar a foto a um serviço externo;
   - um contrato de tratamento de dados com o fornecedor;
   - não guardar a imagem no fornecedor;
   - opção de apagar a foto anexada.
3. **Armazenamento da foto** (se anexada): no banco ou em armazenamento de
   objetos, cifrada e com acesso restrito à família (seção 12).
4. **Receitas digitais** (PDF ou QR Code de receita eletrônica): avaliar a
   leitura direta do arquivo, mais confiável que a foto.
5. **Precisão mínima** aceitável e como medir, com um conjunto de receitas de
   teste anonimizadas.

### Critérios de aceitação

- [ ] Foto da câmera ou da galeria, no celular, pelo PWA.
- [ ] Uma sugestão por medicamento, com o trecho da imagem de origem.
- [ ] Campos duvidosos destacados e vazios; nenhum valor inventado.
- [ ] Tratamentos criados como rascunho, só após conferência e confirmação.
- [ ] Frequência explícita convertida em agenda; vaga, sinalizada e sem
      agenda.
- [ ] Consentimento registrado antes de qualquer envio externo da imagem.
- [ ] Auditoria indicando que o cadastro partiu de uma sugestão de leitura.
- [ ] Testes com receitas impressas, manuscritas e digitais.

### Depende de

- Fase 4 (lembretes), para que a agenda sugerida já gere os avisos.
- Política de privacidade e retenção (decisões em aberto 2 e 9 da
  especificação).
