// Shinatal — script da página index.html (antes inline; extraído para a CSP poder proibir
// script inline — ver firebase.json).
import { db } from "./firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { formatarMoeda, animarNumero, ativarRevelacaoAoRolar, ativarCarrosselEtapas, pausarAnimacaoForaDaTela, sincronizarAlturaHeader } from "./ui-utils.js";
import { movimentoPausado } from "./acessibilidade.js";

ativarRevelacaoAoRolar();
ativarCarrosselEtapas();
pausarAnimacaoForaDaTela(".barra-shinatal-pista, .faixa-fotos-pista, .faixa-valores-pista");
sincronizarAlturaHeader();

// ---------------------------------------------------------------
// Header transparente sobre o vídeo do hero, vira sólido ao rolar.
// Reaproveita o mesmo padrão de IntersectionObserver de ativarRevelacaoAoRolar()
// em vez de um scroll listener cru.
// ---------------------------------------------------------------
const sentinelaHeader = document.getElementById("sentinela-header-scroll");
if (sentinelaHeader && "IntersectionObserver" in window) {
  // Sem rootMargin: o sentinela (1px, topo do documento) só está "intersectando" a viewport
  // enquanto scrollY é ~0 — sai assim que o usuário rola, mesmo que o header fixo já estivesse
  // cobrindo aquele ponto visualmente (o observer não sabe de z-index, só de geometria).
  const observadorHeader = new IntersectionObserver(([entrada]) => {
    document.querySelectorAll(".header-flutuante").forEach((el) =>
      el.classList.toggle("header-transparente", entrada.isIntersecting)
    );
  }, { threshold: 0 });
  observadorHeader.observe(sentinelaHeader);
} else if (sentinelaHeader) {
  document.querySelectorAll(".header-flutuante").forEach((el) => el.classList.remove("header-transparente"));
}

// ---------------------------------------------------------------
// Faixa "Shinatal" grudada no topo de #sobre-nos — visível enquanto a seção sobe
// sobre o hero sticky, some quando o topo dela encontra o header. rootMargin
// "-100% no fundo" colapsa a área observada numa linha no topo da viewport, então
// isIntersecting vira false exatamente quando a seção termina de cobrir o hero
// (diferente do sentinela do header acima, que dispara quase no primeiro pixel).
// ---------------------------------------------------------------
const sentinelaFaixa = document.getElementById("sentinela-faixa-shinatal");
const faixaSecao = document.querySelector(".barra-shinatal-secao");
if (sentinelaFaixa && faixaSecao && "IntersectionObserver" in window) {
  const observadorFaixa = new IntersectionObserver(([entrada]) => {
    faixaSecao.classList.toggle("faixa-oculta", !entrada.isIntersecting);
  }, { rootMargin: "0px 0px -100% 0px", threshold: 0 });
  observadorFaixa.observe(sentinelaFaixa);
}

// ---------------------------------------------------------------
// Vídeo do hero — autoplay para todo o público, exceto quem pede menos movimento
// (prefers-reduced-motion) ou está com Data Saver ligado (connection.saveData) —
// ambos sinais explícitos do usuário, não uma suposição de "dispositivo fraco".
// Sem autoplay no HTML: sem esses sinais, o elemento fica só no poster, nunca
// baixa o mp4.
// ---------------------------------------------------------------
const videoHero = document.getElementById("video-hero");
if (videoHero) {
  const prefereReduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection?.saveData;
  const podeAutoplay = !prefereReduzido && !saveData;

  if (podeAutoplay) {
    // Lido por js/acessibilidade.js: o botão "Pausar animações" só retoma o vídeo se o autoplay
    // era permitido para este visitante.
    videoHero.dataset.autoplayPermitido = "1";
    videoHero.preload = "auto";
    if (!movimentoPausado()) videoHero.play().catch(() => {});
  }
  document.addEventListener("visibilitychange", () => {
    if (!podeAutoplay) return;
    if (document.hidden || movimentoPausado()) videoHero.pause();
    else videoHero.play().catch(() => {});
  });
}

// Spotlight que acompanha o cursor no card do fundo (só em dispositivos com mouse).
// Atualização agrupada por requestAnimationFrame — no máximo uma escrita de estilo (e
// repaint do ::after) por quadro, em vez de uma a cada mousemove bruto (que dispara com
// frequência bem maior que a taxa de atualização da tela em mouses de alto polling).
const cardFundo = document.getElementById("card-fundo");
if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  let spotlightX = 0, spotlightY = 0, spotlightAgendado = false;
  function aplicarSpotlight() {
    spotlightAgendado = false;
    const rect = cardFundo.getBoundingClientRect();
    cardFundo.style.setProperty("--mx", `${spotlightX - rect.left}px`);
    cardFundo.style.setProperty("--my", `${spotlightY - rect.top}px`);
  }
  cardFundo.addEventListener("mousemove", (e) => {
    spotlightX = e.clientX;
    spotlightY = e.clientY;
    if (!spotlightAgendado) {
      spotlightAgendado = true;
      requestAnimationFrame(aplicarSpotlight);
    }
  });
}

