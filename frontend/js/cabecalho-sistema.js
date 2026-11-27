// Shinatal — monta o cabeçalho das páginas logadas (partial: scripts/partials/cabecalho-sistema.html).
// O HTML já traz todos os itens de todos os papéis; aqui removemos o que o papel de quem entrou
// não usa, preenchemos avatar/nome/papel, ligamos o "Sair" e o contador de solicitações.
// Chamado uma vez por exigirAutenticacao() (auth.js), em toda página logada.
import { db } from "./firebase-init.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { construirAvatarHTML, sincronizarAlturaHeader } from "./ui-utils.js";

export const ROTULOS_PAPEL = {
  admin: "Administrador",
  dp: "Departamento Pessoal",
  rh: "Recursos Humanos",
  presidente: "Presidente",
  colaborador: "Colaborador"
};

/**
 * @param {object} perfil perfil do usuário
 * @param {string} papel papel efetivo (gestor sem vínculo ativo entra como colaborador)
 * @param {string} painel URL do painel do papel
 * @param {() => void} sair função de logout
 */
export function montarCabecalho(perfil, papel, painel, sair) {
  document.querySelectorAll("[data-papeis]").forEach((el) => {
    if (!el.dataset.papeis.split(" ").includes(papel)) el.remove();
  });
  document.documentElement.dataset.papel = papel;

  document.querySelectorAll("[data-logo-painel]").forEach((a) => { a.href = painel; });
  const subtitulo = papel === "colaborador" ? "Meu painel" : "Gestão";
  document.querySelectorAll("[data-subtitulo-painel]").forEach((el) => { el.textContent = subtitulo; });
  document.querySelectorAll("[data-papel-rotulo]").forEach((el) => { el.textContent = ROTULOS_PAPEL[papel] || papel; });

  const primeiroNome = (perfil.nome || perfil.email || "").split(" ")[0] || "Perfil";
  document.querySelectorAll("[data-nome]").forEach((el) => { el.textContent = primeiroNome; });
  document.querySelectorAll("[data-avatar]").forEach((el) => {
    el.innerHTML = construirAvatarHTML(perfil);
    const img = el.querySelector("img");
    if (img) img.alt = "";
  });

  document.querySelectorAll("[data-sair]").forEach((b) => b.addEventListener("click", sair));

  if (papel === "presidente") {
    const q = query(collection(db, "solicitacoes"), where("status", "==", "pendente"));
    onSnapshot(q, (snap) => {
      document.querySelectorAll("[data-contador-solicitacoes]").forEach((b) => {
        b.textContent = String(snap.size);
        b.hidden = snap.size === 0;
      });
    }, () => {});
  }

  agendarContadorAvaliacao(perfil.uid, papel);

  sincronizarAlturaHeader();
  document.dispatchEvent(new CustomEvent("shinatal:pronto"));
}

/**
 * Contador do item "Avaliação" na navegação: quantas avaliações a pessoa tem para fazer (e, para o
 * Presidente, quantos pareceres esperam o ok). Carregado só quando o navegador fica ocioso, para
 * não disputar a primeira pintura de nenhuma página.
 */
function agendarContadorAvaliacao(uid, papel) {
  if (!document.querySelector("[data-contador-avaliacao]")) return;
  const iniciar = () => import("./avaliacao-service.js").then(({ assinarPendencias }) => {
    assinarPendencias(papel, uid, (pendencias) => {
      document.querySelectorAll("[data-contador-avaliacao]").forEach((b) => {
        b.textContent = String(pendencias.length);
        b.hidden = pendencias.length === 0;
      });
    });
  }).catch((erro) => console.error("[Shinatal] Falha ao carregar as pendências de avaliação:", erro));
  if ("requestIdleCallback" in window) requestIdleCallback(iniciar, { timeout: 3000 });
  else setTimeout(iniciar, 1200);
}
