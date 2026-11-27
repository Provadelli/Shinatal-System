// Shinatal — diretório público de colegas (diretorioPublico/{uid}): primeiro nome, cargo e papel
// de cada pessoa, legível por qualquer colaborador. Serve para o colaborador comum escolher quem
// vai avaliá-lo na Avaliação de desempenho sem precisar ler usuarios/{uid} de terceiros.
// O Presidente não entra no diretório. Ver backend/firestore.rules para a validação real.
import { db } from "./firebase-init.js";
import { doc, setDoc, deleteDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/** Grava/atualiza a entrada de alguém no diretório público (primeiro nome/cargo/role — o
 * diretório é legível por todo colaborador, por isso não guarda o nome completo).
 * Chamada tanto pelo próprio usuário (ao carregar a página) quanto por Admin/Presidente em nome
 * de qualquer colaborador (criar/editar/trocar papel) — a regra do Firestore valida os 3 campos
 * contra o usuarios/{uid} real, então não há como gravar um valor inventado. Nunca deve ser
 * chamada para o Presidente (a regra também bloqueia). */
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

/** Assina o diretório inteiro. Sem callback de erro, um onSnapshot que falha nunca mais chama
 * `cb` e a tela ficaria presa em "Carregando...". */
function assinarDiretorio(cb) {
  return onSnapshot(collection(db, "diretorioPublico"), (snap) => {
    cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
  }, (erro) => {
    console.error("[Shinatal] Falha ao ler o diretório de colaboradores:", erro);
    cb([]);
  });
}

export { sincronizarDiretorio, removerDoDiretorio, assinarDiretorio };
