// Shinatal — script da página index.html (antes inline; extraído para a CSP poder proibir
// script inline — ver firebase.json).
import { db } from "./firebase-init.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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
// Vídeo do hero — só em computador com boa conexão. Fica só no pôster (imagem estática) para
// quem pede menos movimento (prefers-reduced-motion), está com Data Saver ligado, ou está no
// "modo leve" (celular, pouca memória ou conexão fraca — classe posta por js/perf-adaptativo.js).
// Sem autoplay no HTML: nesses casos o mp4 nunca é baixado. Quando pode tocar, o download só
// começa depois que a página terminou de carregar, para não disputar banda com o conteúdo.
// ---------------------------------------------------------------
const videoHero = document.getElementById("video-hero");
if (videoHero) {
  const prefereReduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection?.saveData;
  const modoLeve = document.documentElement.classList.contains("modo-leve");
  const podeAutoplay = !prefereReduzido && !saveData && !modoLeve;

  if (podeAutoplay) {
    // Lido por js/acessibilidade.js: o botão "Pausar animações" só retoma o vídeo se o autoplay
    // era permitido para este visitante.
    videoHero.dataset.autoplayPermitido = "1";
    const iniciarVideo = () => {
      videoHero.preload = "auto";
      if (!movimentoPausado()) videoHero.play().catch(() => {});
    };
    if (document.readyState === "complete") iniciarVideo();
    else window.addEventListener("load", iniciarVideo, { once: true });
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

function montarEstruturaColaboradores() {
  const ano = new Date().getFullYear();
  const qtdAnoEl = document.getElementById("qtd-colaboradores-ano");
  qtdAnoEl.innerHTML = `<span class="material-symbols-outlined text-primary text-xl" aria-hidden="true">groups</span> Somos <strong id="num-colaboradores" class="valor-colaboradores-destaque">0</strong> colaboradores em ${ano}`;
  document.getElementById("qtd-colaboradores-total").innerHTML =
    `<strong id="num-colaboradores-total" class="valor-colaboradores-destaque">0</strong> colaboradores no total`;
}

function exibirNumeros(valor, colaboradores, colaboradoresAnosAnteriores) {
  const inteiro = (v) => Math.round(v).toString();
  animarNumero(document.getElementById("valor-arrecadado"), valor, { formatador: formatarMoeda });
  animarNumero(document.getElementById("num-colaboradores"), colaboradores, { formatador: inteiro });
  animarNumero(document.getElementById("num-colaboradores-total"), colaboradores + colaboradoresAnosAnteriores, { formatador: inteiro });
}

function carregarNumeros() {
  montarEstruturaColaboradores();

  // Ao vivo: cada contrato que entra/sai republica o documento e a página acompanha sem recarregar.
  onSnapshot(doc(db, "estatisticas", "publico"), (snap) => {
    const dados = snap.exists() ? snap.data() : {};
    exibirNumeros(
      typeof dados.arrecadado === "number" ? dados.arrecadado : VALOR_ARRECADADO_EXEMPLO,
      typeof dados.colaboradores === "number" ? dados.colaboradores : QTD_COLABORADORES_EXEMPLO,
      typeof dados.colaboradoresAnosAnteriores === "number" ? dados.colaboradoresAnosAnteriores : COLABORADORES_ANOS_ANTERIORES_EXEMPLO
    );
  }, () => {
    // Sem permissão ou offline — mantém o exemplo.
    exibirNumeros(VALOR_ARRECADADO_EXEMPLO, QTD_COLABORADORES_EXEMPLO, COLABORADORES_ANOS_ANTERIORES_EXEMPLO);
  });
}

carregarNumeros();
