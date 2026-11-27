// Shinatal — lógica do painel do colaborador.
import { db } from "./firebase-init.js";
import {
  collection, query, where, getDocs, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao } from "./auth.js";
import {
  formatarMoeda, formatarData, mostrarToast,
  alternarAccordion, animarNumero, ativarRevelacaoAoRolar, escaparHTML, sincronizarAlturaHeader,

} from "./ui-utils.js";
import { calcularCotaColaborador, simularCotaColaborador } from "./calculo-shinatal.js?v=v2-2026-11c";
import { sincronizarDiretorio } from "./diretorio-service.js";

// Sem onclick inline no HTML (a CSP proíbe) — os gatilhos são ligados aqui, antes de qualquer await.
document.querySelectorAll("[data-rolar-para]").forEach((botao) => {
  botao.addEventListener("click", () => document.getElementById(botao.dataset.rolarPara).scrollIntoView({ behavior: "smooth" }));
});
document.querySelectorAll("[data-accordion]").forEach((botao) => {
  botao.addEventListener("click", () => alternarAccordion(botao.dataset.accordion, botao.dataset.accordionIcone, botao));
});

const ANO_EXERCICIO = new Date().getFullYear();

const perfil = await exigirAutenticacao(["colaborador"]);
ativarRevelacaoAoRolar();
sincronizarAlturaHeader();
renderizarPerfil(perfil);
sincronizarDiretorio(perfil);

const dados = await carregarRegistrosDoColaborador(perfil.uid);

// Fundo compartilhado (somaPesos + saldoDisponível) mantido pelo painel de gestão.
// Recalcula a cota ao vivo sempre que o fundo mudar (novo contrato, etc).
let fundoAtual = { saldoDisponivel: 0, somaPesos: 0 };

onSnapshot(doc(db, "fundo", String(ANO_EXERCICIO)), (snap) => {
  fundoAtual = snap.exists() ? snap.data() : { saldoDisponivel: 0, somaPesos: 0 };
  const resultado = calcularCotaColaborador(
    perfil, dados, fundoAtual.saldoDisponivel || 0, fundoAtual.somaPesos || 0, ANO_EXERCICIO, fundoAtual.somaPesosAjustados || 0
  );
  renderizarCota(resultado);
  document.getElementById("qtd-contratos-ativos").textContent = fundoAtual.totalContratosAtivos ?? 0;
  document.getElementById("qtd-contratos-encerrados").textContent = fundoAtual.totalContratosEncerrados ?? 0;
  document.getElementById("valor-fundo-total").textContent = formatarMoeda(fundoAtual.saldoDisponivel || 0);
  simular();
});

/* ------------------------------------------------------------------ */

async function carregarRegistrosDoColaborador(uid) {
  const [faltas, atrasos, advertencias, avaliacoes] = await Promise.all([
    buscarPorUid("faltas", uid),
    buscarPorUid("atrasos", uid),
    buscarPorUid("advertencias", uid),
    buscarPorUid("avaliacoes", uid)
  ]);
  return { faltas, atrasos, advertencias, avaliacoes };
}