// Logo gigante do footer: um foco de luz acompanha o cursor por dentro da logo e o bloco
// inclina de leve na direção dele. Mesmo padrão do spotlight acima (uma escrita de estilo por
// quadro, via requestAnimationFrame). Só com mouse e sem prefers-reduced-motion — fora disso a
// logo fica no degradê estático definido no CSS.
const logoGigante = document.getElementById("footer-logo-gigante");
const rodape = logoGigante?.closest("footer");
if (rodape && window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches) {
  let logoX = 0, logoY = 0, logoAgendado = false, logoRepouso;
  function aplicarLuzLogo() {
    logoAgendado = false;
    clearTimeout(logoRepouso);
    logoGigante.classList.add("reagindo");
    const r = logoGigante.getBoundingClientRect();
    const x = logoX - r.left, y = logoY - r.top;
    logoGigante.style.setProperty("--mx", `${x}px`);
    logoGigante.style.setProperty("--my", `${y}px`);
    // Inclinação limitada (±6° / ±5°): o canto mais perto do cursor "afunda".
    const fx = Math.max(-0.5, Math.min(0.5, x / r.width - 0.5));
    const fy = Math.max(-0.5, Math.min(0.5, y / r.height - 0.5));
    logoGigante.style.setProperty("--ry", `${(fx * 12).toFixed(2)}deg`);
    logoGigante.style.setProperty("--rx", `${(-fy * 10).toFixed(2)}deg`);
    logoGigante.style.setProperty("--luz", "1");
  }
  rodape.addEventListener("pointermove", (e) => {
    logoX = e.clientX;
    logoY = e.clientY;
    if (!logoAgendado) {
      logoAgendado = true;
      requestAnimationFrame(aplicarLuzLogo);
    }
  });
  rodape.addEventListener("pointerleave", () => {
    logoGigante.style.setProperty("--luz", "0");
    logoGigante.style.setProperty("--rx", "0deg");
    logoGigante.style.setProperty("--ry", "0deg");
    // Tira a camada 3D depois que a logo termina de voltar ao plano (ver .reagindo no CSS).
    logoRepouso = setTimeout(() => logoGigante.classList.remove("reagindo"), 700);
  });
}

// ---------------------------------------------------------------
// Números de destaque — lidos ao vivo de "estatisticas/publico" (documento
// agregado público, publicado automaticamente por js/gestao.js sempre que um
// DP/RH/Admin ativa/encerra um contrato, cadastra colaborador ou abre a gestão).
// Se o documento ainda não existir (primeiro uso, antes de qualquer ação em
// gestao.html), caímos num valor de exemplo só para a página não ficar vazia.
// ---------------------------------------------------------------
const VALOR_ARRECADADO_EXEMPLO = 9867;
const QTD_COLABORADORES_EXEMPLO = 358;
const COLABORADORES_ANOS_ANTERIORES_EXEMPLO = 0;

document.getElementById("fundo-rotulo-texto").innerHTML =
  `Fundo Shinatal <span class="not-italic font-extrabold text-festive-gold text-lg sm:text-xl">${new Date().getFullYear()}</span>`;

async function carregarNumeros() {
  let valor = VALOR_ARRECADADO_EXEMPLO;
  let colaboradores = QTD_COLABORADORES_EXEMPLO;
  let colaboradoresAnosAnteriores = COLABORADORES_ANOS_ANTERIORES_EXEMPLO;

  try {
    const snap = await getDoc(doc(db, "estatisticas", "publico"));
    if (snap.exists()) {
      const dados = snap.data();
      if (typeof dados.arrecadado === "number") valor = dados.arrecadado;
      if (typeof dados.colaboradores === "number") colaboradores = dados.colaboradores;
      if (typeof dados.colaboradoresAnosAnteriores === "number") colaboradoresAnosAnteriores = dados.colaboradoresAnosAnteriores;
    }
  } catch {
    // Documento ainda não publicado ou sem permissão — mantém o exemplo.
  }

  animarNumero(document.getElementById("valor-arrecadado"), valor, { formatador: formatarMoeda });

  const ano = new Date().getFullYear();
  const qtdAnoEl = document.getElementById("qtd-colaboradores-ano");
  qtdAnoEl.innerHTML = `<span class="material-symbols-outlined text-primary text-xl" aria-hidden="true">groups</span> Somos <strong id="num-colaboradores" class="valor-colaboradores-destaque">0</strong> colaboradores em ${ano}`;
  document.getElementById("qtd-colaboradores-total").innerHTML =
    `<strong id="num-colaboradores-total" class="valor-colaboradores-destaque">0</strong> colaboradores no total`;
  animarNumero(document.getElementById("num-colaboradores"), colaboradores, { formatador: (v) => Math.round(v).toString() });
  animarNumero(document.getElementById("num-colaboradores-total"), colaboradores + colaboradoresAnosAnteriores, { formatador: (v) => Math.round(v).toString() });
}

carregarNumeros();
