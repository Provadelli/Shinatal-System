// Shinatal — página "Solicitações pendentes" (só o Presidente decide).
import { db } from "../firebase-init.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
  onSnapshot, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao } from "../auth.js";
import { escaparHTML, formatarDataHora, formatarMoeda, mostrarToast, debounce } from "../ui-utils.js";
import { calcularResumoContratoEmpresarial } from "../calculo-shinatal.js";
import { recalcularEPublicarFundo } from "../fundo-service.js";
import { registrarLog } from "../log-service.js";

const ROTULOS = {
  avaliacao: "Avaliação de desempenho",
  ativar_contrato: "Ativar contrato",
  encerrar_contrato: "Encerrar contrato",
  alterar_status_colaborador: "Alterar status do colaborador",
  contrato_empresarial_criar: "Novo contrato empresarial",
  contrato_empresarial_editar: "Alteração em contrato empresarial",
  contrato_empresarial_excluir: "Exclusão de contrato empresarial"
};
const ANO_EXERCICIO = new Date().getFullYear();

const perfil = await exigirAutenticacao(["presidente"]);
const lista = document.getElementById("lista-solicitacoes");
let contratosEmpresariais = [];

async function carregarContratos() {
  try {
    const snap = await getDocs(collection(db, "contratosEmpresariais"));
    contratosEmpresariais = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (erro) {
    console.error("[Shinatal] Falha ao carregar contratos:", erro);
  }
}
await carregarContratos();

/** Aplica de verdade uma solicitação aceita: despacha para a coleção certa conforme o tipo. */
async function aplicarSolicitacao(sol) {
  const d = sol.dadosAcao;
  if (sol.tipo === "avaliacao") await addDoc(collection(db, "avaliacoes"), d);
  else if (sol.tipo === "ativar_contrato") await addDoc(collection(db, "contratos"), d);
  else if (sol.tipo === "encerrar_contrato") await updateDoc(doc(db, "contratos", d.contratoId), d.campos);
  else if (sol.tipo === "alterar_status_colaborador") await updateDoc(doc(db, "usuarios", d.uid), d.campos);
  else if (sol.tipo === "contrato_empresarial_criar") await addDoc(collection(db, "contratosEmpresariais"), d);
  else if (sol.tipo === "contrato_empresarial_editar") await updateDoc(doc(db, "contratosEmpresariais", d.docId), d.campos);
  else if (sol.tipo === "contrato_empresarial_excluir") await deleteDoc(doc(db, "contratosEmpresariais", d.docId));
}

/** Resumo (contrato, ação, quadro antes/depois) para as solicitações de contrato empresarial. */
function detalhes(s) {
  const d = s.dadosAcao || {};
  let linhas = null;
  if (s.tipo === "contrato_empresarial_criar") {
    linhas = [
      ["Contrato", d.nomeEmpresa || s.alvoNome || "Sem nome"],
      ["Valor", d.valorContrato ? formatarMoeda(d.valorContrato) : "Não informado"],
      ["Quadro inicial", String(calcularResumoContratoEmpresarial(d).qtdAtual)]
    ];
  } else if (s.tipo === "contrato_empresarial_editar") {
    const atual = contratosEmpresariais.find((c) => c.id === d.docId);
    linhas = [["Contrato", s.alvoNome || atual?.nomeEmpresa || "Sem nome"]];
    if (atual) {
      const antes = calcularResumoContratoEmpresarial(atual).qtdAtual;
      const depois = calcularResumoContratoEmpresarial({ ...atual, ...(d.campos || {}) }).qtdAtual;
      linhas.push(depois !== antes ? ["Funcionários", `${antes} → ${depois}`] : ["Funcionários", String(depois)]);
    }
  } else if (s.tipo === "contrato_empresarial_excluir") {
    const atual = contratosEmpresariais.find((c) => c.id === d.docId);
    linhas = [["Contrato", s.alvoNome || atual?.nomeEmpresa || "Sem nome"]];
    if (atual) linhas.push(["Funcionários", String(calcularResumoContratoEmpresarial(atual).qtdAtual)]);
  }
  if (!linhas) return "";
  return `<dl class="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 text-label-sm">${linhas.map(([r, v]) =>
    `<div class="rounded-lg bg-surface-container-low px-3 py-2"><dt class="text-on-surface-variant">${escaparHTML(r)}</dt><dd class="font-semibold text-on-surface">${escaparHTML(v)}</dd></div>`).join("")}</dl>`;
}

const qPendentes = query(collection(db, "solicitacoes"), where("status", "==", "pendente"), orderBy("criadoEm", "desc"));
onSnapshot(qPendentes, debounce((snap) => {
  if (!snap.size) {
    lista.innerHTML = `<li class="estado-vazio"><span class="material-symbols-outlined" aria-hidden="true">inbox</span><p class="estado-vazio-titulo">Nenhuma solicitação pendente</p><p>Quando Admin, DP ou RH pedirem uma alteração, ela aparece aqui.</p></li>`;
    return;
  }
  lista.innerHTML = snap.docs.map((d) => {
    const s = d.data();
    return `
      <li class="flex-col">
        <div class="w-full flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="registro-titulo">${escaparHTML(ROTULOS[s.tipo] || s.tipo)}</p>
            <p class="registro-detalhe">${escaparHTML(s.descricao)}</p>
          </div>
          <span class="registro-data">${s.criadoEm ? formatarDataHora(s.criadoEm) : "agora"}</span>
        </div>
        <div class="w-full">${detalhes(s)}</div>
        <p class="registro-detalhe">Pedido por ${escaparHTML(s.solicitadoPorNome) || "gestão"}</p>
        <div class="w-full flex flex-col sm:flex-row gap-2 mt-1">
          <button type="button" data-aceitar="${d.id}" class="btn-contorno btn-contorno--verde btn-contorno--compacto sm:flex-1">Aceitar</button>
          <button type="button" data-rejeitar="${d.id}" class="btn-contorno btn-contorno--vinho btn-contorno--compacto sm:flex-1">Rejeitar</button>
        </div>
      </li>`;
  }).join("");
}, 150), (erro) => {
  console.error("[Shinatal] Falha ao carregar solicitações:", erro);
  mostrarToast("Não foi possível carregar as solicitações pendentes.", "erro");
});

lista.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-aceitar], [data-rejeitar]");
  if (!btn) return;
  const aceitar = btn.hasAttribute("data-aceitar");
  const id = btn.dataset.aceitar || btn.dataset.rejeitar;
  btn.disabled = true;
  try {
    const solSnap = await getDoc(doc(db, "solicitacoes", id));
    if (!solSnap.exists() || solSnap.data().status !== "pendente") {
      mostrarToast("Essa solicitação já foi resolvida.", "erro");
      return;
    }
    const sol = solSnap.data();
    const resolucao = { resolvidoPorUid: perfil.uid, resolvidoEm: serverTimestamp() };
    if (aceitar) {
      await aplicarSolicitacao(sol);
      await updateDoc(doc(db, "solicitacoes", id), { status: "aceita", ...resolucao });
      await registrarLog(perfil, sol.tipo, `Solicitação aceita: ${sol.descricao}`, sol.alvoUid, sol.alvoNome);
      // Mesma regra do painel de gestão: toda mudança aceita recalcula e publica o fundo.
      const usuarios = (await getDocs(collection(db, "usuarios"))).docs.map((d) => ({ uid: d.id, ...d.data() }));
      const resultado = await recalcularEPublicarFundo({ usuarios, anoExercicio: ANO_EXERCICIO, atualizadoPorUid: perfil.uid });
      contratosEmpresariais = resultado.contratosEmpresariais;
      mostrarToast("Solicitação aceita e aplicada.", "sucesso");
    } else {
      await updateDoc(doc(db, "solicitacoes", id), { status: "rejeitada", ...resolucao });
      mostrarToast("Solicitação rejeitada.", "sucesso");
    }
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível concluir. Tente novamente.", "erro");
    btn.disabled = false;
  }
});
