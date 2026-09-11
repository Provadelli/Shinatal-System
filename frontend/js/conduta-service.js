// Shinatal — Avaliação de Conduta (entre colegas): feature social/anônima, totalmente separada
// da avaliação de desempenho formal (avaliacoes/{id}) — nunca afeta cota nem fundo. Presidente
// nunca participa (nem vota, nem é avaliado). Ver backend/firestore.rules para a real camada de
// autorização; este módulo só monta as chamadas ao Firestore no formato que as regras exigem.
import { db } from "./firebase-init.js";
import {
  doc, setDoc, getDoc, onSnapshot, collection, query, where, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/** "Online" = presença (diretorioPublico/{uid}.ultimoAcesso) registrada nos últimos 5 minutos. */
const LIMIAR_ONLINE_MS = 5 * 60 * 1000;
/** Intervalo do heartbeat — bem abaixo do limiar acima, pra dar margem de rede/latência. */
const INTERVALO_HEARTBEAT_MS = 90 * 1000;

let intervaloHeartbeat = null;

/** Grava presença (nome/cargo/role/ultimoAcesso) e mantém viva enquanto a página estiver aberta.
 * Nunca deve ser chamado para o Presidente (não participa da função — a regra também bloqueia). */
function iniciarHeartbeat(perfil) {
  if (perfil.role === "presidente" || intervaloHeartbeat) return;
  const gravar = () => setDoc(doc(db, "diretorioPublico", perfil.uid), {
    nome: perfil.nome || "", cargo: perfil.cargo || "", role: perfil.role, ultimoAcesso: serverTimestamp()
  }).catch((erro) => console.error("[Shinatal] Falha no heartbeat de presença:", erro));
  gravar();
  intervaloHeartbeat = setInterval(gravar, INTERVALO_HEARTBEAT_MS);
}

function pararHeartbeat() {
  if (intervaloHeartbeat) clearInterval(intervaloHeartbeat);
  intervaloHeartbeat = null;
}

/** Assina o estado do interruptor global (configuracoes/avaliacaoConduta.ativo). Sem callback de
 * erro, um onSnapshot que falha (ex.: regras do Firestore desatualizadas em produção) nunca mais
 * chama `cb` — a UI ficaria travada em "Carregando..." pra sempre, sem nenhum aviso. */
function assinarFlagConduta(cb) {
  return onSnapshot(doc(db, "configuracoes", "avaliacaoConduta"), (snap) => {
    cb(snap.exists() ? !!snap.data().ativo : false);
  }, (erro) => {
    console.error("[Shinatal] Falha ao ler o estado da Avaliação de Conduta (as regras do Firestore foram publicadas?):", erro);
    cb(false);
  });
}

/** Liga/desliga a função para todo mundo — só Admin/Presidente (garantido pelas regras). */
async function definirFlagConduta(ativo, uid) {
  await setDoc(doc(db, "configuracoes", "avaliacaoConduta"), {
    ativo, atualizadoPor: uid, atualizadoEm: serverTimestamp()
  });
}

/** Assina o diretório inteiro de presença; o filtro de "quem está online agora" (janela de
 * tempo) é responsabilidade de quem consome, já que precisa ser reavaliado periodicamente, não
 * só quando chega um novo evento do Firestore. */
function assinarDiretorioOnline(cb) {
  return onSnapshot(collection(db, "diretorioPublico"), (snap) => {
    cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
  }, (erro) => {
    console.error("[Shinatal] Falha ao ler o diretório de presença (as regras do Firestore foram publicadas?):", erro);
    cb([]);
  });
}

/** Verdadeiro se `ultimoAcesso` (Timestamp do Firestore) está dentro do limiar de "online". */
function estaOnline(ultimoAcesso) {
  if (!ultimoAcesso?.toDate) return false;
  return Date.now() - ultimoAcesso.toDate().getTime() <= LIMIAR_ONLINE_MS;
}

/** Assina os próprios votos já dados pelo usuário logado (pra pré-selecionar o conceito atual
 * de cada colega na lista, sem expor o voto de ninguém — a regra só permite ler os próprios).
 * Precisa do `where("avaliadorUid", "==", ...)`: a regra de leitura de votosConduta é baseada em
 * resource.data (não no id do documento), e o Firestore só autoriza uma consulta em coleção
 * inteira quando o próprio filtro da query já prova que nenhum resultado foge da regra. */
function assinarMeusVotos(avaliadorUid, cb) {
  const q = query(collection(db, "votosConduta"), where("avaliadorUid", "==", avaliadorUid));
  return onSnapshot(q, (snap) => {
    const porAlvo = {};
    snap.docs.forEach((d) => { porAlvo[d.data().avaliadoUid] = d.data().conceito; });
    cb(porAlvo);
  }, (erro) => {
    console.error("[Shinatal] Falha ao ler os próprios votos de conduta (as regras do Firestore foram publicadas?):", erro);
    cb({});
  });
}

/** Registra/edita o voto de conduta (1 por par avaliador→avaliado, editável) e atualiza a
 * contagem agregada anônima na mesma transação — sem Cloud Functions, é o único jeito de manter
 * as duas escritas consistentes a partir do cliente. */
async function votarConduta({ avaliadorUid, avaliadoUid, conceito }) {
  const votoRef = doc(db, "votosConduta", `${avaliadorUid}_${avaliadoUid}`);
  const contagemRef = doc(db, "condutaContagem", avaliadoUid);
  await runTransaction(db, async (tx) => {
    const votoSnap = await tx.get(votoRef);
    const contagemSnap = await tx.get(contagemRef);
    const anterior = votoSnap.exists() ? votoSnap.data().conceito : null;
    if (anterior === conceito) return;

    const c = contagemSnap.exists()
      ? contagemSnap.data()
      : { excelente: 0, bom: 0, regular: 0, insatisfatorio: 0 };
    if (anterior) c[anterior] = Math.max(0, (c[anterior] || 0) - 1);
    c[conceito] = (c[conceito] || 0) + 1;

    tx.set(votoRef, {
      avaliadorUid, avaliadoUid, conceito,
      criadoEm: votoSnap.exists() ? votoSnap.data().criadoEm : serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
    tx.set(contagemRef, {
      excelente: c.excelente || 0, bom: c.bom || 0, regular: c.regular || 0, insatisfatorio: c.insatisfatorio || 0,
      atualizadoEm: serverTimestamp()
    });
  });
}

/** Busca a contagem anônima de um colaborador (usado ao abrir o perfil de alguém). */
async function buscarContagemConduta(uid) {
  const snap = await getDoc(doc(db, "condutaContagem", uid));
  return snap.exists() ? snap.data() : null;
}

export {
  LIMIAR_ONLINE_MS, INTERVALO_HEARTBEAT_MS,
  iniciarHeartbeat, pararHeartbeat, estaOnline,
  assinarFlagConduta, definirFlagConduta,
  assinarDiretorioOnline, assinarMeusVotos,
  votarConduta, buscarContagemConduta
};
