// Shinatal — Avaliação de desempenho (Seção 11): acesso ao Firestore e as contas do processo.
//
// Fluxo (cada passo é validado de verdade em backend/firestore.rules):
//   1. O Presidente ou o Admin abre o ciclo do ano (configuracoes/avaliacaoDesempenho).
//   2. O colaborador escolhe um colega para avaliá-lo (cria ciclosAvaliacao/{ano}_{uid}); o
//      avaliador fixo vem da tabela oficial (configuracoes/avaliadoresFixos).
//   3. O avaliador fixo e o colega escolhido respondem 5 perguntas, notas de 0 a 5, mais um
//      parecer (respostasAvaliacao/{ano}_{uid}_{papel}), junto com a marcação em ciclo.concluidas.
//   4. Com as duas concluídas, o colaborador lê as avaliações e envia uma resposta que só o
//      Presidente lê (respostasAoPresidente/{ano}_{uid}).
//   5. O Presidente dá o "ok": média e conceito vão para o ciclo e para avaliacoes/{id}, que o
//      motor de cálculo (calculo-shinatal.js, TABELA_AVALIACAO) já transforma em percentual.
import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, onSnapshot,
  writeBatch, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  calcularMedia, conceitoPorMedia, formatarNota, avaliacoesConcluidas, passosDoCiclo,
  progressoDosPassos, calcularPendencias, NOTA_MAXIMA
} from "./avaliacao-calculo.js";

/** Textos provisórios até a definição das perguntas oficiais (editáveis por Presidente e Admin). */
const PERGUNTAS_PADRAO = [
  "Qualidade e cuidado na entrega do trabalho",
  "Pontualidade e cumprimento de prazos",
  "Trabalho em equipe e colaboração com os colegas",
  "Comunicação e postura profissional",
  "Iniciativa e comprometimento com a Shine Rio"
];

const PAPEIS_AVALIADOR = ["fixo", "escolhido"];
const ROTULOS_PAPEL_AVALIADOR = { fixo: "Avaliador fixo", escolhido: "Colega escolhido" };
const ROTULOS_CONCEITO = { excelente: "Excelente", bom: "Bom", regular: "Regular", insatisfatorio: "Insatisfatório" };
const PERCENTUAL_CONCEITO = { excelente: "+2%", bom: "0%", regular: "−5%", insatisfatorio: "−15%" };
const COMENTARIO_MINIMO = 20;

/* ------------------------------------------------------------------ */
/* Firestore                                                           */
/* ------------------------------------------------------------------ */

const refConfig = () => doc(db, "configuracoes", "avaliacaoDesempenho");
const idCiclo = (ano, uid) => `${ano}_${uid}`;
const refCiclo = (ano, uid) => doc(db, "ciclosAvaliacao", idCiclo(ano, uid));
const refResposta = (ano, uid, papel) => doc(db, "respostasAvaliacao", `${ano}_${uid}_${papel}`);
const refRespostaAoPresidente = (ano, uid) => doc(db, "respostasAoPresidente", idCiclo(ano, uid));
const comId = (snap) => ({ id: snap.id, ...snap.data() });

function avisarErro(contexto) {
  return (erro) => console.error(`[Shinatal] Falha ao ler ${contexto} (as regras do Firestore foram publicadas?):`, erro);
}

/** Configuração do processo; `null` quando nunca foi criada (processo fechado). */
function assinarConfig(cb) {
  return onSnapshot(refConfig(), (snap) => cb(snap.exists() ? snap.data() : null), (erro) => {
    avisarErro("a configuração da avaliação")(erro);
    cb(null);
  });
}

async function salvarConfig({ ativo, ano, perguntas }, uid) {
  await setDoc(refConfig(), { ativo, ano, perguntas, atualizadoPor: uid, atualizadoEm: serverTimestamp() });
}

/** Tabela oficial avaliado → avaliador fixo ({} quando ainda não foi gravada pelo script). */
function assinarAvaliadoresFixos(cb) {
  return onSnapshot(doc(db, "configuracoes", "avaliadoresFixos"), (snap) => cb(snap.exists() ? snap.data().pares || {} : {}), (erro) => {
    avisarErro("a tabela de avaliadores fixos")(erro);
    cb({});
  });
}

