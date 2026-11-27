# Avaliação de desempenho Shinatal — plano

> **Revisão 4 (27/11/2026).** Notas de 0 a 5 (antes 0 a 10); faixas proporcionais: ≥ 4,5 / ≥ 3,5 / ≥ 2,5. O Admin edita as perguntas e abre/fecha o ciclo; no resto participa como qualquer colaborador (avalia se escolhido, é avaliado se estiver na tabela).
>
> **Situação (27/11/2026): implementado na branch `feat/avaliacao-desempenho`.** Regras, serviço, página,
> script da tabela de fixos e testes já seguem as revisões 1 a 3. Testes das regras (emulador) e de
> cálculo passando; build sem erros. Falta: rodar o script da tabela em produção, publicar as regras e
> testar o fluxo completo com contas reais. A seção "O que muda no WIP" abaixo é histórica.

> **Revisão 3 (27/11/2026).** A resposta do avaliado vai apenas para o Presidente: os avaliadores não a leem.
>
> **Revisão 2 (27/11/2026).** O colega escolhido também escreve um parecer, obrigatório como o do avaliador fixo.
>
> **Revisão 1 (27/11/2026).** O processo passou a ter dois avaliadores: um **avaliador fixo**, definido pela tabela abaixo, e um **colega escolhido** pelo próprio avaliado. Presidente e RH deixam de avaliar por padrão. O Presidente continua lendo tudo e dando o ok final. O commit `ba4aff0` foi escrito para o esquema anterior (Presidente + RH + colega); a seção "O que muda no WIP" lista o que ajustar.

## Contexto
Hoje existem duas peças desconexas:
- a aba **Conduta** (`/conduta`, votos de conceito entre colegas, só contagem bruta);
- a **avaliação formal** lançada à mão no painel de gestão (coleção `avaliacoes`, Seção 11 do cálculo).

As duas viram um processo único, a **Avaliação de desempenho**, que funciona assim:
1. O colaborador é avaliado pelo avaliador fixo e por um colega que ele mesmo escolhe.
2. Cada avaliador dá notas de 0 a 5 em 5 perguntas, mais um comentário.
3. O avaliado escreve um parecer.
4. O Presidente dá o ok final.

A média final vira o conceito que o motor de cálculo já usa.

## Avaliadores fixos (tabela oficial)

| Avaliado | Avaliador fixo |
|---|---|
| Natalia | Eduardo (Presidente) |
| Guido | Marcelo |
| Danilo | Dayane |
| Pedro Lucas | Eduardo (Presidente) |
| Marcelo | Eduardo (Presidente) |
| David | Marcelo |
| Dayane | Eduardo (Presidente) |
| Erickson | Marcelo |
| Juliana | Eduardo (Presidente) |
| Kleber | Erickson |
| Ana Julia | Dayane |

- O Eduardo é o Presidente e não é avaliado.
- **A tabela fica fixa no código.** Quem não estiver nela (um novo contratado, por exemplo) não entra no processo até a tabela ser atualizada numa nova versão.

## Decisões do usuário
- **Média → conceito por faixas**: ≥ 4,5 excelente (+2%), ≥ 3,5 bom (0%), ≥ 2,5 regular (−5%), < 2,5 insatisfatório (−15%). Reaproveita `TABELA_AVALIACAO` (`frontend/js/calculo-shinatal.js:799`) sem mexer no motor de cálculo.
- **Perguntas editáveis pelo Presidente e pelo Admin**, guardadas em configuração. Começam com textos provisórios até chegarem as definitivas.
- **O Presidente ou o Admin abre o ciclo anual**, no lugar do interruptor da Conduta (o Admin entrou em 27/11/2026).
- **Remover** os votos de conduta e o lançamento manual de "Avaliação" no painel de gestão. Os dados antigos continuam no Firestore e na exportação LGPD.
- **Avaliadores** (revisão 1): só o fixo e o colega escolhido. Presidente e RH não avaliam por padrão. O Presidente só avalia quando é o avaliador fixo da pessoa (caso do Eduardo).

## Regras de negócio
- Cada colaborador da tabela tem um avaliador fixo e escolhe **um** colega para também avaliá-lo.
- O colega escolhido pode ser qualquer pessoa ativa, menos:
  - o Presidente e o RH (restrição do pedido original);
  - o próprio avaliado;
  - o avaliador fixo dele, que já avalia.
