// Shinatal — sincronização imediata do Fundo Shinatal.
//
// O plano Spark não tem tarefas agendadas no servidor, então quem mantém `fundo/{ano}` certo são
// as sessões de gestão abertas (DP, RH, Admin, Presidente com vínculo ativo — os únicos que as
// regras deixam gravar o fundo). Em QUALQUER página, cada sessão dessas:
//   • assina os contratos empresariais ao vivo: contrato criado, editado, pausado, encerrado ou
//     excluído (nesta aba, em outra, por outra pessoa ou por solicitação aceita) → recalcula;
//   • confere ao abrir a página, ao voltar para a aba, a cada hora e na virada do dia — o saldo
//     depende do calendário (meses contados, entradas e saídas com data), então muda sem escrita.
// A gravação só acontece se o valor mudou (soSeMudou), então várias abas abertas não brigam: a
// primeira grava, as outras leem o mesmo valor e não fazem nada. Os painéis dos colaboradores
// assinam `fundo/{ano}` e mostram a cota nova no mesmo instante.
import { db } from "./firebase-init.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { recalcularEPublicarFundo } from "./fundo-service.js";

const PAPEIS_GESTORES = ["dp", "rh", "admin", "presidente"];
const UMA_HORA = 60 * 60 * 1000;

let rodando = false;
let pendente = false;
let ultimoDia = new Date().toDateString();

/** Uma conferência por vez; pedidos que chegam durante uma conferência viram UMA nova rodada. */
async function conferir(uid) {
  if (rodando) { pendente = true; return; }
  rodando = true;
  try {
    await recalcularEPublicarFundo({ anoExercicio: new Date().getFullYear(), atualizadoPorUid: uid, soSeMudou: true });
  } catch (erro) {
    console.error("[Shinatal] Falha ao sincronizar o fundo:", erro);
  } finally {
    rodando = false;
    if (pendente) { pendente = false; conferir(uid); }
  }
}

/**
 * @param {string} uid quem está logado
 * @param {string} papel papel efetivo (gestor sem vínculo ativo chega aqui como "colaborador")
 */
export function iniciarSincronizacaoFundo(uid, papel) {
  if (!PAPEIS_GESTORES.includes(papel)) return;

  let espera = null;
  const agendar = () => { clearTimeout(espera); espera = setTimeout(() => conferir(uid), 600); };

  // O primeiro disparo do onSnapshot já faz a conferência de abertura da página.
  onSnapshot(collection(db, "contratosEmpresariais"), agendar,
    (erro) => console.error("[Shinatal] Falha ao acompanhar os contratos:", erro));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") agendar();
  });
  setInterval(() => {
    const hoje = new Date().toDateString();
    if (hoje !== ultimoDia || document.visibilityState === "visible") { ultimoDia = hoje; agendar(); }
  }, UMA_HORA);
}
