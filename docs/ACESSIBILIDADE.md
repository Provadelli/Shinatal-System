# Acessibilidade do Shinatal

Referências adotadas: **WCAG 2.2, nível AA** (W3C), **ABNT NBR 17225:2025** (acessibilidade em
conteúdo e aplicações web) e **eMAG 3.1**. A obrigação legal de fundo é a Lei Brasileira de
Inclusão (Lei 13.146/2015, art. 63).

## Como auditar

```bash
cd backend/tests/a11y
npm install
npm test                 # axe-core + Lighthouse (uns 5 minutos)
SEM_LIGHTHOUSE=1 npm test   # só axe-core e teclado (1 minuto)
CAPTURAS=1 npm test         # também salva uma captura de cada estado em relatorio/capturas/
```

O roteiro (`auditar.mjs`) copia o site para uma pasta temporária, aponta-o para os emuladores do
Firebase (nunca para produção), cria contas e dados de exemplo, faz login e audita com o
**axe-core** — o mesmo motor do axe DevTools — e com o **Lighthouse**, no Chrome instalado. São 32
estados: as páginas públicas, os três painéis logados (desktop e celular) e cada modal, aba e
diálogo de confirmação aberto. Além das regras automáticas, ele confere pelo teclado o que as
ferramentas não medem: foco entra no diálogo, Tab não escapa, Esc fecha, foco volta para quem
abriu, setas trocam de aba, o botão de pausa realmente para o vídeo.

Resultado em 2026-10-02: **axe-core 0 violações** nos 32 estados, **54/54** verificações de
teclado e **Lighthouse Acessibilidade 100** nas 9 páginas.

## O que foi feito

| Critério (WCAG) | Onde |
|---|---|
| 1.1.1 Conteúdo não textual | Ícones (Material Symbols, SVG) com `aria-hidden` — antes o leitor de tela lia o nome do ícone ("event_busy"); botões só de ícone com `aria-label`. |
| 1.3.1 Informação e relações | Todo campo com `<label for>` (57 estavam soltos); tabela com `<caption>` e `scope`; abas com `role="tab"`; títulos em ordem; landmarks de navegação com nome. |
| 1.4.1 Uso de cor | Links dentro de texto são sublinhados. |
| 1.4.3 / 1.4.11 Contraste | Tons recalculados em `css/styles.css` (`--shinatal-ouro-texto`, `--shinatal-borda-campo`, `--shinatal-placeholder`) e o token `outline` do Tailwind. O dourado vivo da marca ficou onde ele passa: números grandes, enfeites e fundos escuros. |
| 2.1.1 / 2.1.2 Teclado | Modais com foco preso, Esc e retorno do foco (`js/acessibilidade.js`); trocar foto pelo teclado; abas pelas setas; áreas roláveis alcançáveis. |
| 2.2.1 Tempo ajustável | Toast fica de 5 a 10 s conforme o tamanho do texto e pausa com o ponteiro em cima. |
| 2.2.2 Pausar, parar, ocultar | Botão "Pausar animações" na home (vídeo + faixas), com a escolha lembrada; `prefers-reduced-motion` já entrega tudo parado. |
| 2.4.1 Ignorar blocos | "Pular para o conteúdo" como primeiro Tab de toda página. |
| 2.4.3 / 2.4.7 / 2.4.11 Foco | Foco visível em filete duplo (verde + dourado claro), legível em fundo claro e escuro; `scroll-padding` para o cabeçalho fixo não cobrir o item focado. |
| 2.5.3 Rótulo no nome | O nome acessível contém o texto visível (logo, avatar, contador de solicitações). |
| 2.5.8 Tamanho do alvo | Pontos do carrossel e botão de fechar com área mínima de 24 px. |
| 3.3.1 Identificação de erro | Campo inválido recebe `aria-invalid` e o foco; a mensagem sai em região `role="alert"`. |
| 4.1.2 Nome, função, valor | `role="dialog"`/`aria-modal`/`aria-labelledby` nos modais, `aria-expanded` na sanfona, `aria-current` na navegação, `aria-pressed` na pausa. |
| 4.1.3 Mensagens de status | Toasts em regiões vivas criadas no carregamento da página (`status` e `alert`). |

## Regras para quem for mexer no front

- Ícone decorativo: sempre `aria-hidden="true"`. Botão ou link só com ícone: sempre `aria-label`.
- Campo novo: `<label for="id">`. Sem rótulo visível (busca, filtro): `aria-label`.
- Modal novo: `<div id="modal-..." role="dialog" aria-modal="true" aria-labelledby="...">` com as
  classes `hidden`/`flex` de sempre — o teclado é tratado sozinho por `js/acessibilidade.js`.
- Texto dourado pequeno sobre fundo claro: `text-ouro-legivel` (ou `text-tertiary`), nunca
  `text-festive-gold`.
- Mensagem ao usuário: `mostrarToast()` — já anuncia para leitor de tela.
- Antes de publicar: `npm test` em `backend/tests/a11y`.

## Limites conhecidos

Ferramenta automática cobre uma parte dos critérios; o que segue precisa de olho humano ou não
foi feito:

- **Contraste sobre imagem e vídeo.** O axe marca cerca de 650 elementos como "precisa de revisão
  manual" porque há foto ou vídeo atrás do texto e ele não consegue medir. As cores foram
  conferidas por cálculo contra os fundos sólidos; sobre o vídeo do hero o texto é branco com
  película escura, mas a legibilidade varia com o quadro.
- **Logotipo.** A marca em vinho sobre o vídeo tem contraste baixo; logotipos são isentos do
  critério 1.4.3, e a cor é identidade da marca.
- **Leitor de tela real.** Não houve teste manual com NVDA, VoiceOver ou TalkBack. A marcação segue
  os padrões da WAI-ARIA e passa nas ferramentas, mas só o teste com leitor confirma a experiência.
- **Carrossel "Como funciona".** Os cartões vizinhos aparecem esmaecidos de propósito; todos ficam
  legíveis ao serem trazidos ao centro (setas, pontos ou teclado).
- **Lighthouse, fora de Acessibilidade.** SEO fica entre 58 e 66 de propósito: o portal é interno e
  o `robots.txt` bloqueia a indexação. Boas práticas marca 96 nas páginas públicas por proporção
  de uma imagem.
