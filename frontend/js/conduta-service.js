// Shinatal — Avaliação de Conduta (entre colegas): feature social/anônima, totalmente separada
// da avaliação de desempenho formal (avaliacoes/{id}) — nunca afeta cota nem fundo. Presidente
// nunca participa (nem vota, nem é avaliado). Ver backend/firestore.rules para a real camada de
// autorização; este módulo só monta as chamadas ao Firestore no formato que as regras exigem.
import { db } from "./firebase-init.js";
import {
  doc, setDoc, deleteDoc, getDoc, onSnapshot, collection, query, where, runTransaction, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/** Grava/atualiza a entrada de alguém no diretório público (primeiro nome/cargo/role — o
 * diretório é legível por todo colaborador, por isso não guarda o nome completo).
 * Chamada tanto pelo próprio usuário (ao carregar a página) quanto por Admin/Presidente em nome
 * de qualquer colaborador (criar/editar/trocar papel) — a regra do Firestore valida os 3 campos
 * contra o usuarios/{uid} real, então não há como gravar um valor inventado. Nunca deve ser
 * chamada para o Presidente (não participa da função — a regra também bloqueia). */
async function sincronizarDiretorio({ uid, nome, cargo, role }) {
  if (role === "presidente") return;
  // Mesma derivação da regra (`nome.split(' ')[0]`). `cargo` só entra se existir no perfil: a
  // regra compara com o campo real, e perfil sem cargo tem de virar entrada sem cargo.
  const entrada = { primeiroNome: (nome || "").split(" ")[0], role };
  if (cargo !== undefined && cargo !== null) entrada.cargo = cargo;
  try {
    await setDoc(doc(db, "diretorioPublico", uid), entrada);
  } catch (erro) {
    console.error("[Shinatal] Falha ao sincronizar o diretório de colaboradores:", erro);
  }
}

/** Remove alguém do diretório público — chamado quando o colaborador é excluído do sistema. */
async function removerDoDiretorio(uid) {
  try {
    await deleteDoc(doc(db, "diretorioPublico", uid));
  } catch (erro) {
    console.error("[Shinatal] Falha ao remover do diretório de colaboradores:", erro);
  }
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

/** Assina o diretório público inteiro (primeiroNome/cargo/role de todo mundo, exceto Presidente) — usado
 * pelo lado do colaborador comum, que não pode ler usuarios/{uid} de outra pessoa. O painel de
 * gestão (dp/rh/admin/presidente) não precisa disto: já tem a lista completa via state.usuarios. */
function assinarDiretorio(cb) {
  return onSnapshot(collection(db, "diretorioPublico"), (snap) => {
    cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
  }, (erro) => {
    console.error("[Shinatal] Falha ao ler o diretório de colaboradores (as regras do Firestore foram publicadas?):", erro);
    cb([]);
  });
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
    const anterior = votoSnap.exists() ? votoSnap.data().conceito : null;
    if (anterior === conceito) return;

    // A contagem é ajustada com increment(), sem ser lida: o colaborador comum não tem (nem deve
    // ter) permissão de leitura sobre a contagem de um colega, e um tx.get() nela derrubava a
    // transação inteira com permission-denied. As firestore.rules conferem que o ajuste é
    // exatamente o que este voto mudou (contagemAcompanhaVoto) — +1 no conceito novo e, numa
    // troca, -1 no anterior.
    const delta = { excelente: 0, bom: 0, regular: 0, insatisfatorio: 0 };
    delta[conceito] += 1;
    if (anterior in delta) delta[anterior] -= 1;

    tx.set(votoRef, {
      avaliadorUid, avaliadoUid, conceito,
      // `??`: voto antigo sem criadoEm viraria `undefined`, que o Firestore recusa.
      criadoEm: (votoSnap.exists() ? votoSnap.data().criadoEm : null) ?? serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
    tx.set(contagemRef, {
      excelente: increment(delta.excelente), bom: increment(delta.bom),
      regular: increment(delta.regular), insatisfatorio: increment(delta.insatisfatorio),
      atualizadoEm: serverTimestamp()
    }, { merge: true });
  });
}

/** Busca a contagem anônima de um colaborador (usado ao abrir o perfil de alguém). */
async function buscarContagemConduta(uid) {
  const snap = await getDoc(doc(db, "condutaContagem", uid));
  return snap.exists() ? snap.data() : null;
}

export {
  sincronizarDiretorio, removerDoDiretorio,
  assinarFlagConduta, definirFlagConduta,
  assinarDiretorio, assinarMeusVotos,
  votarConduta, buscarContagemConduta
};