/** O próprio ciclo do ano (ou `null` enquanto o avaliador não foi escolhido). */
function assinarMeuCiclo(ano, uid, cb) {
  return onSnapshot(refCiclo(ano, uid), (snap) => cb(snap.exists() ? comId(snap) : null), (erro) => {
    avisarErro("o seu ciclo de avaliação")(erro);
    cb(null);
  });
}

/**
 * Presidente: todos os ciclos do ano. Demais: os ciclos em que são o avaliador fixo ou o colega
 * escolhido (duas consultas só de igualdade, sem índice composto, unidas aqui).
 */
function assinarCiclosVisiveis(ano, papel, uid, cb) {
  const ciclos = collection(db, "ciclosAvaliacao");
  const erro = (e) => { avisarErro("os ciclos de avaliação")(e); cb([]); };
  if (papel === "presidente") {
    return onSnapshot(query(ciclos, where("ano", "==", ano)), (snap) => cb(snap.docs.map(comId)), erro);
  }
  const partes = { fixo: null, escolhido: null };
  const emitir = () => {
    if (!partes.fixo || !partes.escolhido) return;
    const porId = new Map([...partes.fixo, ...partes.escolhido].map((c) => [c.id, c]));
    cb([...porId.values()]);
  };
  const cancelar = ["fixo", "escolhido"].map((parte) => onSnapshot(
    query(ciclos, where("ano", "==", ano), where(parte === "fixo" ? "avaliadorFixoUid" : "avaliadorEscolhidoUid", "==", uid)),
    (snap) => { partes[parte] = snap.docs.map(comId); emitir(); },
    erro
  ));
  return () => cancelar.forEach((c) => c());
}

/** Cria o ciclo (primeira escolha) ou troca o colega enquanto ele ainda não avaliou. */
async function escolherAvaliador({ ano, uid, avaliadorFixoUid, avaliadorEscolhidoUid, cicloExiste }) {
  if (cicloExiste) {
    await updateDoc(refCiclo(ano, uid), { avaliadorEscolhidoUid, atualizadoEm: serverTimestamp() });
    return;
  }
  await setDoc(refCiclo(ano, uid), {
    uid, ano, avaliadorFixoUid, avaliadorEscolhidoUid,
    concluidas: { fixo: false, escolhido: false },
    respostaEnviadaEm: null, okPresidenteEm: null, media: null, conceito: null,
    criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp()
  });
}

/** Resposta + marcação no ciclo numa única escrita em lote: a regra exige as duas juntas. */
async function enviarResposta({ ciclo, papel, avaliadorUid, perguntas, notas, comentario }) {
  const lote = writeBatch(db);
  lote.set(refResposta(ciclo.ano, ciclo.uid, papel), {
    ano: ciclo.ano, avaliadoUid: ciclo.uid, avaliadorUid, papel, perguntas, notas, comentario,
    criadoEm: serverTimestamp()
  });
  lote.update(refCiclo(ciclo.ano, ciclo.uid), { [`concluidas.${papel}`]: true, atualizadoEm: serverTimestamp() });
  await lote.commit();
}

/** As avaliações sobre um ciclo (Presidente, ou o próprio avaliado depois das duas). */
async function buscarRespostas(ciclo) {
  const snaps = await Promise.all(PAPEIS_AVALIADOR.map((p) => getDoc(refResposta(ciclo.ano, ciclo.uid, p))));
  return Object.fromEntries(PAPEIS_AVALIADOR.map((p, i) => [p, snaps[i].exists() ? snaps[i].data() : null]));
}

/** Respostas que a própria pessoa escreveu (para reabrir o que já enviou e para a LGPD). */
async function buscarMinhaResposta(ciclo, papel) {
  const snap = await getDoc(refResposta(ciclo.ano, ciclo.uid, papel));
  return snap.exists() ? snap.data() : null;
}

