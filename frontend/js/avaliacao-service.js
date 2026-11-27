// Shinatal — Avaliação de desempenho (Seção 11): acesso ao Firestore e as contas do processo.
//
// Fluxo (cada passo é validado de verdade em backend/firestore.rules):
//   1. O Presidente abre o ciclo do ano (configuracoes/avaliacaoDesempenho).
//   2. O colaborador escolhe um colega para avaliá-lo (cria ciclosAvaliacao/{ano}_{uid}).
//   3. Presidente, RH e o colega respondem 5 perguntas, notas de 0 a 10
//      (respostasAvaliacao/{ano}_{uid}_{papel}), junto com a marcação em ciclo.concluidas.
//   4. Com as três concluídas, o colaborador lê as respostas e envia o parecer.
//   5. O Presidente dá o "ok": média e conceito vão para o ciclo e para avaliacoes/{id}, que o
//      motor de cálculo (calculo-shinatal.js, TABELA_AVALIACAO) já transforma em percentual.
import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, onSnapshot,
  writeBatch, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  calcularMedia, conceitoPorMedia, formatarNota, avaliacoesConcluidas, passosDoCiclo,
  progressoDosPassos, calcularPendencias
} from "./avaliacao-calculo.js";

/** Textos provisórios até a definição das perguntas oficiais (editáveis por Presidente e Admin). */
const PERGUNTAS_PADRAO = [
  "Qualidade e cuidado na entrega do trabalho",
  "Pontualidade e cumprimento de prazos",
  "Trabalho em equipe e colaboração com os colegas",
  "Comunicação e postura profissional",
  "Iniciativa e comprometimento com a Shine Rio"
];

const PAPEIS_AVALIADOR = ["presidente", "rh", "par"];
const ROTULOS_PAPEL_AVALIADOR = { presidente: "Presidente", rh: "RH", par: "Colega escolhido" };
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

/** O próprio ciclo do ano (ou `null` enquanto o avaliador não foi escolhido). */
function assinarMeuCiclo(ano, uid, cb) {
  return onSnapshot(refCiclo(ano, uid), (snap) => cb(snap.exists() ? comId(snap) : null), (erro) => {
    avisarErro("o seu ciclo de avaliação")(erro);
    cb(null);
  });
}

/** Presidente e RH: todos os ciclos do ano. Demais: só os ciclos em que foram escolhidos. */
function assinarCiclosVisiveis(ano, papel, uid, cb) {
  const ciclos = collection(db, "ciclosAvaliacao");
  const q = papel === "presidente" || papel === "rh"
    ? query(ciclos, where("ano", "==", ano))
    : query(ciclos, where("ano", "==", ano), where("avaliadorUid", "==", uid));
  return onSnapshot(q, (snap) => cb(snap.docs.map(comId)), (erro) => {
    avisarErro("os ciclos de avaliação")(erro);
    cb([]);
  });
}

/** Cria o ciclo (primeira escolha) ou troca o colega enquanto ele ainda não avaliou. */
async function escolherAvaliador({ ano, uid, avaliadorUid, cicloExiste }) {
  if (cicloExiste) {
    await updateDoc(refCiclo(ano, uid), { avaliadorUid, atualizadoEm: serverTimestamp() });
    return;
  }
  await setDoc(refCiclo(ano, uid), {
    uid, ano, avaliadorUid,
    concluidas: { presidente: false, rh: false, par: false },
    rhDispensado: false,
    parecer: null, parecerEm: null, okPresidenteEm: null, media: null, conceito: null,
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

/** As respostas sobre um ciclo concluído (Presidente, ou o próprio avaliado depois das três). */
async function buscarRespostas(ciclo) {
  const papeis = PAPEIS_AVALIADOR.filter((p) => !(p === "rh" && ciclo.rhDispensado));
  const snaps = await Promise.all(papeis.map((p) => getDoc(refResposta(ciclo.ano, ciclo.uid, p))));
  return Object.fromEntries(papeis.map((p, i) => [p, snaps[i].exists() ? snaps[i].data() : null]));
}

/** Respostas que a própria pessoa escreveu (para reabrir o que já enviou e para a LGPD). */
async function buscarMinhaResposta(ciclo, papel) {
  const snap = await getDoc(refResposta(ciclo.ano, ciclo.uid, papel));
  return snap.exists() ? snap.data() : null;
}

async function enviarParecer(ciclo, parecer) {
  await updateDoc(refCiclo(ciclo.ano, ciclo.uid), { parecer, parecerEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
}

async function dispensarRH(ciclo) {
  await updateDoc(refCiclo(ciclo.ano, ciclo.uid), { rhDispensado: true, atualizadoEm: serverTimestamp() });
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
  const papeis = PAPEIS_AVALIADOR.filter((p) => !(p === "rh" && ciclo.rhDispensado));
  const resultado = await runTransaction(db, async (tx) => {
    const snaps = await Promise.all(papeis.map((p) => tx.get(refResposta(ciclo.ano, ciclo.uid, p))));
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
  calcularMedia, conceitoPorMedia, formatarNota, avaliacoesConcluidas, passosDoCiclo, progressoDosPassos, calcularPendencias,
  assinarConfig, salvarConfig, assinarMeuCiclo, assinarCiclosVisiveis, escolherAvaliador, enviarResposta,
  buscarRespostas, buscarMinhaResposta, enviarParecer, dispensarRH, darOk, assinarPendencias
};
