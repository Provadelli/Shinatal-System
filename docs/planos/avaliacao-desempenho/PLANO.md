# Avaliação de desempenho Shinatal — plano

## Contexto
Hoje existem duas peças desconexas: a aba **Conduta** (`/conduta`, votos de conceito entre colegas, só contagem bruta) e a **avaliação formal** lançada à mão no painel de gestão (coleção `avaliacoes`, Seção 11 do cálculo). O pedido é substituir as duas por um processo único, a **Avaliação de desempenho**: três avaliadores (Presidente, RH e um colega escolhido pelo avaliado), 5 perguntas com notas de 0 a 10, parecer do avaliado sobre o texto do Presidente e "ok" final do Presidente. A média final vira o conceito que já alimenta o motor de cálculo.

Decisões já tomadas com o usuário:
- **Média → conceito por faixas**: ≥ 9 excelente (+2%), ≥ 7 bom (0%), ≥ 5 regular (−5%), < 5 insatisfatório (−15%). Reaproveita `TABELA_AVALIACAO` (`frontend/js/calculo-shinatal.js:799`) sem mexer no motor.
- **Perguntas editáveis pelo Presidente e admin**, guardadas em configuração, com textos provisórios até chegarem as definitivas.
- **O Presidente abre o ciclo anual** (substitui o interruptor da Conduta).
- **Remover** os votos de conduta e o lançamento manual de "Avaliação" na gestão. Os dados antigos continuam no Firestore e na exportação LGPD.

Regras de negócio assumidas (documentadas na página):
- O Presidente não é avaliado. Ninguém avalia a si mesmo.
- O colega escolhido pode ser qualquer pessoa ativa, exceto o Presidente, quem tem papel RH e o próprio avaliado. A escolha é feita uma vez por ciclo e não pode ser trocada depois que ele começar a avaliar.
- Se o avaliado for RH, a vaga "RH" é preenchida por outra pessoa com papel RH. Se não existir outra, essa etapa é dispensada e a média usa 2 avaliações.
- O comentário final é obrigatório para Presidente e RH e opcional para o colega. Respostas enviadas não podem ser editadas.

## Modelo de dados (Firestore, sem Cloud Functions)
- `configuracoes/avaliacaoDesempenho` `{ ativo, ano, perguntas: [5 strings], atualizadoPor, atualizadoEm }`
- `ciclosAvaliacao/{ano}_{uid}`: um documento por colaborador por ano.
  `{ uid, ano, avaliadorUid, concluidas: {presidente, rh, par}, rhDispensado, parecer, parecerEm, okPresidenteEm, media, conceito, criadoEm, atualizadoEm }`
  A etapa é **derivada** desses campos, sem campo de status duplicado: escolha → avaliações → parecer → aguardando ok → finalizada.
- `respostasAvaliacao/{ano}_{avaliadoUid}_{papel}`, com `papel ∈ presidente|rh|par` e ID determinístico.
  `{ ano, avaliadoUid, avaliadorUid, papel, notas: [5 inteiros 0–10], comentario, criadoEm }`. Nunca pode ser atualizado nem apagado.

**Cálculo**: média = (Σ notas) / (5 × nº de avaliações), arredondada para 1 casa. A banda vira o conceito. No "ok", o Presidente grava numa única transação `ciclo.okPresidenteEm/media/conceito` e cria um documento em `avaliacoes` (`validadoRH: true`, `justificativa: "Média X,X — avaliação de desempenho {ano}"`). Assim o motor de cálculo continua lendo a mesma fonte.

