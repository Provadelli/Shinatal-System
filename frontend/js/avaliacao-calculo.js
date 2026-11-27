// Shinatal — contas da Avaliação de desempenho, sem Firestore (testadas em
// backend/tests/calculo/avaliacao.test.mjs). A regra do Firestore refaz a média e a faixa do
// conceito no "ok" do Presidente (mediaConfere/conceitoDaMedia em backend/firestore.rules):
// qualquer mudança aqui precisa ser repetida lá.

/**
 * Média de todas as notas das avaliações recebidas, arredondada a 1 casa. Cada avaliação tem
 * 5 notas e pesa igual, então é o mesmo que a média das médias de cada avaliador.
 * @param {({notas:number[]}|null)[]} respostas
 * @returns {number|null}
 */
export function calcularMedia(respostas) {
  const notas = respostas.filter(Boolean).flatMap((r) => r.notas || []);
  if (!notas.length) return null;
  const soma = notas.reduce((total, n) => total + n, 0);
  return Math.round((soma * 10) / notas.length) / 10;
}

/** Faixas da média (0 a 10) para o conceito da Seção 11 (TABELA_AVALIACAO em calculo-shinatal.js). */
export function conceitoPorMedia(media) {
  if (media >= 9) return "excelente";
  if (media >= 7) return "bom";
  if (media >= 5) return "regular";
  return "insatisfatorio";
}

export function formatarNota(valor) {
  return valor === null || valor === undefined
    ? "—"
    : valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** As duas avaliações (fixo e colega escolhido) foram enviadas. */
export function avaliacoesConcluidas(ciclo) {
  const c = ciclo?.concluidas || {};
  return !!(c.fixo && c.escolhido);
}

/**
 * Os 5 marcos do processo do colaborador, na ordem da linha do tempo.
 * @returns {{chave:string, rotulo:string, feito:boolean}[]}
 */
export function passosDoCiclo(ciclo) {
  const c = ciclo?.concluidas || {};
  return [
    { chave: "escolha", rotulo: "Escolha do colega", feito: !!ciclo },
    { chave: "fixo", rotulo: "Avaliador fixo", feito: !!c.fixo },
    { chave: "escolhido", rotulo: "Colega escolhido", feito: !!c.escolhido },
    { chave: "resposta", rotulo: "Sua resposta ao Presidente", feito: !!ciclo?.respostaEnviadaEm },
    { chave: "ok", rotulo: "Ok do Presidente", feito: !!ciclo?.okPresidenteEm }
  ];
}

/**
 * Fração da linha do tempo preenchida (0 a 1): vai até o último marco de uma sequência
 * contínua de marcos concluídos. As duas avaliações podem chegar em qualquer ordem; um marco
 * concluído fora da sequência aparece marcado, mas a linha só avança quando a sequência fecha.
 */
export function progressoDosPassos(passos) {
  let contiguos = 0;
  while (contiguos < passos.length && passos[contiguos].feito) contiguos++;
  if (passos.length < 2 || contiguos === 0) return 0;
  return (contiguos - 1) / (passos.length - 1);
}

/**
 * O que cada pessoa precisa fazer agora, a partir dos ciclos que ela enxerga.
 * - Avaliador fixo ou colega escolhido: avaliar quem ainda não avaliou.
 * - Presidente: dar o ok depois que o avaliado enviou a resposta (e avaliar, quando é o fixo).
 * @param {string} papel papel efetivo de quem está logado
 * @param {string} uid
 * @param {object[]} ciclos
 * @returns {{tipo:"avaliar"|"ok", papel?:"fixo"|"escolhido", ciclo:object}[]}
 */
export function calcularPendencias(papel, uid, ciclos) {
  const pendencias = [];
  for (const ciclo of ciclos) {
    const c = ciclo.concluidas || {};
    if (ciclo.avaliadorFixoUid === uid && !c.fixo) pendencias.push({ tipo: "avaliar", papel: "fixo", ciclo });
    if (ciclo.avaliadorEscolhidoUid === uid && !c.escolhido) pendencias.push({ tipo: "avaliar", papel: "escolhido", ciclo });
    if (papel === "presidente" && ciclo.respostaEnviadaEm && !ciclo.okPresidenteEm) pendencias.push({ tipo: "ok", ciclo });
  }
  return pendencias;
}