/** Resposta do avaliado ao Presidente + marca no ciclo, na mesma escrita (a regra amarra as duas). */
async function enviarRespostaAoPresidente(ciclo, texto) {
  const lote = writeBatch(db);
  lote.set(refRespostaAoPresidente(ciclo.ano, ciclo.uid), { uid: ciclo.uid, ano: ciclo.ano, texto, criadoEm: serverTimestamp() });
  lote.update(refCiclo(ciclo.ano, ciclo.uid), { respostaEnviadaEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
  await lote.commit();
}

/** A resposta ao Presidente (só o próprio avaliado e o Presidente conseguem ler). */
async function buscarRespostaAoPresidente(ciclo) {
  const snap = await getDoc(refRespostaAoPresidente(ciclo.ano, ciclo.uid));
  return snap.exists() ? snap.data() : null;
}

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "Ok" final do Presidente. Lê as respostas DENTRO da transação (nada de média vinda da tela),
 * grava média e conceito no ciclo e cria a avaliação que o motor de cálculo usa. O id da
 * avaliação é fixo por ano e pessoa, então um clique duplo não gera dois lançamentos.
 * @returns {Promise<{media:number, conceito:string}>}
 */
async function darOk(ciclo, presidente, alvoNome = null) {
  const resultado = await runTransaction(db, async (tx) => {
    const snaps = await Promise.all(PAPEIS_AVALIADOR.map((p) => tx.get(refResposta(ciclo.ano, ciclo.uid, p))));
    if (snaps.some((s) => !s.exists())) throw new Error("Avaliações incompletas.");
    const media = calcularMedia(snaps.map((s) => s.data()));
    const conceito = conceitoPorMedia(media);
    tx.update(refCiclo(ciclo.ano, ciclo.uid), {
      okPresidenteEm: serverTimestamp(), media, conceito, atualizadoEm: serverTimestamp()
    });
    tx.set(doc(db, "avaliacoes", `desempenho_${ciclo.ano}_${ciclo.uid}`), {
      uid: ciclo.uid, data: hojeISO(), ano: ciclo.ano, conceito,
      justificativa: `Média ${formatarNota(media)} na Avaliação de desempenho ${ciclo.ano}`,
      validadoRH: true, avaliadoPor: presidente.uid, criadoEm: serverTimestamp()
    });
    return { media, conceito };
  });
  try {
    await addDoc(collection(db, "logs"), {
      tipo: "avaliacao",
      descricao: `Avaliação de desempenho ${ciclo.ano} finalizada: média ${formatarNota(resultado.media)} (${ROTULOS_CONCEITO[resultado.conceito]})`,
      alvoUid: ciclo.uid, alvoNome,
      operadorUid: presidente.uid, operadorNome: presidente.nome || presidente.email,
      criadoEm: serverTimestamp()
    });
  } catch (erro) {
    console.error("[Shinatal] Falha ao registrar log:", erro);
  }
  return resultado;
}

/**
 * Pendências ao vivo de quem está logado (alimenta o contador da navegação e os avisos).
 * Segue o ano da configuração; sem configuração, o ano corrente.
 * @returns {() => void} cancela as assinaturas
 */
function assinarPendencias(papel, uid, cb) {
  let cancelarCiclos = () => {};
  let config = null;
  let anoAtual = null;
  let ultimosCiclos = null;
  // Avaliar só vale com o ciclo aberto (a regra recusa fora dele); o "ok" vale sempre.
  const emitir = () => {
    if (!ultimosCiclos) return;
    const aberto = !!config?.ativo && config.ano === anoAtual;
    cb(calcularPendencias(papel, uid, ultimosCiclos).filter((p) => p.tipo === "ok" || aberto), ultimosCiclos, config);
  };
  const cancelarConfig = assinarConfig((c) => {
    config = c;
    const ano = c?.ano ?? new Date().getFullYear();
    if (ano !== anoAtual) {
      anoAtual = ano;
      ultimosCiclos = null;
      cancelarCiclos();
      cancelarCiclos = assinarCiclosVisiveis(ano, papel, uid, (ciclos) => { ultimosCiclos = ciclos; emitir(); });
    }
    emitir();
  });
  return () => { cancelarConfig(); cancelarCiclos(); };
}

export {
  PERGUNTAS_PADRAO, PAPEIS_AVALIADOR, ROTULOS_PAPEL_AVALIADOR, ROTULOS_CONCEITO, PERCENTUAL_CONCEITO, COMENTARIO_MINIMO,
  calcularMedia, conceitoPorMedia, formatarNota, avaliacoesConcluidas, passosDoCiclo, progressoDosPassos, calcularPendencias, NOTA_MAXIMA,
  assinarConfig, salvarConfig, assinarAvaliadoresFixos, assinarMeuCiclo, assinarCiclosVisiveis, escolherAvaliador,
  enviarResposta, buscarRespostas, buscarMinhaResposta, enviarRespostaAoPresidente, buscarRespostaAoPresidente,
  darOk, assinarPendencias
};