## Regras de segurança (`backend/firestore.rules`)
- Seguir o padrão de schema fechado já usado (`hasOnly`, enums, `avaliacaoValida` nas linhas 514-525).
- **Ciclo**:
  - O avaliado cria o próprio ciclo, se `configuracoes.ativo` estiver ligado e o `ano` for o vigente, escolhendo um `avaliadorUid` válido. A regra faz `get` em `usuarios`: o escolhido não pode ser presidente, rh ou o próprio avaliado, e precisa estar ativo.
  - Cada avaliador só pode mudar a própria flag em `concluidas` para `true`, e `getAfter` exige que a resposta correspondente exista (mesmo padrão de `contagemAcompanhaVoto`, linhas 787-802).
  - O avaliado grava `parecer` uma única vez, e só depois de todas as avaliações concluídas.
  - O Presidente grava o "ok" só se o parecer existir. A **regra recalcula a média** lendo as 3 respostas e confere se o conceito bate com a faixa, o que impede gravar um conceito adulterado.
- **Resposta**: só é criada pelo avaliador correto daquele papel (presidente, rh ou o `avaliadorUid` do ciclo), com 5 notas inteiras entre 0 e 10 e comentário obrigatório (≥ 20 caracteres) quando o papel não é `par`.
  - **Leitura**: o próprio avaliador lê a sua; o Presidente lê todas; o avaliado lê **apenas quando as 3 existirem**, verificado com `exists()` nos IDs determinísticos.
- Remover as regras de `votosConduta` e `condutaContagem` para escrita, mantendo a leitura do próprio dono por causa da LGPD. Remover `avaliacaoConduta`.
- `backend/firestore.indexes.json`: índice `ciclosAvaliacao(ano, avaliadorUid)`.

## Frontend

### Página
- `frontend/conduta.html` passa a ser `frontend/avaliacao.html`, com título "Avaliação de desempenho".
  - `vercel.json` ganha um redirect 301 de `/conduta` para `/avaliacao`.
  - `scripts/layout.mjs` (`CABECALHO_POR_PAGINA`) e `scripts/partials/cabecalho-sistema.html` (linhas 18, 46 e 61: desktop, menu mobile e dock) ganham o novo rótulo e o ícone `grading`.
- Conteúdo da página, em seções `data-reveal` com as entradas `anim-entrada-*` já existentes:
  1. **Avisos**, no topo, só quando houver pendência:
     - Para todos: os ciclos em que sou o `avaliadorUid` e a resposta `par` ainda falta.
     - Para RH: ciclos sem resposta `rh`.
     - Para o Presidente: ciclos sem resposta `presidente` e ciclos aguardando ok.
     - Cada aviso é um `.cartao` com botão `.btn-pilula--solido` "Avaliar", que abre um modal.
     - O mesmo total aparece como contador na navegação, reaproveitando `[data-contador-solicitacoes]`/`.nav-contador` (`cabecalho-sistema.js:43-51`).
  2. **Meu processo** (não aparece para o Presidente):
     - Linha do tempo horizontal no desktop e vertical no mobile, com 6 marcos: escolha → Presidente → RH → colega → parecer → ok.
     - O fio preenchido é um único elemento com `transform: scaleX/scaleY(k/n)` e transição em `--transicao`. Usa só compositor, sem layout shift, e tem fallback para `prefers-reduced-motion`.
     - Gradiente ouro→vinho igual ao de `.tela-carregamento-fio`.
     - No passo 1 aparece o seletor do colega, com busca no `diretorioPublico` já filtrado.
     - Ao fim das avaliações: as 3 respostas (notas + comentários), a média animada com `animarNumero` (`ui-utils.js:303`) e o formulário de parecer.
  3. **Painel do Presidente**:
     - Ligar e desligar o ciclo do ano.
     - Editar as 5 perguntas.
     - Tabela de todos os colaboradores, com a etapa e um botão "Ver respostas", que abre um `.painel-lateral` com as 3 respostas e o parecer.
     - Botão "Dar ok", que passa por `confirmarAcao()` antes de gravar.
- **Modal de avaliação**: as 5 perguntas, cada uma com um seletor segmentado de 0 a 10 (`radiogroup`, navegável por teclado). Reaproveita o CSS órfão de "seletor segmentado" (`styles.css:2443-2467`). Abaixo, um textarea, obrigatório conforme o papel. No mobile o modal vira a folha que sobe de baixo, que já existe.

