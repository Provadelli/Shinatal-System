// Shinatal — comportamentos de acessibilidade compartilhados por todas as páginas.
// Módulo autônomo (sem imports): incluído por <script type="module"> no <head> de cada página,
// roda depois do HTML pronto e não depende de login nem do Firebase.
//
// O que fica aqui é o que HTML/CSS sozinhos não resolvem:
//   1. modais — foco preso dentro, Esc fecha, foco volta para quem abriu (WCAG 2.1.2, 2.4.3);
//   2. "Pular para o conteúdo" — leva o FOCO ao <main>, não só a rolagem (2.4.1);
//   3. rótulo de arquivo operável por teclado (2.1.1);
//   4. pausa de movimento automático (2.2.2);
//   5. campos inválidos anunciados (3.3.1).
// Referências: WCAG 2.2 nível AA, ABNT NBR 17225:2025 e eMAG 3.1. Ver docs/ACESSIBILIDADE.md.

const FOCAVEIS = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])"
].join(",");

/** Elementos focáveis e realmente visíveis dentro de `raiz`, na ordem do DOM. */
function focaveisVisiveis(raiz) {
  return [...raiz.querySelectorAll(FOCAVEIS)].filter((el) => el.getClientRects().length > 0);
}

/**
 * Mantém o Tab circulando dentro de `raiz`. Devolve a função que desfaz a armadilha.
 * Exportada porque confirmarAcao() (ui-utils.js) cria o próprio diálogo fora do HTML da página.
 */
export function prenderFoco(raiz) {
  function aoTeclar(e) {
    if (e.key !== "Tab") return;
    const itens = focaveisVisiveis(raiz);
    if (!itens.length) { e.preventDefault(); return; }
    const primeiro = itens[0];
    const ultimo = itens[itens.length - 1];
    if (e.shiftKey && (document.activeElement === primeiro || !raiz.contains(document.activeElement))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (document.activeElement === ultimo || !raiz.contains(document.activeElement))) {
      e.preventDefault();
      primeiro.focus();
    }
  }
  raiz.addEventListener("keydown", aoTeclar);
  return () => raiz.removeEventListener("keydown", aoTeclar);
}

/* ------------------------------------------------------------------ */
/* 1. Modais                                                           */
/* ------------------------------------------------------------------ */
// As páginas abrem/fecham modais trocando as classes hidden/flex em vários pontos (gestao.js,
// contratos.js, dashboard.js). Em vez de alterar cada um, observamos a mudança de classe: o
// comportamento de teclado fica garantido para qualquer modal, presente ou futuro.

const estadoModal = new WeakMap(); // modal -> { soltar, origem }

function modalAberto(modal) {
  return !modal.classList.contains("hidden");
}

function aoAbrirModal(modal) {
  if (estadoModal.has(modal)) return;
  const origem = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  estadoModal.set(modal, { soltar: prenderFoco(modal), origem });
  // Foco inicial no primeiro campo do formulário, se houver; senão no próprio diálogo — começar
  // pelo botão "Fechar" faria o leitor de tela anunciar "Fechar" antes do título.
  const alvo = modal.querySelector("form input:not([type='hidden']):not([disabled]), form select:not([disabled]), form textarea:not([disabled])");
  const painel = modal.firstElementChild || modal;
  if (!painel.hasAttribute("tabindex")) painel.setAttribute("tabindex", "-1");
  // requestAnimationFrame: o modal acabou de sair de display:none; focar no mesmo tick falha.
  requestAnimationFrame(() => {
    // Área rolável só de texto (o regulamento, p.ex.): sem um ponto de foco dentro dela, quem
    // usa teclado não consegue rolar. Ganha tabindex só quando realmente transborda.
    modal.querySelectorAll(".overflow-y-auto").forEach((area) => {
      const rola = area.scrollHeight > area.clientHeight + 1;
      if (rola && !area.querySelector(FOCAVEIS)) area.setAttribute("tabindex", "0");
      else if (area.getAttribute("tabindex") === "0" && area.dataset.tabindexFixo === undefined) area.removeAttribute("tabindex");
    });
    if (alvo && alvo.getClientRects().length > 0) alvo.focus();
    else painel.focus();
  });
}

function aoFecharModal(modal) {
  const estado = estadoModal.get(modal);
  if (!estado) return;
  estado.soltar();
  estadoModal.delete(modal);
  // Devolve o foco a quem abriu — sem isso o foco cai no topo do documento e quem navega por
  // teclado perde o lugar na página.
  if (estado.origem && document.contains(estado.origem) && estado.origem.getClientRects().length > 0) {
    estado.origem.focus();
  }
}

