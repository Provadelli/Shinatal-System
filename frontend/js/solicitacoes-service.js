// Shinatal — fila de aprovação do Presidente (contratos + avaliações). Qualquer gestor
// (DP/RH/Admin) que não seja Presidente passa por aqui em vez de gravar direto; o Presidente
// aceita/rejeita na aba "Solicitações" (lógica de aplicar cada tipo fica em gestao.js, que é
// onde essa tela vive).
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/**
 * @param {import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js").Firestore} db
 * @param {{tipo:string, descricao:string, alvoUid?:string|null, alvoNome?:string|null,
 *   dadosAcao:object, operador:{uid:string, nome?:string, email?:string}}} params
 */
async function criarSolicitacao(db, { tipo, descricao, alvoUid = null, alvoNome = null, dadosAcao, operador }) {
  await addDoc(collection(db, "solicitacoes"), {
    tipo, descricao, alvoUid, alvoNome, dadosAcao,
    status: "pendente",
    solicitadoPorUid: operador.uid,
    solicitadoPorNome: operador.nome || operador.email,
    criadoEm: serverTimestamp()
  });
}

export { criarSolicitacao };
