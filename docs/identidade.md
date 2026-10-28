# Identidade visual

Verde-cuidado, tinta e névoa: um app calmo, legível à noite e de um toque só
nas ações frequentes. Os valores ficam em `frontend/src/styles.css` (`:root`,
com versão escura em `prefers-color-scheme: dark`).

## Marca

- Ícone (`frontend/public/icon.svg`): cápsula em contorno branco com um
  "certo" âmbar, sobre quadrado arredondado verde. O mesmo desenho é usado no
  topo do app (`Mark` em `components/Icon.tsx`).
- PNGs do manifesto (192, 512, maskable 512 com área segura de 80% e
  apple-touch 180) são gerados a partir do SVG.
- `theme_color` `#0e2a33` (tinta) e `background_color` `#f3f6f5` (névoa).

## Cores

| Papel | Claro | Escuro |
|---|---|---|
| Fundo (névoa) | `#F3F6F5` | `#0B1A1F` |
| Superfície | `#FFFFFF` | `#13262C` |
| Texto / tinta | `#0E2A33` | `#E6EEEC` |
| Principal (verde-cuidado) | `#12695A` | `#7FD3BC` |
| Destaque (menta) | `#7FD3BC` | `#7FD3BC` |
| Pendente / prevista (âmbar) | `#7A5000` sobre `#FDF0D2` | `#F7CF7A` sobre `#3A2F12` |
| Atrasada (terracota) | `#8A2F06` sobre `#FBE3D6` | `#FFAB80` sobre `#3D2216` |
| Dada (verde) | `#0B4A3F` sobre `#DDF1EA` | `#8EE0C8` sobre `#173A33` |
| Conferir (índigo) | `#352B99` sobre `#E6E3FA` | `#B9B0FF` sobre `#262147` |

Todas as combinações de texto passam no contraste AA (4,5:1), verificado
pelo axe nos dois temas (`e2e/qualidade.spec.ts`).

## Tipografia

Plus Jakarta Sans (variável), servida pelo próprio app
(`@fontsource-variable/plus-jakarta-sans`), porque a CSP só aceita fontes do
mesmo endereço (`font-src 'self'`). Títulos em 800, botões em 700.

## Telas (como nos quadros do design)

- **Sem barra escura no topo.** Cada tela abre com título grande e uma linha
  de apoio; telas internas (dose, tratamento, formulários) têm o botão
  redondo de voltar e o título ao centro. O selo "N aguardando envio" flutua
  no topo só quando há registro pendente ou recusado.
- **Hoje:** cabeçalho escuro com avatar, saudação ("Boa tarde, Ana"), sino
  (leva às notificações), "Hoje" com a data por extenso, selo de
  sincronização e anel "X/Y dadas". O cartão **Próxima dose** se sobrepõe ao
  cabeçalho. A lista mostra cada dose numa linha: horário, medicamento,
  pessoa · dose e situação; "Dada no horário" quando o horário já chegou.
- **Dose:** círculo menta grande com o ícone do medicamento, nome, pessoa,
  selo do horário e da situação; depois a dose e a via em linhas com
  divisória, o registro e as ações.
- **Família:** título com o nome da família; cada pessoa com **avatar** (a
  inicial num círculo colorido), resumo do dia e anel das doses de hoje;
  responsáveis com avatar e papel; configurações abaixo.
- **Saúde:** pessoa, botões "+ Aferição" e "+ Sintoma", sintomas em
  andamento com ícone, e cada gráfico com o **último valor em destaque**.
- **Tratamentos e Histórico:** cartões com ícone do medicamento (ou avatar
  da pessoa), detalhe e situação.
- **Entrar:** a marca grande sobre fundo tinta, com "O cuidado da família,
  dose a dose".

## Componentes

- **Avatar** (`components/Avatar.tsx`): inicial em tinta sobre uma de seis
  cores claras, escolhida pelo id (a mesma pessoa tem sempre a mesma cor).
  É decorativo: o nome aparece ao lado.
- **Ícone em ladrilho:** quadrado arredondado menta com o ícone de traço
  (medicamento, sintoma).
- **Cartões** sem borda, com sombra suave e raio 22px.
- **Barra de abas** flutuante em pílula escura, só com ícones (cada um com
  nome acessível); a aba atual fica num círculo branco.
- **Situação sempre com ícone e texto**, nunca só cor: relógio (prevista ou
  pendente), alerta (atrasada), certo (dada), lista (conferir), × (não dada) e
  setas (aguardando envio, com borda tracejada).
- Botões e campos com no mínimo 48px de altura; a ação principal da dose tem
  60px.
- **Tema escuro:** o item selecionado (filtros) fica em menta, porque a tinta
  quase some no fundo escuro.