function fecharModal(modal) {
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function iniciarModais() {
  const modais = [...document.querySelectorAll('[role="dialog"][id^="modal-"]')];
  if (!modais.length) return;

  const observador = new MutationObserver((mudancas) => {
    for (const m of mudancas) {
      if (modalAberto(m.target)) aoAbrirModal(m.target);
      else aoFecharModal(m.target);
    }
  });
  modais.forEach((modal) => {
    observador.observe(modal, { attributes: true, attributeFilter: ["class"] });
    if (modalAberto(modal)) aoAbrirModal(modal); // aberto por ?abrir=... antes deste módulo rodar
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Um diálogo de confirmação (confirmarAcao) empilhado por cima trata o próprio Esc.
    if (document.querySelector('[role="alertdialog"]')) return;
    const abertos = modais.filter(modalAberto);
    if (abertos.length) fecharModal(abertos[abertos.length - 1]);
  });
}

/* ------------------------------------------------------------------ */
/* 2. Pular para o conteúdo                                            */
/* ------------------------------------------------------------------ */
function iniciarPularConteudo() {
  const link = document.querySelector(".pular-conteudo");
  const principal = document.querySelector("main");
  if (!link || !principal) return;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    principal.focus({ preventScroll: true });
    principal.scrollIntoView({ block: "start" });
  });
}

/* ------------------------------------------------------------------ */
/* 3. <label for> de <input type="file"> escondido                     */
/* ------------------------------------------------------------------ */
// O input de foto é invisível (classe sr-only, não display:none — assim ele entra na ordem do
// Tab e Enter/Espaço abrem o seletor de arquivo) e quem aparece é o rótulo, o botãozinho redondo.
// Aqui só espelhamos o foco do input no rótulo, para o anel de foco aparecer onde o olho está.
function iniciarRotulosDeArquivo() {
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    const rotulo = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
    if (!rotulo) return;
    input.addEventListener("focus", () => rotulo.classList.toggle("foco-espelhado", input.matches(":focus-visible")));
    input.addEventListener("blur", () => rotulo.classList.remove("foco-espelhado"));
  });
}

/* ------------------------------------------------------------------ */
/* 4. Pausa de movimento                                               */
/* ------------------------------------------------------------------ */
// Vídeo de fundo e faixas em loop rodam indefinidamente; qualquer botão [data-pausar-movimento]
// os para e retoma. A escolha fica salva no navegador e vale para as próximas visitas.
const CHAVE_MOVIMENTO = "shinatal:movimento-pausado";

function movimentoPausado() {
  try { return localStorage.getItem(CHAVE_MOVIMENTO) === "1"; } catch { return false; }
}

function aplicarMovimento(pausado) {
  document.documentElement.classList.toggle("movimento-pausado", pausado);
  document.querySelectorAll("video[data-video-fundo]").forEach((video) => {
    if (pausado) video.pause();
    else if (video.dataset.autoplayPermitido === "1") video.play().catch(() => {});
  });
  document.querySelectorAll("[data-pausar-movimento]").forEach((botao) => {
    botao.setAttribute("aria-pressed", String(pausado));
    const icone = botao.querySelector(".material-symbols-outlined");
    const texto = botao.querySelector(".botao-movimento-texto");
    if (icone) icone.textContent = pausado ? "play_arrow" : "pause";
    if (texto) texto.textContent = pausado ? "Retomar animações" : "Pausar animações";
    botao.setAttribute("aria-label", pausado ? "Retomar animações da página" : "Pausar animações da página");
  });
}

function iniciarControleDeMovimento() {
  aplicarMovimento(movimentoPausado());
  document.querySelectorAll("[data-pausar-movimento]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const pausar = !document.documentElement.classList.contains("movimento-pausado");
      try { localStorage.setItem(CHAVE_MOVIMENTO, pausar ? "1" : "0"); } catch { /* modo privado */ }
      aplicarMovimento(pausar);
    });
  });
}

/* ------------------------------------------------------------------ */
/* 5. Campos inválidos                                                 */
/* ------------------------------------------------------------------ */
// Os formulários usam `novalidate` + toast para a mensagem. Ao enviar, marcamos com
// aria-invalid os campos que o próprio navegador considera inválidos (required, type, min...) e
// levamos o foco ao primeiro — assim o erro não é só uma mensagem que some em segundos.
function iniciarValidacaoAcessivel() {
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const campos = [...form.elements].filter((el) => el.willValidate && el.getClientRects().length > 0);
    campos.forEach((el) => {
      if (el.validity.valid) el.removeAttribute("aria-invalid");
      else el.setAttribute("aria-invalid", "true");
    });
    const primeiroInvalido = campos.find((el) => !el.validity.valid);
    if (primeiroInvalido) primeiroInvalido.focus();
  }, true); // captura: roda antes do handler da página, sem interferir nele

  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el instanceof HTMLElement && el.getAttribute("aria-invalid") === "true" && el.validity?.valid) {
      el.removeAttribute("aria-invalid");
    }
  });
}

/* ------------------------------------------------------------------ */

function iniciar() {
  iniciarModais();
  iniciarPularConteudo();
  iniciarRotulosDeArquivo();
  iniciarControleDeMovimento();
  iniciarValidacaoAcessivel();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
else iniciar();

export { movimentoPausado };
