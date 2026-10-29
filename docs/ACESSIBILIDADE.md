# Acessibilidade do Shinatal

Referências adotadas: **WCAG 2.2, nível AA** (W3C), **ABNT NBR 17225:2025** (acessibilidade em
conteúdo e aplicações web) e **eMAG 3.1**. A obrigação legal de fundo é a Lei Brasileira de
Inclusão (Lei 13.146/2015, art. 63).

## Como auditar

```bash
cd backend/tests/a11y
npm install
npm test                 # axe-core + Lighthouse, inclusive Performance (uns 10 minutos)
SEM_LIGHTHOUSE=1 npm test   # só axe-core e teclado (1 minuto)
CAPTURAS=1 npm test         # também salva uma captura de cada estado em relatorio/capturas/
DIAGNOSTICO=1 npm test      # detalha CPU, maiores arquivos, deslocamentos e erros do console
```

O teste fixa `prefers-reduced-motion: no-preference`: sem isso, numa máquina com as animações do
Windows desligadas o botão "Pausar animações" some e a verificação dele falha. O servidor local
comprime HTML/CSS/JS com gzip, como o Firebase Hosting, para o Lighthouse medir o site real.

O roteiro (`auditar.mjs`) copia o site para uma pasta temporária, aponta-o para os emuladores do
Firebase (nunca para produção), cria contas e dados de exemplo, faz login e audita com o
**axe-core** — o mesmo motor do axe DevTools — e com o **Lighthouse**, no Chrome instalado. São 34
estados: as páginas públicas, os três painéis logados (desktop e celular) e cada modal, aba e
diálogo de confirmação aberto. Além das regras automáticas, ele confere pelo teclado o que as
ferramentas não medem: foco entra no diálogo, Tab não escapa, Esc fecha, foco volta para quem
abriu, setas trocam de aba, o botão de pausa realmente para o vídeo.

Resultado em 2026-10-27: **axe-core 0 violações** nos 38 estados, **63/63** verificações de
teclado, **Lighthouse Acessibilidade 100** e **Boas práticas 100** nas 10 páginas, e todos os
ícones desenhados. Inclui a LGPD: Termos de Uso, caixa de aceite do cadastro e o diálogo de
aceite no login (foco preso, Esc não fecha, aceitar libera e não pergunta de novo).

## Performance (Lighthouse, celular)

Medida no servidor local com a simulação padrão do Lighthouse (celular médio em 4G). O número
varia de uma rodada para outra, então serve para comparar, não como valor exato de produção.

| Página | Antes (02/10) | Depois (27/10) |
|---|---|---|
| Home | 77 (desktop 68) | 91 (desktop 100) |
| Login / Cadastro / Recuperar senha / Privacidade | 75 a 97 | 96 a 99 |
| Painel do colaborador | 57 | 89 |
| Meu perfil | 57 | 95 |
| Painel de gestão | 55 | 95 |
| Contratos | 70 (CLS 0,25) | 83 (CLS 0,06) |

O que mudou:

- **Fontes no próprio site (29/10):** Inter, Playfair Display e Material Symbols ficam em
  `frontend/assets/fonts/` (woff2, só o subconjunto latino do texto, 131 KB no total) com os
  `@font-face` em `css/fontes.css`. Antes vinham do Google Fonts: duas folhas de estilo de outro
  domínio que travavam a primeira pintura (~1 s no celular). Só a fonte de ícones tem `preload`
  (9 KB, `font-display: block`); as de texto usam `swap`.
- **Fonte de ícones:** um estilo fixo e só os ícones usados (9 KB, antes 4 MB). **Ícone novo no
  HTML ou no JS: rode `npm run icones`** (`scripts/fonte-icones.mjs`): ele refaz a lista, baixa os
  woff2 de novo (nome com hash, para o cache longo não servir versão velha), regera
  `css/fontes.css` e atualiza o bloco `<!-- fontes:inicio -->` de todas as páginas. A auditoria
  acusa ícone que ficou sem desenho.
- **Home sem o SDK do Firebase (29/10):** os três números públicos (fundo e colaboradores) vêm da
  API REST do Firestore (`fetch`, relido a cada minuto com a aba visível), com a configuração
  pública em `js/firebase-config.js`. A home deixou de baixar o Firebase e o reCAPTCHA do App
  Check: ~600 KB e ~12 s de bloqueio da thread principal no celular (TBT de 12 s para 0,2 s em
  produção). As outras páginas continuam com o SDK e o App Check.
- **Tela "Carregando":** sumia no evento `load` (esperava fotos e vídeo, até 3 s). Agora some com o
  HTML/CSS prontos, de 0,3 a 1 s, e na hora com "reduzir movimento".
- **Vídeo do topo (29/10):** volta a tocar em qualquer aparelho. São duas versões geradas por
  `npm run optimize:video` a partir de `design/video/hero-original.mp4` (fora da pasta publicada):
  `hero-paisagem-v3.mp4` (1280 px) para computador e tablet deitado, e `hero-retrato-v3.mp4`
  (recorte central 9:16, 540×960) para celular em pé, ambas H.264 sem áudio. O `<video>` não tem
  `src` no HTML: o JS escolhe a versão pela orientação da tela e só começa depois do `load`, com o
  navegador ocioso, entrando com fade. Fica só a imagem de capa com "reduzir movimento", Data Saver
  ou 2G. O botão "Pausar animações" para o vídeo (WCAG 2.2.2).
- **Imagem de capa:** duas versões com `preload` por orientação — vertical de 16 KB no celular e
  horizontal de 38 KB no computador (antes 115 KB para todos). A marca-d'água do Pão de Açúcar caiu
  de 103 KB para 30 KB (computador) e 15 KB (celular).
- **Cache (Vercel):** `vercel.json` repete as regras que o Firebase tinha: `assets/` com cache de
  um ano (`immutable`), CSS/JS com 5 minutos.
- **App Check (29/10):** a CSP não liberava `www.google.com/recaptcha/` no `connect-src`, e o
  reCAPTCHA Enterprise falhava (erro no console e 403 na troca do token). Corrigido em
  `vercel.json` e `firebase.json`.
- **Firebase Auth:** `initializeAuth` sem o resolvedor de popup. O site não usa login com popup, e
  esse resolvedor baixava `apis.google.com/js/api.js` em toda página, bloqueado pela CSP.
- **Layout estável:** a logo do cabeçalho não estica mais (proporção errada), as fotos da faixa
  duplicada têm dimensões, e em Contratos/Gestão o conteúdo ocupa a altura da tela para o rodapé
  não pular quando os dados chegam.
- **Contraste:** o dourado `tertiary` passou de `#8A6A2F` (4,33:1 sobre o creme) para `#7A5C22`
  (5,4:1), o mesmo de `--shinatal-ouro-texto`.
- **Favicon:** 32 px (0,7 KB) e ícone de atalho do iPhone de 180 px, no lugar do PNG de 512 px (47 KB).

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
| 4.1.2 (menu da home) | No celular, as seções ficam num botão "Menu" em texto com `aria-expanded`/`aria-controls`; fecha com Esc e devolve o foco. |
| 1.4.13 (hovers) | Os hovers ("fio dourado") só existem em aparelhos com mouse e nunca são o único sinal de estado. |
| 4.1.3 Mensagens de status | Toasts em regiões vivas criadas no carregamento da página (`status` e `alert`). |

## Regras para quem for mexer no front

- Ícone decorativo: sempre `aria-hidden="true"`. Botão ou link só com ícone: sempre `aria-label`.
  Ícone que ainda não existia no site: rode `npm run icones` na raiz.
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
  o `robots.txt` bloqueia a indexação.
