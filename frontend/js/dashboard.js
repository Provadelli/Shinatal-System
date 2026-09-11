// Shinatal — lógica do painel do colaborador.
import { db } from "./firebase-init.js";
import {
  collection, query, where, getDocs, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao, fazerLogout, enviarLinkRedefinicaoSenha } from "./auth.js";
import {
  formatarMoeda, formatarData, mostrarToast, formatarJornadaSemanal,
  iniciarContagemReenvio, alternarAccordion, animarNumero, ativarRevelacaoAoRolar, escaparHTML, sincronizarAlturaHeader,
  construirAvatarHTML
} from "./ui-utils.js";
import { calcularCotaColaborador } from "./calculo-shinatal.js";
import { renderizarPerfilDetalhado, ROTULOS_CONCEITO } from "./perfil-view.js";
import {
  sincronizarDiretorio, assinarFlagConduta, assinarDiretorio, assinarMeusVotos, votarConduta
} from "./conduta-service.js";

// dashboard.html chama alternarAccordion(...) via onclick inline — precisa estar global.
window.alternarAccordion = alternarAccordion;

const ANO_EXERCICIO = new Date().getFullYear();

const perfil = await exigirAutenticacao(["colaborador"]);
ativarRevelacaoAoRolar();
sincronizarAlturaHeader();
renderizarPerfil(perfil);
sincronizarDiretorio(perfil);

const dados = await carregarRegistrosDoColaborador(perfil.uid);
renderizarListasDeModais(dados);

// Fundo compartilhado (somaPesos + saldoDisponível) mantido pelo painel de gestão.
// Recalcula a cota ao vivo sempre que o fundo mudar (novo contrato, etc).
let fundoAtual = { saldoDisponivel: 0, somaPesos: 0 };
let resultadoAtual = null;
let minhaContagemConduta = null;

/** Avaliação de desempenho (fundo/cota) e Avaliação de Conduta (social) atualizam o mesmo
 * "Perfil detalhado" de forma independente — cada uma tem seu próprio listener do Firestore, mas
 * o render final precisa combinar os dois últimos valores conhecidos de cada um. */
function atualizarPerfilDetalhado() {
  if (!resultadoAtual) return;
  renderizarPerfilDetalhado(document.getElementById("perfil-detalhado"), {
    usuario: perfil, dados, resultado: resultadoAtual, somaPesos: fundoAtual.somaPesos || 0,
    anoExercicio: ANO_EXERCICIO, contagemConduta: minhaContagemConduta
  });
}

onSnapshot(doc(db, "fundo", String(ANO_EXERCICIO)), (snap) => {
  fundoAtual = snap.exists() ? snap.data() : { saldoDisponivel: 0, somaPesos: 0 };
  resultadoAtual = calcularCotaColaborador(
    perfil, dados, fundoAtual.saldoDisponivel || 0, fundoAtual.somaPesos || 0, ANO_EXERCICIO
  );
  renderizarCota(resultadoAtual);
  atualizarPerfilDetalhado();
  document.getElementById("qtd-contratos-ativos").textContent = fundoAtual.totalContratosAtivos ?? 0;
  document.getElementById("qtd-contratos-encerrados").textContent = fundoAtual.totalContratosEncerrados ?? 0;
  document.getElementById("valor-fundo-total").textContent = formatarMoeda(fundoAtual.saldoDisponivel || 0);
  simular();
});