async function buscarPorUid(nomeColecao, uid) {
  const q = query(collection(db, nomeColecao), where("uid", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function renderizarPerfil(p) {
  document.getElementById("saudacao-nome").textContent = `Bem-vindo(a), ${(p.nome || "").split(" ")[0] || "colaborador(a)"}!`;
  document.getElementById("saudacao-data").textContent =
    new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function badge(qtd, limiteAtencao) {
  if (qtd === 0) return { classe: "bg-secondary-container/40 text-on-secondary-container", icone: "check_circle", texto: "Excelente" };
  if (qtd <= limiteAtencao) return { classe: "bg-tertiary-container/30 text-tertiary", icone: "warning", texto: "Atenção" };
  return { classe: "bg-error-container text-on-error-container", icone: "error", texto: "Crítico" };
}

function aplicarBadge(idValor, idBadge, qtd, limiteAtencao) {
  document.getElementById(idValor).textContent = qtd;
  const b = badge(qtd, limiteAtencao);
  const el = document.getElementById(idBadge);
  el.className = `px-3 py-1 rounded-full flex items-center gap-1 ${b.classe}`;
  el.innerHTML = `<span class="material-symbols-outlined text-sm" aria-hidden="true">${b.icone}</span><span class="font-body text-label-sm">${b.texto}</span>`;
}

function renderizarCota(resultado) {
  const valorEl = document.getElementById("valor-cota");
  valorEl.classList.remove("skeleton", "w-48", "h-12");
  animarNumero(valorEl, resultado.cotaFinal, { formatador: formatarMoeda });

  const statusEl = document.getElementById("badge-status-cota");
  if (!resultado.elegivel) {
    statusEl.className = "mt-5 flex items-center gap-2 bg-error-container px-4 py-2 rounded-full border border-white/50";
    statusEl.innerHTML = `<span class="material-symbols-outlined text-on-error-container text-base" aria-hidden="true">block</span><span class="font-body text-label-sm text-on-error-container font-semibold">Inelegível: ${resultado.motivoInelegibilidade}</span>`;
  } else if (resultado.percentualAdicionais > 0) {
    statusEl.className = "mt-5 flex items-center gap-2 bg-festive-gold/20 px-4 py-2 rounded-full border border-white/50";
    statusEl.innerHTML = `<span class="material-symbols-outlined text-tertiary text-base" aria-hidden="true">military_tech</span><span class="font-body text-label-sm text-tertiary font-semibold">Bônus/avaliação aplicados (+${(resultado.percentualAdicionais * 100).toFixed(0)}%)</span>`;
  } else {
    statusEl.className = "mt-5 flex items-center gap-2 bg-surface-glass px-4 py-2 rounded-full border border-white/50";
    statusEl.innerHTML = `<span class="material-symbols-outlined text-secondary text-base" aria-hidden="true">trending_up</span><span class="font-body text-label-sm text-secondary font-semibold">Projeção atual</span>`;
  }

  aplicarBadge("qtd-faltas", "badge-faltas", resultado.numeroFaltas, 2);
  aplicarBadge("qtd-atrasos", "badge-atrasos", resultado.pontosAtraso, 5);
  aplicarBadge("qtd-disciplinar", "badge-disciplinar", resultado.disciplinar.ocorrencias.length, 0);

  const titulo = document.getElementById("motivacional-titulo");
  const texto = document.getElementById("motivacional-texto");
  if (resultado.bonusExcelencia > 0) {
    titulo.textContent = "Conduta exemplar! 🎄";
    texto.textContent = "Você já garantiu os +3% de bônus por excelência (Seção 10). Continue assim até o fechamento do ano!";
  } else if (resultado.numeroFaltas > 0 || resultado.pontosAtraso > 0 || resultado.disciplinar.ocorrencias.length > 0) {
    titulo.textContent = "Ainda dá tempo de melhorar";
    texto.textContent = "Reduza faltas, atrasos e ocorrências disciplinares até o fim do ano para maximizar sua cota estimada.";
  } else {
    titulo.textContent = "Quase lá!";
    texto.textContent = "Mantenha zero faltas, zero atrasos e zero advertências até dezembro para garantir o bônus de excelência de +3%.";
  }
}

/* ------------------------------------------------------------------ */
/* Simulador de impacto (autolimitado ao próprio colaborador)          */
/* ------------------------------------------------------------------ */

function simular() {
  const bloco = document.getElementById("sim-resultado");
  const extraFaltas = Number(document.getElementById("sim-faltas").value) || 0;
  const extraPontos = Number(document.getElementById("sim-pontos").value) || 0;
  if (extraFaltas === 0 && extraPontos === 0) return bloco.classList.add("hidden");

  const dadosSimulados = {
    faltas: [...dados.faltas],
    atrasos: [...dados.atrasos],
    advertencias: dados.advertencias,
    avaliacoes: dados.avaliacoes
  };
  for (let i = 0; i < extraFaltas; i++) dadosSimulados.faltas.push({ data: `${ANO_EXERCICIO}-01-0${(i % 9) + 1}`, justificada: false });
  for (let m = 1; m <= extraPontos && m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    dadosSimulados.atrasos.push({ mesAno: `${ANO_EXERCICIO}-${mm}`, quantidadeAtrasos: 6 });
  }

  const { atual, simulado } = simularCotaColaborador(
    perfil, dados, dadosSimulados, fundoAtual.saldoDisponivel || 0, fundoAtual.somaPesos || 0, ANO_EXERCICIO, fundoAtual.somaPesosAjustados || 0
  );

  document.getElementById("sim-atual").textContent = formatarMoeda(atual.cotaFinal);
  document.getElementById("sim-simulada").textContent = formatarMoeda(simulado.cotaFinal);
  bloco.classList.remove("hidden");
}

["sim-faltas", "sim-pontos"].forEach((id) => document.getElementById(id).addEventListener("input", simular));

