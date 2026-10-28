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

## Componentes

- **Topo e cabeçalho do dia** em tinta, com anel de progresso ("3/5 dadas") e
  o cartão **Próxima dose** sobreposto.
- **Cartões** sem borda, com sombra suave e raio 22px.
- **Barra de abas** flutuante em pílula escura; a aba atual fica clara.
- **Situação sempre com ícone e texto**, nunca só cor: relógio (prevista ou
  pendente), alerta (atrasada), certo (dada), lista (conferir), × (não dada) e
  setas (aguardando envio, com borda tracejada).
- Botões e campos com no mínimo 48px de altura; a ação principal da dose tem
  60px.