onSnapshot(doc(db, "condutaContagem", perfil.uid), (snap) => {
  minhaContagemConduta = snap.exists() ? snap.data() : null;
  atualizarPerfilDetalhado();
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
  const avatarHtml = construirAvatarHTML(p);

  document.getElementById("avatar-desktop").innerHTML = avatarHtml;
  document.getElementById("avatar-mobile").innerHTML = avatarHtml;
  document.getElementById("avatar-perfil").innerHTML = avatarHtml;
  document.getElementById("nome-desktop").textContent = (p.nome || "Perfil").split(" ")[0];

  document.getElementById("saudacao-nome").textContent = `Bem-vindo(a), ${(p.nome || "").split(" ")[0] || "colaborador(a)"}!`;
  document.getElementById("saudacao-data").textContent =
    new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  document.getElementById("perfil-nome").textContent = p.nome || "—";
  document.getElementById("perfil-cargo").textContent = p.cargo ? `${p.cargo} · ${formatarJornadaSemanal(p.cargaHoraria)}` : "—";
  document.getElementById("perfil-email").textContent = p.email || "—";
  document.getElementById("perfil-admissao").textContent = p.dataAdmissao
    ? `Admissão em ${formatarData(p.dataAdmissao)}`
    : "—";
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
  el.innerHTML = `<span class="material-symbols-outlined text-sm">${b.icone}</span><span class="font-body text-label-sm">${b.texto}</span>`;
}

function renderizarCota(resultado) {
  const valorEl = document.getElementById("valor-cota");
  valorEl.classList.remove("skeleton", "w-48", "h-12");
  animarNumero(valorEl, resultado.cotaFinal, { formatador: formatarMoeda });

  const statusEl = document.getElementById("badge-status-cota");
  if (!resultado.elegivel) {
    statusEl.className = "mt-5 flex items-center gap-2 bg-error-container px-4 py-2 rounded-full border border-white/50";
    statusEl.innerHTML = `<span class="material-symbols-outlined text-on-error-container text-base">block</span><span class="font-body text-label-sm text-on-error-container font-semibold">Inelegível: ${resultado.motivoInelegibilidade}</span>`;
  } else if (resultado.percentualAdicionais > 0) {
    statusEl.className = "mt-5 flex items-center gap-2 bg-festive-gold/20 px-4 py-2 rounded-full border border-white/50";
    statusEl.innerHTML = `<span class="material-symbols-outlined text-tertiary text-base">military_tech</span><span class="font-body text-label-sm text-tertiary font-semibold">Bônus/avaliação aplicados (+${(resultado.percentualAdicionais * 100).toFixed(0)}%)</span>`;
  } else {
    statusEl.className = "mt-5 flex items-center gap-2 bg-surface-glass px-4 py-2 rounded-full border border-white/50";
    statusEl.innerHTML = `<span class="material-symbols-outlined text-secondary text-base">trending_up</span><span class="font-body text-label-sm text-secondary font-semibold">Projeção atual</span>`;
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

function renderizarListasDeModais(dados) {
  const listaFaltas = document.getElementById("lista-faltas");
  listaFaltas.innerHTML = dados.faltas.length
    ? dados.faltas
        .sort((a, b) => (a.data < b.data ? 1 : -1))
        .map((f) => `
          <div class="flex justify-between items-center border-b border-outline-variant/20 pb-2">
            <div>
              <p class="text-on-surface font-medium">${formatarData(f.data)}</p>
              <p class="text-label-sm">${escaparHTML(f.motivo) || "Sem motivo registrado"}</p>
            </div>
            <span class="px-2 py-1 rounded-full text-label-sm ${f.justificada ? "bg-secondary-container/40 text-on-secondary-container" : "bg-error-container text-on-error-container"}">
              ${f.justificada ? "Justificada" : "Injustificada"}
            </span>
          </div>`)
        .join("")
    : `<p class="text-center py-6">Nenhuma falta registrada. 🎉</p>`;

  const rotulos = { verbal: "Advertência verbal", escrita: "Advertência escrita", suspensao1: "1ª suspensão", suspensao2: "2ª suspensão", suspensao3: "3ª suspensão" };
  const listaAdvertencias = document.getElementById("lista-advertencias");
  listaAdvertencias.innerHTML = dados.advertencias.length
    ? dados.advertencias
        .sort((a, b) => (a.data < b.data ? 1 : -1))
        .map((a) => `
          <div class="border-b border-outline-variant/20 pb-2">
            <div class="flex justify-between items-center">
              <p class="text-on-surface font-medium">${escaparHTML(rotulos[a.tipo] || a.tipo)}</p>
              <span class="text-label-sm">${formatarData(a.data)}</span>
            </div>
            <p class="text-label-sm">${escaparHTML(a.motivo) || "Sem motivo registrado"}</p>
          </div>`)
        .join("")
    : `<p class="text-center py-6">Nenhuma advertência registrada. 🎉</p>`;
}

/* ------------------------------------------------------------------ */
/* Conduta — avaliação anônima entre colegas (puramente social, não entra na cota nem no fundo) */
/* ------------------------------------------------------------------ */

let condutaAtiva = false;
let condutaDiretorio = [];
let condutaMeusVotos = {};

function renderModalConduta() {
  const container = document.getElementById("conteudo-conduta");
  if (!condutaAtiva) {
    container.innerHTML = `<p class="text-center py-6">Esta página ainda não está disponível.</p>`;
    return;
  }
  const colegas = condutaDiretorio.filter((u) => u.uid !== perfil.uid && u.role !== "presidente");
  if (!colegas.length) {
    container.innerHTML = `<p class="text-center py-6">Nenhum colega disponível para avaliação no momento.</p>`;
    return;
  }
  container.innerHTML = `
    <p class="font-body text-label-sm text-on-surface-variant mb-1">Votos anônimos — não afeta a cota nem o fundo do Shinatal.</p>
    ${colegas.map((u) => `
      <div class="flex items-center justify-between gap-3 bg-surface-container rounded-lg px-3 py-2">
        <div>
          <p class="text-on-surface font-medium">${escaparHTML(u.nome) || "—"}</p>
          <p class="text-label-sm">${escaparHTML(u.cargo) || "—"}</p>
        </div>
        <select data-votar-conduta="${u.uid}" class="input-shinatal !pl-3 !py-1.5 w-40">
          <option value="">Avaliar...</option>
          ${["excelente", "bom", "regular", "insatisfatorio"].map((c) =>
            `<option value="${c}" ${condutaMeusVotos[u.uid] === c ? "selected" : ""}>${ROTULOS_CONCEITO[c]}</option>`).join("")}
        </select>
      </div>`).join("")}`;
}

assinarFlagConduta((ativa) => { condutaAtiva = ativa; renderModalConduta(); });
assinarDiretorio((lista) => { condutaDiretorio = lista; renderModalConduta(); });
assinarMeusVotos(perfil.uid, (votos) => { condutaMeusVotos = votos; renderModalConduta(); });

document.getElementById("conteudo-conduta").addEventListener("change", async (e) => {
  const select = e.target.closest("[data-votar-conduta]");
  if (!select || !select.value) return;
  const novoConceito = select.value;
  select.disabled = true;
  try {
    await votarConduta({ avaliadorUid: perfil.uid, avaliadoUid: select.dataset.votarConduta, conceito: novoConceito });
    mostrarToast("Avaliação registrada.", "sucesso");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível registrar sua avaliação.", "erro");
  } finally {
    select.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Modais e ações                                                      */
/* ------------------------------------------------------------------ */

document.addEventListener("click", (e) => {
  const abrir = e.target.closest("[data-abrir-modal]");
  if (abrir) {
    document.getElementById(abrir.dataset.abrirModal).classList.remove("hidden");
    document.getElementById(abrir.dataset.abrirModal).classList.add("flex");
  }
  const fechar = e.target.closest("[data-fechar-modal]");
  if (fechar) {
    fechar.closest(".fixed.inset-0").classList.add("hidden");
    fechar.closest(".fixed.inset-0").classList.remove("flex");
  }
  if (e.target.classList.contains("bg-inverse-surface/40")) {
    e.target.classList.add("hidden");
    e.target.classList.remove("flex");
  }
});

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

  const atual = calcularCotaColaborador(perfil, dados, fundoAtual.saldoDisponivel || 0, fundoAtual.somaPesos || 0, ANO_EXERCICIO);
  const simulado = calcularCotaColaborador(perfil, dadosSimulados, fundoAtual.saldoDisponivel || 0, fundoAtual.somaPesos || 0, ANO_EXERCICIO);

  document.getElementById("sim-atual").textContent = formatarMoeda(atual.cotaFinal);
  document.getElementById("sim-simulada").textContent = formatarMoeda(simulado.cotaFinal);
  bloco.classList.remove("hidden");
}

["sim-faltas", "sim-pontos"].forEach((id) => document.getElementById(id).addEventListener("input", simular));

document.getElementById("btn-sair-desktop").addEventListener("click", fazerLogout);
document.getElementById("btn-sair-modal").addEventListener("click", fazerLogout);

document.getElementById("btn-trocar-senha").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  try {
    await enviarLinkRedefinicaoSenha(perfil.email);
    mostrarToast("Link enviado! Confira seu e-mail institucional.", "sucesso");
    iniciarContagemReenvio("btn-trocar-senha", 60);
  } catch (erro) {
    mostrarToast("Não foi possível enviar o link agora. Tente novamente.", "erro");
  }
});