### Código
- Novo `frontend/js/avaliacao-service.js`, no lugar de `conduta-service.js`:
  - `assinarConfig`, `salvarConfig`, `assinarMeuCiclo`, `escolherAvaliador`, `assinarPendencias(perfil)`, `enviarResposta` (transação resposta + flag), `buscarRespostas`, `enviarParecer`, `darOk` (transação ciclo + `avaliacoes` + `registrarLog`).
  - Funções puras exportadas e testáveis: `calcularMedia(respostas)` e `conceitoPorMedia(media)`.
  - Mantém `sincronizarDiretorio` (usado em `dashboard.js:29` e `gestao.js:35,53`).
- Novo `frontend/js/paginas/avaliacao.js`, no lugar de `paginas/conduta.js`, usando `exigirAutenticacao`, `mostrarToast`, `abrirModal`/`fecharModal`, `confirmarAcao` e `ativarRevelacaoAoRolar`.
- Estilos novos em `frontend/css/styles.css`: `.linha-processo` e `.aviso-avaliacao`, usando as variáveis `--shinatal-*` e Fraunces só nos números da média.
- `scripts/fonte-icones.mjs` passa a varrer também `frontend/js/paginas/`, porque hoje não varre. Depois, rodar `npm run icones`.

### Remoções
- Os votos de conduta: `paginas/conduta.js` e as funções de voto e flag em `conduta-service.js`.
- Os imports mortos em `gestao.js:19-20`.
- A ação rápida "Avaliação" (`gestao.html:137-139`), a opção no `#modal-nova-acao` (linhas 346 e 412-426) e o ramo correspondente em `gestao.js:699-714`. O botão de excluir avaliação no perfil continua.
- `perfil-view.js:136-147`: troca o grid de contagem de conduta pela última média e conceito da avaliação de desempenho.
- `perfil.js:150-176` / `meus-dados-pdf.js:33`: a exportação LGPD passa a incluir o próprio ciclo e as respostas visíveis, e mantém os votos antigos.
- `regulamento.html:158-162`: descrever o novo processo da Seção 11 e as faixas de nota.

## Desempenho e responsividade
- Sem bibliotecas novas. A página continua sendo um módulo ES estático.
- Uma assinatura `onSnapshot` por bloco, com consultas limitadas ao ano vigente.
- As respostas só são buscadas sob demanda, ao abrir o painel.
- Animações apenas em `transform`/`opacity`. Skeleton durante o carregamento, para manter o CLS em 0.
- Layout mobile-first: a linha do tempo fica vertical abaixo de 640px, os alvos de toque têm pelo menos 44px, e o seletor 0-10 quebra em 2 linhas no mobile.

## Verificação
1. `cd backend/tests/rules && npm test`, com casos novos para:
   - escolha inválida (presidente, rh, a si mesmo);
   - nota fora de 0–10;
   - comentário ausente para Presidente ou RH;
   - avaliado lendo antes e depois das 3 respostas;
   - RH lendo resposta alheia (deve ser negado);
   - parecer antes da hora;
   - ok com conceito adulterado;
   - resposta imutável.
2. `npm run test:calculo`, mais um teste novo para `calcularMedia`/`conceitoPorMedia` nos limites 4,9 / 5 / 6,9 / 7 / 8,9 / 9.
3. `npm run build`, para garantir que layout, CSS, tsc e vite passam.
4. Fluxo completo no emulador com `npm run dev`:
   - O Presidente abre o ciclo.
   - O colaborador escolhe um colega.
   - Presidente, RH e colega avaliam, conferindo os avisos e o contador.
   - O colaborador vê as respostas e envia o parecer.
   - O Presidente dá o ok.
   - Conferir o documento em `avaliacoes` e o efeito no cálculo.
   - Repetir em 360px, 768px e desktop.
5. `backend/tests/a11y/auditar.mjs`, incluindo `/avaliacao` e atualizando a semente da linha 216: zero violações no axe e Lighthouse ≥ 95 em todas as categorias.
6. Lembrete de deploy: `firebase deploy --only firestore:rules,firestore:indexes` antes do merge na `main`.