- Dá para trocar o colega enquanto ele ainda não avaliou.
- **Parecer do avaliador** (revisão 2): os **dois** avaliadores, o fixo e o colega escolhido, têm o campo de parecer escrito, além das notas. O parecer é obrigatório para ambos, com no mínimo 20 caracteres, e o avaliado lê os dois.
- **Resposta do avaliado** (revisão 3): depois de ler as duas avaliações, o avaliado escreve **uma** resposta, endereçada **apenas ao Presidente**. Só o avaliado e o Presidente a leem; o avaliador fixo e o colega escolhido não têm acesso (quando o fixo é o próprio Presidente, ele lê por ser o Presidente). A resposta é enviada uma vez e não pode ser editada.
- Média = média das 10 notas (2 avaliações × 5). Respostas enviadas não podem ser editadas.
- Só o Presidente lê todas as respostas. O avaliado lê as duas depois que ambas forem enviadas. Cada avaliador lê só a própria resposta.
- O avaliador fixo só fica sabendo que tem uma avaliação a fazer depois que o avaliado escolhe o colega, porque é a escolha que cria o ciclo. O aviso de "escolha seu colega" aparece logo no início.

## Modelo de dados (Firestore, sem Cloud Functions)
- **`configuracoes/avaliacaoDesempenho`**: `{ ativo, ano, perguntas: [5], atualizadoPor, atualizadoEm }`. Não muda.
- **`configuracoes/avaliadoresFixos`** (novo): `{ pares: { <uidAvaliado>: <uidAvaliadorFixo> } }`.
  - Nenhum cliente grava (`allow write: if false`). Qualquer usuário verificado lê.
  - A fonte é `backend/scripts/avaliadores-fixos.mjs`, que guarda a tabela acima por nome e e-mail, resolve os uids com o Admin SDK e grava o documento, com os modos `--simular` e `--aplicar` do padrão do projeto.
  - Assim a tabela fica no código e as regras do Firestore conseguem conferir o avaliador fixo.
- **`ciclosAvaliacao/{ano}_{uid}`**: `{ uid, ano, avaliadorFixoUid, avaliadorEscolhidoUid, concluidas: { fixo, escolhido }, respostaEnviadaEm, okPresidenteEm, media, conceito, criadoEm, atualizadoEm }`.
  - O campo `rhDispensado` sai.
  - O texto da resposta do avaliado **não** fica no ciclo, porque os avaliadores leem o ciclo. O ciclo guarda só `respostaEnviadaEm`, que marca a etapa.
- **`respostasAoPresidente/{ano}_{uid}`** (novo): `{ uid, ano, texto, criadoEm }`.
  - Só o avaliado e o Presidente leem.
  - O avaliado cria o documento na mesma escrita em lote que marca `respostaEnviadaEm` no ciclo.
  - Depois de criado, não muda mais.
  - O `avaliadorFixoUid` é copiado da tabela na criação, e a regra confere com `configuracoes/avaliadoresFixos`.
- **`respostasAvaliacao/{ano}_{avaliadoUid}_{papel}`**: `papel ∈ fixo | escolhido`. As notas e a imutabilidade seguem iguais.

**Cálculo**: média = Σ das 10 notas / 10, arredondada a 1 casa, e a faixa define o conceito. No ok, o Presidente grava numa transação o fechamento do ciclo e o documento em `avaliacoes/desempenho_{ano}_{uid}`.

## Regras de segurança (`backend/firestore.rules`)
- **Criar o ciclo**:
  - o avaliado precisa constar em `avaliadoresFixos.pares`;
  - `avaliadorFixoUid` tem de ser igual ao valor de `pares[uid]`;
  - o colega escolhido tem de estar ativo e não pode ser Presidente, RH, o próprio avaliado nem o avaliador fixo;
  - o ciclo tem de estar aberto.
- **Resposta**: o papel é `fixo` quando quem grava é `avaliadorFixoUid` (inclusive se for o Presidente) e `escolhido` quando é `avaliadorEscolhidoUid`. A resposta e a marcação em `concluidas` vão na mesma escrita em lote. O parecer do avaliador (campo `comentario`) precisa ter no mínimo 20 caracteres nos dois papéis, `fixo` e `escolhido`.
- **Leitura de respostas**: o Presidente lê todas; o avaliado lê depois de `concluidas.fixo && concluidas.escolhido`; cada avaliador lê a própria.
- **Leitura de ciclos**: o dono, os dois avaliadores e o Presidente. O RH sai dessa leitura.
- **Resposta do avaliado**: só depois das duas avaliações, uma única vez, com 1 a 2000 caracteres, gravada junto com `respostaEnviadaEm`. A leitura de `respostasAoPresidente` fica restrita ao dono e ao Presidente.
- **Ok**: exige `respostaEnviadaEm` e recalcula a média com as 2 avaliações.

