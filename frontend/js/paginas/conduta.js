// Shinatal — página "Avaliação de conduta" (todos os papéis).
// Avaliação anônima entre colegas: puramente social, não entra na cota nem no fundo.
// Admin e Presidente ligam/desligam a função para todos; o Presidente não vota nem é avaliado.
import { db } from "../firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao } from "../auth.js";
import { escaparHTML, mostrarToast, debounce } from "../ui-utils.js";
import { ROTULOS_CONCEITO } from "../perfil-view.js";
import {
  sincronizarDiretorio, assinarFlagConduta, definirFlagConduta, assinarDiretorio, assinarMeusVotos, votarConduta
} from "../conduta-service.js";

const perfil = await exigirAutenticacao(null);
const papel = document.documentElement.dataset.papel || perfil.role;
const EH_PRESIDENTE = papel === "presidente";
const PODE_ALTERNAR = papel === "admin" || papel === "presidente";

const container = document.getElementById("conteudo-conduta");
const areaToggle = document.getElementById("conduta-toggle-area");
const busca = document.getElementById("busca-conduta");

let ativa = false;
let colegas = [];
let meusVotos = {};

sincronizarDiretorio(perfil);

/** Colaborador lê o diretório público; gestores leem a lista completa (já têm permissão). */
if (papel === "colaborador") {
  assinarDiretorio((lista) => { colegas = lista; render(); });
} else {
  try {
    const snap = await getDocs(collection(db, "usuarios"));
    colegas = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  } catch (erro) {
    console.error("[Shinatal] Falha ao carregar colaboradores:", erro);
  }
}
assinarFlagConduta((valor) => { ativa = valor; renderToggle(); render(); });
assinarMeusVotos(perfil.uid, (votos) => { meusVotos = votos; render(); });
busca.addEventListener("input", debounce(render, 120));

function vazio(icone, titulo, texto = "") {
  return `<li class="estado-vazio"><span class="material-symbols-outlined" aria-hidden="true">${icone}</span><p class="estado-vazio-titulo">${titulo}</p>${texto ? `<p>${texto}</p>` : ""}</li>`;
}

function renderToggle() {
  if (!PODE_ALTERNAR) return;
  areaToggle.hidden = false;
  areaToggle.innerHTML = `
    <div class="cartao cartao-corpo flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <p class="registro-titulo flex items-center gap-2"><span class="badge ${ativa ? "badge-sucesso" : "badge-neutro"}">${ativa ? "Ativada" : "Desativada"}</span>Avaliação de conduta</p>
        <p class="registro-detalhe">Só Admin e Presidente podem ${ativa ? "desativar" : "ativar"} esta função para todo mundo.</p>
      </div>
      <button type="button" id="btn-toggle-conduta" class="btn-contorno ${ativa ? "btn-contorno--vinho" : "btn-contorno--verde"} btn-contorno--compacto">${ativa ? "Desativar" : "Ativar"}</button>
    </div>`;
  document.getElementById("btn-toggle-conduta").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try { await definirFlagConduta(!ativa, perfil.uid); } catch (erro) {
      console.error(erro);
      mostrarToast("Não foi possível atualizar a configuração.", "erro");
      e.currentTarget.disabled = false;
    }
  });
}

function render() {
  if (!ativa) {
    container.innerHTML = PODE_ALTERNAR
      ? vazio("toggle_off", "Avaliação desativada", "Ative acima para liberar a avaliação aos colaboradores.")
      : vazio("hourglass_empty", "Ainda não disponível", "A avaliação de conduta será liberada pela gestão.");
    return;
  }
  if (EH_PRESIDENTE) {
    container.innerHTML = vazio("info", "Você não participa", "Como Presidente, você não vota e não pode ser avaliado.");
    return;
  }
  const termo = busca.value.trim().toLowerCase();
  const nomeDe = (u) => (papel === "colaborador" ? u.primeiroNome || (u.nome || "").split(" ")[0] : u.nome) || "";
  const lista = colegas
    .filter((u) => u.uid !== perfil.uid && u.role !== "presidente")
    .filter((u) => !termo || `${nomeDe(u)} ${u.cargo || ""}`.toLowerCase().includes(termo))
    .sort((a, b) => nomeDe(a).localeCompare(nomeDe(b)));
  if (!lista.length) {
    container.innerHTML = vazio("group_off", termo ? "Nenhum colega encontrado" : "Nenhum colega disponível para avaliação");
    return;
  }
  container.innerHTML = lista.map((u) => {
    const nome = escaparHTML(nomeDe(u)) || "Colega";
    return `
      <li class="flex-col sm:flex-row sm:items-center">
        <div class="flex items-center gap-3 min-w-0">
          <span class="avatar w-10 h-10 text-sm" aria-hidden="true">${escaparHTML(nomeDe(u).slice(0, 1).toUpperCase() || "?")}</span>
          <div class="min-w-0">
            <p class="registro-titulo truncate">${nome}</p>
            <p class="registro-detalhe truncate">${escaparHTML(u.cargo) || "Sem cargo"}</p>
          </div>
        </div>
        <select data-votar-conduta="${escaparHTML(u.uid)}" aria-label="Avaliar ${nome}" class="input-shinatal !pl-3 !py-2 w-full sm:w-48">
          <option value="">Avaliar...</option>
          ${["excelente", "bom", "regular", "insatisfatorio"].map((c) =>
            `<option value="${c}" ${meusVotos[u.uid] === c ? "selected" : ""}>${ROTULOS_CONCEITO[c]}</option>`).join("")}
        </select>
      </li>`;
  }).join("");
}

container.addEventListener("change", async (e) => {
  const select = e.target.closest("[data-votar-conduta]");
  if (!select || !select.value) return;
  select.disabled = true;
  try {
    await votarConduta({ avaliadorUid: perfil.uid, avaliadoUid: select.dataset.votarConduta, conceito: select.value });
    mostrarToast("Avaliação registrada.", "sucesso");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível registrar sua avaliação.", "erro");
  } finally {
    select.disabled = false;
  }
});

render();
