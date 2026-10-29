// Shinatal — script da página index.html (antes inline; extraído para a CSP poder proibir
// script inline — ver firebase.json).
// Sem o SDK do Firebase de propósito: a home só lê um documento público, e o SDK (mais o
// reCAPTCHA do App Check) custava ~600 KB e vários segundos de processamento no celular.
import { firebaseConfig, FIRESTORE_REST } from "./firebase-config.js";
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
// Vídeo do hero — toca em qualquer aparelho, em duas versões leves: vertical (celular em pé,
// ~540 px) e horizontal (computador/tablet deitado, ~1280 px). Fica só no pôster (imagem
// estática) para quem pede menos movimento (prefers-reduced-motion), está com Data Saver ligado
// ou numa conexão 2G. O <video> não tem src no HTML: sem JS ou nesses casos, nada é baixado.
// O download só começa depois que a página carregou e o navegador ficou ocioso, para o vídeo
// nunca disputar banda nem processamento com o conteúdo da primeira tela.
// ---------------------------------------------------------------
const videoHero = document.getElementById("video-hero");
if (videoHero) {
  const prefereReduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const conexao = navigator.connection;
  const conexaoMuitoFraca = conexao && (conexao.saveData || ["slow-2g", "2g"].includes(conexao.effectiveType));
  const podeAutoplay = !prefereReduzido && !conexaoMuitoFraca;

  if (podeAutoplay) {
    // Lido por js/acessibilidade.js: o botão "Pausar animações" só retoma o vídeo se o autoplay
    // era permitido para este visitante.
    videoHero.dataset.autoplayPermitido = "1";
    const retrato = window.matchMedia("(max-aspect-ratio: 1/1)").matches;
    const iniciarVideo = () => {
      videoHero.src = retrato ? videoHero.dataset.srcRetrato : videoHero.dataset.srcPaisagem;
      videoHero.preload = "auto";
      // Só aparece quando já tem quadro para mostrar — até lá fica o pôster (mesmo 1º quadro).
      videoHero.addEventListener("playing", () => videoHero.classList.add("video-pronto"), { once: true });
      if (!movimentoPausado()) videoHero.play().catch(() => {});
    };
    const quandoOcioso = () => ("requestIdleCallback" in window
      ? requestIdleCallback(iniciarVideo, { timeout: 3000 })
      : setTimeout(iniciarVideo, 1500));
    if (document.readyState === "complete") quandoOcioso();
    else window.addEventListener("load", quandoOcioso, { once: true });
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
// Números de destaque — lidos de "estatisticas/publico" (documento agregado
// público, publicado automaticamente por js/gestao.js sempre que um DP/RH/Admin
// ativa/encerra um contrato, cadastra colaborador ou abre a gestão), pela API
// REST do Firestore, e relidos a cada minuto enquanto a aba está visível.
// Se o documento não existir ou a leitura falhar (offline), caímos num valor
// de exemplo só para a página não ficar vazia.
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

const URL_ESTATISTICAS = `${FIRESTORE_REST}/projects/${firebaseConfig.projectId}/databases/(default)/documents/estatisticas/publico?key=${firebaseConfig.apiKey}`;
const INTERVALO_ATUALIZACAO_MS = 60_000;

/** Valor numérico de um campo no formato da API REST ({ integerValue: "65" } / { doubleValue: 1.5 }). */
function numeroDoCampo(campo) {
  const bruto = campo?.integerValue ?? campo?.doubleValue;
  const n = Number(bruto);
  return bruto !== undefined && Number.isFinite(n) ? n : null;
}

let ultimosNumeros = "";
async function lerNumeros() {
  let campos = {};
  try {
    const resposta = await fetch(URL_ESTATISTICAS, { cache: "no-store" });
    if (resposta.ok) campos = (await resposta.json()).fields || {};
  } catch { /* offline — mantém o exemplo */ }
  const valores = [
    numeroDoCampo(campos.arrecadado) ?? VALOR_ARRECADADO_EXEMPLO,
    numeroDoCampo(campos.colaboradores) ?? QTD_COLABORADORES_EXEMPLO,
    numeroDoCampo(campos.colaboradoresAnosAnteriores) ?? COLABORADORES_ANOS_ANTERIORES_EXEMPLO
  ];
  // Só reanima quando algo mudou — a releitura de minuto em minuto não fica "piscando".
  const assinatura = valores.join("|");
  if (assinatura !== ultimosNumeros) {
    ultimosNumeros = assinatura;
    exibirNumeros(...valores);
  }
}

function carregarNumeros() {
  montarEstruturaColaboradores();
  lerNumeros();
  setInterval(() => { if (!document.hidden) lerNumeros(); }, INTERVALO_ATUALIZACAO_MS);
}

carregarNumeros();