## Frontend (página `/avaliacao`)
- **Avisos**:
  - para o avaliador fixo e para o colega escolhido, "Avalie {nome}";
  - para o Presidente, os pareceres esperando o ok e, quando ele for o fixo, as avaliações dele;
  - o mesmo total aparece no contador da navegação.
- **Meu processo**: linha do tempo com **5 marcos**: escolha do colega → avaliador fixo → colega escolhido → sua resposta ao Presidente → ok do Presidente.
  - No passo 1 aparece "Seu avaliador fixo: {nome}" e o seletor do colega.
  - Quem não está na tabela vê um estado vazio que explica a situação.
- **Painel do Presidente**:
  - tabela com avaliado, avaliador fixo, colega escolhido, etapa e média;
  - "Ver respostas" e "Dar ok";
  - colaboradores ativos fora da tabela aparecem marcados como "Sem avaliador fixo".
  - O botão de dispensar o RH sai.
- **Modal de avaliação**: as 5 perguntas com notas de 0 a 5 e o campo "Seu parecer", obrigatório para o fixo e para o colega escolhido.
- **Editor de perguntas**: não muda.

## O que muda no WIP (`ba4aff0`)
- **`backend/firestore.rules`**:
  - trocar os papéis `presidente`/`rh`/`par` por `fixo`/`escolhido`;
  - acrescentar `configuracoes/avaliadoresFixos`;
  - tirar `rhDispensado` e a dispensa do RH;
  - fazer `mediaConfere` usar 2 respostas;
  - tirar o RH da leitura de ciclos.
- **`frontend/js/avaliacao-calculo.js`**: atualizar `passosDoCiclo` (5 marcos), `avaliacoesConcluidas` e `calcularPendencias`, que passa a ver fixo, escolhido e o ok do Presidente.
- **`frontend/js/avaliacao-service.js`**:
  - `PAPEIS_AVALIADOR = ["fixo", "escolhido"]`;
  - novo `assinarAvaliadoresFixos`;
  - `escolherAvaliador` passa a gravar `avaliadorFixoUid`;
  - `assinarCiclosVisiveis` faz a consulta por `avaliadorFixoUid` e por `avaliadorEscolhidoUid`, ou todos os ciclos para o Presidente;
  - tirar `dispensarRH`.
- **`frontend/js/paginas/avaliacao.js`**: textos e etapas, mostrar o avaliador fixo, filtrar o seletor de colegas e as colunas novas no painel.
- **Testes**:
  - reescrever os testes das regras (hoje em `backend/tests/rules/firestore-rules.test.mjs`) para o novo esquema, cobrindo:
    - fixo errado na criação;
    - escolher o próprio avaliador fixo;
    - fixo = Presidente;
    - colega escolhido sem parecer (ou com menos de 20 caracteres) é recusado;
    - pessoa fora da tabela;
    - média com 2 respostas;
    - avaliador fixo e colega escolhido não leem a resposta ao Presidente;
  - ajustar `backend/tests/calculo/avaliacao.test.mjs`.
- **Novo** `backend/scripts/avaliadores-fixos.mjs`, com a tabela acima.

## Desempenho e responsividade
- Sem bibliotecas novas.
- Uma assinatura `onSnapshot` por bloco.
- As respostas só são buscadas quando a pessoa abre o painel.
- Animações só em `transform`/`opacity`.
- Skeleton durante o carregamento, para manter o CLS em 0.
- Contador da navegação carregado com `requestIdleCallback`.
- Layout mobile-first: linha do tempo vertical abaixo de 640 px, alvos de toque de 44 px e escala de 0 a 5 numa linha só.

## Verificação
1. `cd backend/tests/rules && npm test` no emulador, com o rascunho de testes já encaixado e os blocos antigos da conduta removidos.
2. `npm run test:calculo`.
3. `npm run build`.
4. `node backend/scripts/avaliadores-fixos.mjs --simular`, conferindo que os 11 nomes foram resolvidos para um uid.
5. Fluxo completo no emulador, em 360 px, 768 px e desktop:
   - o Presidente abre o ciclo;
   - a Natalia escolhe um colega;
   - o Eduardo (fixo) e o colega avaliam;
   - a Natalia envia o parecer;
   - o Presidente dá o ok.
   - Repetir com o Kleber, cujo fixo é o Erickson, que não é gestor.
6. `backend/tests/a11y/auditar.mjs`, trocando `/conduta` por `/avaliacao`.
7. Antes do merge: `firebase deploy --only firestore:rules`, depois o script `--aplicar` em produção.
