// Shinatal — Contratos Empresariais (CNPJ). Página restrita a Admin/Presidente — DP/RH não
// têm acesso a esta aba (nem leitura), conforme exigirAutenticacao abaixo.
// Sem subcoleção de funcionários: o quadro inicial é uma quantidade, e tanto as saídas do
// quadro inicial quanto as entradas durante o contrato são listas de {data, motivo} direto
// no documento do contrato — nenhum funcionário precisa ser nomeado, só contado e datado.
import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao, fazerLogout } from "./auth.js";
import { formatarMoeda, formatarData, formatarDataHora, mostrarToast, confirmarAcao, ativarRevelacaoAoRolar, escaparHTML } from "./ui-utils.js";
import {
  normalizarCNPJ, formatarCNPJ, validarCNPJ, MESES_ANO, CREDITO_POR_CONTRATO,
  calcularDuracaoMesesPrevista, calcularMesesVigentesContrato, calcularResumoContratoEmpresarial,
  quantidadeDoRegistro, calcularCotaColaborador
} from "./calculo-shinatal.js";
import { recalcularEPublicarFundo as publicarFundo } from "./fundo-service.js";
import { buscarCNPJReceitaFederal } from "./cnpj-service.js";
import { renderizarPerfilDetalhado } from "./perfil-view.js";
import { criarSolicitacao } from "./solicitacoes-service.js";

const ANO_EXERCICIO = new Date().getFullYear();
const ROTULOS_ROLE = { admin: "Administrador", dp: "Departamento Pessoal", rh: "Recursos Humanos", presidente: "Presidente" };
const ROTULOS_STATUS_CONTRATO = {
  ativo: { texto: "Ativo", classe: "bg-secondary-container/40 text-on-secondary-container" },
  pausado: { texto: "Pausado", classe: "bg-tertiary-container/40 text-on-tertiary-container" },
  encerrado: { texto: "Encerrado", classe: "bg-surface-container-highest text-on-surface-variant" }
};

// Esta página só é acessível a Admin/Presidente (DP/RH perderam acesso à aba Contratos).
const perfil = await exigirAutenticacao(["admin", "presidente"]);
ativarRevelacaoAoRolar();
const ehPresidente = perfil.role === "presidente";
// "podeGerenciar" é sempre true aqui (só admin/presidente chegam nesta página); quem
// realmente grava direto ou só solicita aprovação é decidido por `ehPresidente`, dentro de
// cada handler de escrita (ver confirmarEAplicarMovimentacao e o submit do formulário).
const podeGerenciar = perfil.role === "admin" || ehPresidente;
document.getElementById("nome-desktop").textContent = perfil.nome || perfil.email;
document.getElementById("badge-role").innerHTML =
  `<span class="material-symbols-outlined text-base">shield_person</span> ${ROTULOS_ROLE[perfil.role] || perfil.role}`;
if (!ehPresidente) {
  document.getElementById("subtitulo-pagina").textContent =
    "Suas alterações aqui (criar, editar, entradas/saídas, excluir) viram uma solicitação — só valem depois que o Presidente aprovar.";
}
if (podeGerenciar) {
  const btnNovo = document.getElementById("btn-novo-contrato-emp");
  btnNovo.classList.remove("hidden");
  btnNovo.classList.add("flex");
}

// Mesmas opções de header do Painel de Gestão (Atividade/Solicitações) — os modais em si só
// existem em gestao.js; aqui só mostramos os links (com o badge de pendentes ao vivo) e eles
// levam para /gestao já abrindo o modal certo (ver "abrir=" em gestao.js).
document.getElementById("nav-log-desktop").classList.toggle("hidden", !podeGerenciar);
document.getElementById("nav-log-mobile").classList.toggle("hidden", !podeGerenciar);
document.getElementById("nav-solicitacoes-desktop").classList.toggle("hidden", !ehPresidente);
document.getElementById("nav-solicitacoes-mobile").classList.toggle("hidden", !ehPresidente);
if (ehPresidente) {
  onSnapshot(query(collection(db, "solicitacoes"), where("status", "==", "pendente")), (snap) => {
    const qtd = snap.size;
    [document.getElementById("badge-solicitacoes-desktop"), document.getElementById("badge-solicitacoes-mobile")].forEach((b) => {
      b.textContent = String(qtd);
      b.classList.toggle("hidden", qtd === 0);
    });
  });
}

const state = { usuarios: [], contratosBase: [], contratosEmpresariais: [] };
let contratoEmEdicao = null;
let contratoFuncionariosAberto = null;
let funcionariosHabilitado = false;

/* ------------------------------------------------------------------ */
/* Perfil (só o próprio — esta página não lista colaboradores). Busca sob */
/* demanda, na primeira vez que o modal abre (self-scoped, já permitido). */
/* ------------------------------------------------------------------ */

let perfilCarregado = false;

async function abrirPerfilProprio() {
  if (!perfilCarregado) {
    const [faltasSnap, atrasosSnap, advertenciasSnap, avaliacoesSnap, fundoSnap] = await Promise.all([
      getDocs(query(collection(db, "faltas"), where("uid", "==", perfil.uid))),
      getDocs(query(collection(db, "atrasos"), where("uid", "==", perfil.uid))),
      getDocs(query(collection(db, "advertencias"), where("uid", "==", perfil.uid))),
      getDocs(query(collection(db, "avaliacoes"), where("uid", "==", perfil.uid))),
      getDoc(doc(db, "fundo", String(ANO_EXERCICIO)))
    ]);
    const dados = {
      faltas: faltasSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      atrasos: atrasosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      advertencias: advertenciasSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      avaliacoes: avaliacoesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    };
    const fundo = fundoSnap.exists() ? fundoSnap.data() : { saldoDisponivel: 0, somaPesos: 0 };
    const resultado = calcularCotaColaborador(perfil, dados, fundo.saldoDisponivel || 0, fundo.somaPesos || 0, ANO_EXERCICIO);
    renderizarPerfilDetalhado(document.getElementById("perfil-detalhado"), {
      usuario: perfil, dados, resultado, somaPesos: fundo.somaPesos || 0, anoExercicio: ANO_EXERCICIO
    });
    perfilCarregado = true;
  }
  abrirModal("modal-perfil");
}

document.getElementById("nav-perfil-desktop").addEventListener("click", abrirPerfilProprio);
document.getElementById("nav-perfil-mobile").addEventListener("click", abrirPerfilProprio);

// Envolvido em try/catch: uma falha aqui (ex.: rede, regra do Firestore) não pode impedir o
// resto do script — abaixo — de rodar e ligar os botões/modais da página.
try {
  await carregarTudo();
  renderTabela();
} catch (erro) {
  console.error("[Shinatal] Falha ao carregar contratos empresariais:", erro);
  mostrarToast("Não foi possível carregar todos os dados. Alguns números podem estar desatualizados.", "erro");
}

/* ------------------------------------------------------------------ */
/* Carregamento                                                        */
/* ------------------------------------------------------------------ */

async function carregarTudo() {
  const [usuariosSnap, contratosSnap, contratosEmpresariaisSnap] = await Promise.all([
    getDocs(collection(db, "usuarios")),
    getDocs(collection(db, "contratos")),
    getDocs(collection(db, "contratosEmpresariais"))
  ]);
  state.usuarios = usuariosSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  state.contratosBase = contratosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  state.contratosEmpresariais = contratosEmpresariaisSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function recalcularEPublicarFundo() {
  await publicarFundo({
    usuarios: state.usuarios, contratos: state.contratosBase, anoExercicio: ANO_EXERCICIO, atualizadoPorUid: perfil.uid
  });
}

/* ------------------------------------------------------------------ */
/* Tabela de contratos                                                 */
/* ------------------------------------------------------------------ */

/** Atualiza o texto das opções de status do filtro com a contagem real de contratos cadastrados
 * em cada status — sem mexer no "value" da option, pra não perder o filtro já selecionado. */
function atualizarContadoresFiltroStatus() {
  const contagens = { ativo: 0, pausado: 0, encerrado: 0 };
  state.contratosEmpresariais.forEach((c) => { if (contagens[c.status] !== undefined) contagens[c.status]++; });
  const select = document.getElementById("filtro-status-contrato");
  select.querySelector('option[value="ativo"]').textContent = `Somente ativos (${contagens.ativo})`;
  select.querySelector('option[value="pausado"]').textContent = `Somente pausados (${contagens.pausado})`;
  select.querySelector('option[value="encerrado"]').textContent = `Somente encerrados (${contagens.encerrado})`;
}

function renderTabela() {
  atualizarContadoresFiltroStatus();
  const termo = document.getElementById("busca-contratos").value.trim().toLowerCase();
  const statusFiltro = document.getElementById("filtro-status-contrato").value;

  const contratos = state.contratosEmpresariais
    .filter((c) => {
      const bateTermo = !termo
        || (c.nomeEmpresa || "").toLowerCase().includes(termo)
        || normalizarCNPJ(c.cnpj).includes(normalizarCNPJ(termo));
      const bateStatus = !statusFiltro || c.status === statusFiltro;
      return bateTermo && bateStatus;
    })
    .sort((a, b) => (a.nomeEmpresa || "").localeCompare(b.nomeEmpresa || ""));

  const corpo = document.getElementById("corpo-contratos-empresariais");
  if (!contratos.length) {
    corpo.innerHTML = `<tr><td colspan="11" class="py-8 text-center font-body text-on-surface-variant">Nenhum contrato encontrado.</td></tr>`;
    return;
  }

  corpo.innerHTML = contratos.map((c) => {
    const resumo = calcularResumoContratoEmpresarial(c);
    const status = ROTULOS_STATUS_CONTRATO[c.status] || ROTULOS_STATUS_CONTRATO.ativo;
    const rotuloEstorno = c.status === "encerrado" ? "aplicado no encerramento" : "se encerrar hoje";
    const duracaoPrevista = calcularDuracaoMesesPrevista(c.dataInicio, c.dataFimPrevista);
    const acoesAdmin = podeGerenciar ? `
        <button data-editar-contrato="${c.id}" title="Editar contrato" class="text-on-surface-variant hover:text-primary transition-colors p-1">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button data-excluir-contrato="${c.id}" title="Excluir contrato" class="text-christmas-red hover:opacity-70 transition-opacity p-1">
          <span class="material-symbols-outlined">delete</span>
        </button>` : "";
    return `
      <tr class="border-b border-outline-variant/50 hover:bg-surface-container-lowest/60 transition-colors align-top">
        <td class="py-3 px-3">
          <p class="font-body font-medium text-on-surface leading-tight">${escaparHTML(c.nomeEmpresa) || "—"}</p>
          <p class="font-body text-label-sm text-on-surface-variant leading-tight">${formatarCNPJ(c.cnpj)}</p>
        </td>
        <td class="py-3 px-3 font-body text-body-md text-on-surface-variant text-right whitespace-nowrap">${c.valorContrato ? formatarMoeda(c.valorContrato) : "—"}</td>
        <td class="py-3 px-3 text-center">
          <button data-ver-funcionarios="${c.id}" title="Ver funcionários" class="inline-flex items-center gap-1.5 font-body text-body-md font-semibold rounded-full px-3 py-1 transition-colors ${resumo.qtdAtual ? "text-primary hover:bg-primary-container/30" : "text-christmas-red hover:bg-error-container/40"}">
            <span class="material-symbols-outlined text-lg">groups</span>${resumo.qtdAtual}
          </button>
        </td>
        <td class="py-3 px-3 font-body text-body-md text-on-surface-variant whitespace-nowrap">${formatarData(c.dataInicio)}</td>
        <td class="py-3 px-3 font-body text-body-md text-on-surface-variant whitespace-nowrap">
          ${formatarData(c.dataFimPrevista)}
          <span class="block text-label-sm">${duracaoPrevista} meses previstos</span>
        </td>
        <td class="py-3 px-3">
          <span class="inline-flex items-center px-2 py-1 rounded-full font-body text-label-sm ${status.classe}">${status.texto}</span>
          ${resumo.mesesPausados ? `<span class="block text-label-sm text-on-surface-variant mt-1">${resumo.mesesPausados} ${resumo.mesesPausados === 1 ? "mês pausado" : "meses pausados"}</span>` : ""}
        </td>
        <td class="py-3 px-3 font-body text-body-md text-right whitespace-nowrap ${resumo.descontado ? "text-christmas-red font-semibold" : "text-on-surface-variant"}">${formatarMoeda(resumo.descontado)}</td>
        <td class="py-3 px-3 font-body text-body-md text-right whitespace-nowrap ${resumo.acrescido ? "text-secondary font-semibold" : "text-on-surface-variant"}">${formatarMoeda(resumo.acrescido)}</td>
        <td class="py-3 px-3 text-right whitespace-nowrap">
          <p class="font-body text-body-md ${resumo.estorno ? "text-christmas-red font-semibold" : "text-on-surface-variant"}">${formatarMoeda(resumo.estorno)}</p>
          <p class="font-body text-label-sm text-on-surface-variant">${rotuloEstorno}</p>
        </td>
        <td class="py-3 px-3 font-body text-body-md text-right whitespace-nowrap font-semibold text-primary">${formatarMoeda(resumo.totalCreditadoFundo)}</td>
        <td class="py-3 px-3 text-right whitespace-nowrap">${acoesAdmin || "—"}</td>
      </tr>`;
  }).join("");
}

document.getElementById("busca-contratos").addEventListener("input", renderTabela);
document.getElementById("filtro-status-contrato").addEventListener("change", renderTabela);

/* ------------------------------------------------------------------ */
/* CNPJ — máscara + validação em tempo real                            */
/* ------------------------------------------------------------------ */

// Evita que a resposta de uma consulta antiga (usuário já digitou outro CNPJ) sobrescreva o
// status na tela — só a consulta mais recente pode escrever o resultado.
let tokenConsultaCNPJ = 0;

function atualizarStatusCNPJ(bruto) {
  const el = document.getElementById("ce-cnpj-status");
  if (!bruto) { el.textContent = ""; return; }
  if (bruto.length < 14) {
    el.textContent = "Continue digitando...";
    el.className = "font-body text-label-sm mt-1.5 min-h-[1em] text-on-surface-variant";
    return;
  }
  const valido = validarCNPJ(bruto);
  if (!valido) {
    el.textContent = "CNPJ inválido — verifique os dígitos.";
    el.className = "font-body text-label-sm mt-1.5 min-h-[1em] text-christmas-red";
    return;
  }
  el.textContent = "CNPJ válido ✓ — consultando na Receita Federal...";
  el.className = "font-body text-label-sm mt-1.5 min-h-[1em] text-secondary";
  consultarCNPJNaReceita(bruto);
}

async function consultarCNPJNaReceita(bruto) {
  const minhaVez = ++tokenConsultaCNPJ;
  const resultado = await buscarCNPJReceitaFederal(bruto);
  if (minhaVez !== tokenConsultaCNPJ) return; // CNPJ mudou enquanto a consulta rodava

  const el = document.getElementById("ce-cnpj-status");
  const campoNome = document.getElementById("ce-nome");

  if (!resultado.ok) {
    el.textContent = "CNPJ válido ✓ — não foi possível confirmar na Receita Federal agora.";
    el.className = "font-body text-label-sm mt-1.5 min-h-[1em] text-secondary";
    return;
  }
  if (!resultado.encontrado) {
    el.textContent = "CNPJ com formato válido, mas não encontrado na Receita Federal — confira antes de prosseguir.";
    el.className = "font-body text-label-sm mt-1.5 min-h-[1em] text-tertiary";
    return;
  }

  if (!campoNome.value.trim() && resultado.razaoSocial) campoNome.value = resultado.razaoSocial;

  if (resultado.ativo) {
    el.textContent = `CNPJ válido na Receita Federal ✓ — ${resultado.razaoSocial || "empresa ativa"}`;
    el.className = "font-body text-label-sm mt-1.5 min-h-[1em] text-secondary";
  } else {
    el.textContent = `Atenção: CNPJ encontrado, mas com situação "${resultado.situacao}" na Receita Federal (não ativa).`;
    el.className = "font-body text-label-sm mt-1.5 min-h-[1em] text-christmas-red";
  }
}

document.getElementById("ce-cnpj").addEventListener("input", (e) => {
  const bruto = normalizarCNPJ(e.target.value).slice(0, 14);
  e.target.value = formatarCNPJ(bruto);
  atualizarStatusCNPJ(bruto);
});

/* ------------------------------------------------------------------ */
/* Modal: Contrato (abas "Dados do contrato" e "Funcionários")         */
/* ------------------------------------------------------------------ */

function somarMeses(dataISO, meses) {
  const d = new Date(dataISO + "T00:00:00");
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}

function alternarTabContrato(nomeTab) {
  document.querySelectorAll("[data-tab-contrato]").forEach((btn) => {
    btn.classList.toggle("tab-contrato-ativo", btn.dataset.tabContrato === nomeTab);
  });
  document.querySelectorAll("[data-tab-painel]").forEach((painel) => {
    painel.classList.toggle("hidden", painel.dataset.tabPainel !== nomeTab);
  });
}

document.querySelectorAll("[data-tab-contrato]").forEach((btn) => {
  btn.addEventListener("click", () => alternarTabContrato(btn.dataset.tabContrato));
});

/** Mostra/esconde os botões "Registrar saída/entrada" — só aparecem com o contrato já salvo
 * (funcionariosHabilitado) e para Admin. Única fonte de verdade desse estado: chamada tanto
 * por habilitarTabFuncionarios (abrir/criar/resetar o modal) quanto pelos esconderForm* (depois
 * de cancelar ou salvar um lançamento), pra nunca ficar com um botão preso escondido. */
function atualizarVisibilidadeBotoesFuncionarios() {
  const podeEditar = funcionariosHabilitado && podeGerenciar;
  document.getElementById("btn-saida-inicial").classList.toggle("hidden", !podeEditar);
  document.getElementById("btn-nova-entrada").classList.toggle("hidden", !podeEditar);
}

/** As abas "Funcionários"/"Histórico" ficam sempre visíveis e clicáveis — só os botões de
 * ação (registrar saída/entrada) dependem do contrato já ter um id salvo, e nesse caso o
 * aviso "salve primeiro" aparece no lugar deles. */
function habilitarTabFuncionarios(habilitar) {
  funcionariosHabilitado = habilitar;
  document.getElementById("ce-funcionarios-aviso").classList.toggle("hidden", habilitar);
  atualizarVisibilidadeBotoesFuncionarios();
}

/** Preview ao vivo: duração prevista entre início e encerramento previsto (informativo). */
function atualizarPreviewDuracao() {
  const inicio = document.getElementById("ce-inicio").value;
  const fimPrevisto = document.getElementById("ce-fim-previsto").value;
  const el = document.getElementById("ce-duracao-prevista");
  if (!inicio || !fimPrevisto) { el.textContent = ""; return; }
  const meses = calcularDuracaoMesesPrevista(inicio, fimPrevisto);
  const aviso = meses > MESES_ANO ? " O crédito ao fundo é limitado a 12 meses (Seção 2)." : "";
  el.textContent = `Duração prevista: ${meses} ${meses === 1 ? "mês" : "meses"}.${aviso}`;
}

/** Preview ao vivo: quadro inicial × R$150/12 × meses vigentes previstos, limitados a 12 (Seção 2.1). */
function atualizarPreviewCreditoInicial() {
  const qtd = Number(document.getElementById("ce-qtd-iniciais").value) || 0;
  const inicio = document.getElementById("ce-inicio").value;
  const fimPrevisto = document.getElementById("ce-fim-previsto").value;
  const meses = calcularMesesVigentesContrato(inicio, fimPrevisto);
  document.getElementById("ce-preview-credito-inicial").textContent =
    formatarMoeda((CREDITO_POR_CONTRATO / MESES_ANO) * qtd * meses);
}
document.getElementById("ce-qtd-iniciais").addEventListener("input", atualizarPreviewCreditoInicial);

/** Texto + selo informativos da aba "Funcionários": headcount atual e valor já creditado. */
function atualizarResumoQuadro() {
  const el = document.getElementById("ce-resumo-quadro");
  if (!contratoEmEdicao) {
    el.textContent = "Se o contrato encerrar antes de 12 meses, o valor creditado é estornado proporcionalmente aos meses faltantes.";
    document.getElementById("ce-tab-qtd-badge").textContent = "0";
    return;
  }
  const resumo = calcularResumoContratoEmpresarial(contratoEmEdicao);
  document.getElementById("ce-tab-qtd-badge").textContent = String(resumo.qtdAtual);
  el.textContent = `Quadro atual: ${resumo.qtdAtual} funcionário(s) ativo(s) — ${formatarMoeda(resumo.totalCreditadoFundo)} creditados ao Fundo Shinatal. Se o contrato encerrar antes de 12 meses, o valor é estornado proporcionalmente.`;
}

/** Chip de estatística (quadro/entradas) — mais legível e acessível que uma frase corrida. */
function chipEstatistica(rotulo, valor, tom = "neutro") {
  const tons = {
    neutro: "bg-surface-container text-on-surface-variant",
    positivo: "bg-secondary-container/50 text-on-secondary-container",
    negativo: "bg-error-container/60 text-on-error-container"
  };
  return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-body text-label-sm font-semibold ${tons[tom] || tons.neutro}">${valor} ${rotulo}</span>`;
}

/** Bloco "Quadro inicial": quantos entraram na implantação, quantos já saíram e a lista de saídas. */
function renderQuadroInicial() {
  const resumoEl = document.getElementById("ce-quadro-inicial-resumo");
  const lista = document.getElementById("lista-saidas-iniciais");
  if (!contratoEmEdicao) {
    resumoEl.textContent = "Salve o contrato na aba anterior para gerenciar o quadro inicial.";
    lista.innerHTML = "";
    return;
  }
  const qtdIniciais = contratoEmEdicao.quantidadeFuncionariosIniciais || 0;
  const saidas = contratoEmEdicao.saidasIniciais || [];
  const totalSaidas = saidas.reduce((soma, s) => soma + quantidadeDoRegistro(s), 0);
  const ativos = Math.max(0, qtdIniciais - totalSaidas);
  resumoEl.innerHTML = [
    chipEstatistica("no quadro inicial", qtdIniciais),
    chipEstatistica(totalSaidas === 1 ? "saída" : "saídas", totalSaidas, totalSaidas ? "negativo" : "neutro"),
    chipEstatistica(ativos === 1 ? "ativo" : "ativos", ativos, "positivo")
  ].join("");

  if (!saidas.length) {
    lista.innerHTML = `<li class="font-body text-label-sm text-on-surface-variant">Nenhuma saída do quadro inicial registrada.</li>`;
    return;
  }
  lista.innerHTML = saidas.map((s, i) => {
    const qtd = quantidadeDoRegistro(s);
    return `
    <li class="flex items-center justify-between gap-2 font-body text-label-sm bg-surface-container rounded-lg px-3 py-2">
      <span class="text-on-surface-variant"><strong class="text-christmas-red">${qtd} ${qtd === 1 ? "saída" : "saídas"}</strong> em ${formatarData(s.data)}${s.motivo ? ` — ${escaparHTML(s.motivo)}` : ""}</span>
      ${podeGerenciar ? `<button data-remover-saida-inicial="${i}" title="Desfazer esta saída" aria-label="Desfazer esta saída" class="text-christmas-red hover:opacity-70 transition-opacity p-1"><span class="material-symbols-outlined text-lg">undo</span></button>` : ""}
    </li>`;
  }).join("");
}

/** Bloco "Entradas durante o contrato": lista de {dataEntrada, dataSaida?, motivo}, sem nome. */
function renderEntradasContrato() {
  const resumoEl = document.getElementById("ce-entradas-resumo");
  const lista = document.getElementById("lista-entradas-contrato");
  if (!contratoEmEdicao) {
    resumoEl.textContent = "Salve o contrato na aba anterior para registrar entradas.";
    lista.innerHTML = "";
    return;
  }
  const entradas = contratoEmEdicao.entradasContrato || [];
  const totalEntradas = entradas.reduce((soma, e) => soma + quantidadeDoRegistro(e), 0);
  const totalAtivas = entradas.filter((e) => !e.dataSaida).reduce((soma, e) => soma + quantidadeDoRegistro(e), 0);
  resumoEl.innerHTML = [
    chipEstatistica(totalEntradas === 1 ? "entrada registrada" : "entradas registradas", totalEntradas),
    chipEstatistica(totalAtivas === 1 ? "ainda ativa" : "ainda ativas", totalAtivas, "positivo")
  ].join("");

  if (!entradas.length) {
    lista.innerHTML = `<li class="font-body text-label-sm text-on-surface-variant">Nenhum funcionário entrou durante o contrato ainda.</li>`;
    return;
  }
  lista.innerHTML = entradas.map((en, i) => {
    const qtd = quantidadeDoRegistro(en);
    const acoesAdmin = podeGerenciar ? `
        ${!en.dataSaida ? `<button data-marcar-saida-entrada="${i}" title="Registrar saída" aria-label="Registrar saída" class="text-on-surface-variant hover:text-christmas-red transition-colors p-1"><span class="material-symbols-outlined text-lg">person_remove</span></button>` : ""}
        <button data-remover-entrada="${i}" title="Remover este registro" aria-label="Remover este registro" class="text-christmas-red hover:opacity-70 transition-opacity p-1"><span class="material-symbols-outlined text-lg">undo</span></button>` : "";
    const texto = en.dataSaida
      ? `<strong class="text-secondary">${qtd} ${qtd === 1 ? "entrada" : "entradas"}</strong> em ${formatarData(en.dataEntrada)} → <strong class="text-christmas-red">saída</strong> em ${formatarData(en.dataSaida)}`
      : `<strong class="text-secondary">${qtd} ${qtd === 1 ? "entrada" : "entradas"}</strong> em ${formatarData(en.dataEntrada)} — ainda ativo(s)`;
    return `
      <li class="flex items-center justify-between gap-2 font-body text-label-sm bg-surface-container rounded-lg px-3 py-2">
        <span class="text-on-surface-variant">${texto}${en.motivo ? ` — ${escaparHTML(en.motivo)}` : ""}</span>
        <span class="flex items-center">${acoesAdmin}</span>
      </li>`;
  }).join("");
}

// Dados originais: definidos só no cadastro, travados depois (ver travarDadosOriginais).
const CAMPOS_ORIGINAIS_TRAVADOS = ["ce-nome", "ce-cnpj", "ce-valor-contrato", "ce-inicio", "ce-qtd-iniciais"];

function travarDadosOriginais(travar) {
  CAMPOS_ORIGINAIS_TRAVADOS.forEach((id) => { document.getElementById(id).disabled = travar; });
  document.getElementById("ce-aviso-bloqueio").classList.toggle("hidden", !travar);
}

function resetarModalContrato() {
  contratoEmEdicao = null;
  contratoFuncionariosAberto = null;
  document.getElementById("ce-titulo").textContent = "Novo contrato empresarial";
  document.getElementById("ce-botao-submit").textContent = "Cadastrar contrato";
  document.getElementById("form-contrato-empresarial").reset();
  travarDadosOriginais(false);
  document.getElementById("ce-cnpj-status").textContent = "";
  document.getElementById("ce-duracao-prevista").textContent = "";
  document.getElementById("ce-bloco-status").classList.add("hidden");
  document.getElementById("ce-bloco-pausa").classList.add("hidden");
  document.getElementById("ce-bloco-retomada").classList.add("hidden");
  document.getElementById("ce-info-pausado").classList.add("hidden");
  document.getElementById("ce-bloco-encerramento").classList.add("hidden");
  esconderFormSaidaInicial();
  esconderFormNovaEntrada();
  esconderFormSaidaEntrada();
  habilitarTabFuncionarios(false);
  atualizarPreviewCreditoInicial();
  atualizarResumoQuadro();
  renderQuadroInicial();
  renderEntradasContrato();
  renderHistoricoMovimentacoes();
  alternarTabContrato("dados");
}

/** A partir do status selecionado agora e do estado salvo do contrato, monta a lista de pausas
 * atualizada — usada tanto na prévia ao vivo (atualizarPreviewEstornoContrato) quanto no submit.
 * Retorna null se uma transição pausar/retomar está em andamento mas a data ainda não foi
 * preenchida (não é um erro fora dessas transições: aí devolve a lista sem mudança nenhuma). */
function montarPausasAtualizadas(statusSelecionado) {
  const pausas = contratoEmEdicao?.pausas || [];
  const estavaPausado = contratoEmEdicao?.status === "pausado";
  if (statusSelecionado === "pausado" && !estavaPausado) {
    const dataPausa = document.getElementById("ce-data-pausa").value;
    if (!dataPausa) return null;
    return [...pausas, { dataPausa, dataRetomada: null }];
  }
  if (estavaPausado && statusSelecionado !== "pausado") {
    const dataRetomada = document.getElementById("ce-data-retomada").value;
    if (!dataRetomada) return null;
    return pausas.map((p, i) => (i === pausas.length - 1 ? { ...p, dataRetomada } : p));
  }
  return pausas;
}

function atualizarPreviewEstornoContrato() {
  if (!contratoEmEdicao) return;
  const dataInicio = document.getElementById("ce-inicio").value;
  const dataFimPrevista = document.getElementById("ce-fim-previsto").value || contratoEmEdicao.dataFimPrevista;
  const dataFimReal = document.getElementById("ce-fim-real").value || new Date().toISOString().slice(0, 10);
  const statusSelecionado = document.getElementById("ce-status").value;
  const pausas = montarPausasAtualizadas(statusSelecionado) ?? contratoEmEdicao.pausas;
  const resumo = calcularResumoContratoEmpresarial(
    { ...contratoEmEdicao, status: "encerrado", dataInicio, dataFimPrevista, dataEncerramentoReal: dataFimReal, pausas }
  );
  document.getElementById("ce-preview-estorno").textContent = formatarMoeda(resumo.estorno);
}

/* ------------------------------------------------------------------ */
/* Confirmação + histórico de movimentações — núcleo compartilhado por todo ponto que muda o
   valor creditado ao fundo (prazo, saídas, entradas, encerramento). Cada mutação passa por
   aqui: calcula o impacto no fundo, pede confirmação com uma descrição legível do que vai
   mudar e só então grava o(s) campo(s) junto com uma nova entrada no histórico — tudo num
   único updateDoc. Desfazer uma saída/entrada NUNCA edita o histórico existente: gera uma
   nova entrada revertendo o delta, mantendo o histórico como um registro imutável. */
/* ------------------------------------------------------------------ */

/** Traduz o resultado de confirmarEAplicarMovimentacao pro toast certo. */
function mensagemResultado(resultado, mensagemSeAplicado) {
  return resultado === "aplicado" ? mensagemSeAplicado : "Solicitação enviada — aguardando aprovação do Presidente.";
}

function descreverDeltaFundo(antes, depois) {
  if (depois > antes) return `o valor creditado sobe de ${formatarMoeda(antes)} para ${formatarMoeda(depois)}`;
  if (depois < antes) return `o valor creditado cai de ${formatarMoeda(antes)} para ${formatarMoeda(depois)}`;
  return `sem alteração no valor creditado ao fundo (${formatarMoeda(depois)})`;
}

/**
 * @param {{idContrato:string, contratoBase:object, contratoDepois:object, tipo:string,
 *   descricaoEvento:string, camposParaSalvar:object}} args
 * @returns {Promise<"aplicado"|"solicitado"|null>} null se cancelado ou falhou; "aplicado" se
 *   gravado direto (Presidente); "solicitado" se virou um pedido pendente de aprovação.
 */
async function confirmarEAplicarMovimentacao({ idContrato, contratoBase, contratoDepois, tipo, descricaoEvento, camposParaSalvar }) {
  const antes = calcularResumoContratoEmpresarial(contratoBase).totalCreditadoFundo;
  const depois = calcularResumoContratoEmpresarial(contratoDepois).totalCreditadoFundo;
  const ok = await confirmarAcao({
    titulo: "Confirmar alteração no contrato",
    mensagem: `${descricaoEvento} — ${descreverDeltaFundo(antes, depois)}.${ehPresidente ? "" : " Isso vai virar uma solicitação, só valendo depois que o Presidente aprovar."}`,
    perigo: depois < antes
  });
  if (!ok) return null;

  const entrada = {
    tipo, descricao: descricaoEvento, fundoAntes: antes, fundoDepois: depois,
    data: new Date(), registradoPor: perfil.uid
  };
  const historicoMovimentacoes = [...(contratoBase.historicoMovimentacoes || []), entrada];
  const camposCompletos = { ...camposParaSalvar, historicoMovimentacoes };
  try {
    if (ehPresidente) {
      await updateDoc(doc(db, "contratosEmpresariais", idContrato), camposCompletos);
      return "aplicado";
    }
    await criarSolicitacao(db, {
      tipo: "contrato_empresarial_editar", descricao: descricaoEvento,
      alvoUid: null, alvoNome: contratoBase.nomeEmpresa,
      dadosAcao: { docId: idContrato, campos: camposCompletos }, operador: perfil
    });
    return "solicitado";
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar a alteração.", "erro");
    return null;
  }
}

/** Bloco "Histórico": lista de movimentações mais recentes primeiro, com data e hora. */
function renderHistoricoMovimentacoes() {
  const lista = document.getElementById("lista-historico-movimentacoes");
  if (!lista) return;
  if (!contratoEmEdicao) {
    lista.innerHTML = `<li class="font-body text-label-sm text-on-surface-variant">Salve o contrato na aba anterior para começar a registrar o histórico.</li>`;
    return;
  }
  const historico = [...(contratoEmEdicao.historicoMovimentacoes || [])].sort((a, b) => {
    const dataA = a.data?.toDate ? a.data.toDate() : new Date(a.data);
    const dataB = b.data?.toDate ? b.data.toDate() : new Date(b.data);
    return dataB - dataA;
  });
  if (!historico.length) {
    lista.innerHTML = `<li class="font-body text-label-sm text-on-surface-variant">Nenhuma movimentação registrada ainda.</li>`;
    return;
  }
  lista.innerHTML = historico.map((h) => `
    <li class="flex items-center justify-between gap-3 font-body text-label-sm bg-surface-container rounded-lg px-3 py-2">
      <span class="text-on-surface-variant">
        <span class="block text-on-surface font-medium">${escaparHTML(h.descricao)}</span>
        ${formatarDataHora(h.data)}
      </span>
      <span class="whitespace-nowrap font-semibold ${h.fundoDepois < h.fundoAntes ? "text-christmas-red" : "text-secondary"}">
        ${formatarMoeda(h.fundoAntes)} → ${formatarMoeda(h.fundoDepois)}
      </span>
    </li>`).join("");
}

/** Preenche o modal (as duas abas) a partir de um contrato já existente e o abre na aba pedida. */
function prepararModalContrato(contrato, tabInicial) {
  resetarModalContrato();
  contratoEmEdicao = contrato;
  contratoFuncionariosAberto = contrato.id;
  travarDadosOriginais(true);
  document.getElementById("ce-titulo").textContent = `Editar contrato — ${contrato.nomeEmpresa}`;
  document.getElementById("ce-botao-submit").textContent = "Salvar alterações";
  document.getElementById("ce-nome").value = contrato.nomeEmpresa;
  document.getElementById("ce-cnpj").value = formatarCNPJ(contrato.cnpj);
  atualizarStatusCNPJ(contrato.cnpj);
  document.getElementById("ce-valor-contrato").value = contrato.valorContrato ?? "";
  document.getElementById("ce-inicio").value = contrato.dataInicio;
  document.getElementById("ce-fim-previsto").value = contrato.dataFimPrevista;
  atualizarPreviewDuracao();
  document.getElementById("ce-qtd-iniciais").value = contrato.quantidadeFuncionariosIniciais ?? 0;
  atualizarPreviewCreditoInicial();
  document.getElementById("ce-bloco-status").classList.remove("hidden");
  document.getElementById("ce-status").value = contrato.status;
  if (contrato.status === "encerrado") {
    document.getElementById("ce-bloco-encerramento").classList.remove("hidden");
    document.getElementById("ce-fim-real").value = contrato.dataEncerramentoReal || "";
    atualizarPreviewEstornoContrato();
  }
  if (contrato.status === "pausado") {
    const resumo = calcularResumoContratoEmpresarial(contrato);
    const pausaAberta = [...(contrato.pausas || [])].reverse().find((p) => !p.dataRetomada);
    const rotuloMeses = `${resumo.mesesPausados} ${resumo.mesesPausados === 1 ? "mês pausado" : "meses pausados"}`;
    document.getElementById("ce-info-pausado").textContent = pausaAberta
      ? `Pausado desde ${formatarData(pausaAberta.dataPausa)} — ${rotuloMeses} até agora (não contam para os 12 meses de vigência).`
      : `${rotuloMeses} até agora (não contam para os 12 meses de vigência).`;
    document.getElementById("ce-info-pausado").classList.remove("hidden");
  }
  habilitarTabFuncionarios(true);
  renderQuadroInicial();
  renderEntradasContrato();
  renderHistoricoMovimentacoes();
  atualizarResumoQuadro();
  alternarTabContrato(tabInicial);
  abrirModal("modal-contrato-empresarial");
}

document.getElementById("btn-novo-contrato-emp").addEventListener("click", resetarModalContrato);

document.getElementById("ce-inicio").addEventListener("change", (e) => {
  const fimPrevisto = document.getElementById("ce-fim-previsto");
  if (!fimPrevisto.value && e.target.value) fimPrevisto.value = somarMeses(e.target.value, MESES_ANO);
  atualizarPreviewDuracao();
  atualizarPreviewCreditoInicial();
  atualizarPreviewEstornoContrato();
});
document.getElementById("ce-fim-previsto").addEventListener("input", () => {
  atualizarPreviewDuracao();
  atualizarPreviewCreditoInicial();
  atualizarPreviewEstornoContrato();
});

document.getElementById("ce-status").addEventListener("change", (e) => {
  const status = e.target.value;
  const estavaPausado = contratoEmEdicao?.status === "pausado";
  const hoje = new Date().toISOString().slice(0, 10);

  const mostrarEncerramento = status === "encerrado";
  document.getElementById("ce-bloco-encerramento").classList.toggle("hidden", !mostrarEncerramento);
  if (mostrarEncerramento) {
    const fimReal = document.getElementById("ce-fim-real");
    if (!fimReal.value) fimReal.value = hoje;
  }

  // "Data da pausa" só aparece ao entrar em pausado agora; "Data de retomada" só ao sair de
  // pausado — nunca as duas juntas (ver montarPausasAtualizadas).
  const mostrarPausa = status === "pausado" && !estavaPausado;
  document.getElementById("ce-bloco-pausa").classList.toggle("hidden", !mostrarPausa);
  if (mostrarPausa) {
    const dataPausa = document.getElementById("ce-data-pausa");
    if (!dataPausa.value) dataPausa.value = hoje;
  }

  const mostrarRetomada = estavaPausado && status !== "pausado";
  document.getElementById("ce-bloco-retomada").classList.toggle("hidden", !mostrarRetomada);
  if (mostrarRetomada) {
    const dataRetomada = document.getElementById("ce-data-retomada");
    if (!dataRetomada.value) dataRetomada.value = hoje;
  }

  atualizarPreviewEstornoContrato();
});
document.getElementById("ce-fim-real").addEventListener("input", atualizarPreviewEstornoContrato);
document.getElementById("ce-data-pausa").addEventListener("input", atualizarPreviewEstornoContrato);
document.getElementById("ce-data-retomada").addEventListener("input", atualizarPreviewEstornoContrato);

document.getElementById("form-contrato-empresarial").addEventListener("submit", async (e) => {
  e.preventDefault();
  const eraEdicao = !!contratoEmEdicao;
  const dataFimPrevista = document.getElementById("ce-fim-previsto").value;

  let dados;
  if (eraEdicao) {
    // Dados originais (nome, CNPJ, valor, início, quadro inicial) são travados após o cadastro
    // — só o prazo previsto pode mudar aqui (mais status/encerramento, abaixo).
    const dataInicio = contratoEmEdicao.dataInicio;
    if (dataFimPrevista < dataInicio) return mostrarToast("A data de encerramento prevista não pode ser antes do início.", "erro");
    const duracaoMesesPrevista = calcularDuracaoMesesPrevista(dataInicio, dataFimPrevista);
    dados = { dataFimPrevista, duracaoMesesPrevista };
  } else {
    const nomeEmpresa = document.getElementById("ce-nome").value.trim();
    const cnpj = normalizarCNPJ(document.getElementById("ce-cnpj").value);
    const valorContratoBruto = document.getElementById("ce-valor-contrato").value;
    const valorContrato = valorContratoBruto === "" ? null : Number(valorContratoBruto);
    const dataInicio = document.getElementById("ce-inicio").value;
    const quantidadeFuncionariosIniciais = Number(document.getElementById("ce-qtd-iniciais").value);

    if (!validarCNPJ(cnpj)) return mostrarToast("CNPJ inválido. Confira os dígitos e tente novamente.", "erro");
    if (dataFimPrevista < dataInicio) return mostrarToast("A data de encerramento prevista não pode ser antes do início.", "erro");
    if (!Number.isInteger(quantidadeFuncionariosIniciais) || quantidadeFuncionariosIniciais < 0) {
      return mostrarToast("Informe a quantidade de funcionários do quadro inicial (0 ou mais).", "erro");
    }

    const duracaoMesesPrevista = calcularDuracaoMesesPrevista(dataInicio, dataFimPrevista);
    // dataFimPrevistaOriginal fica travada para sempre (nunca entra em "dados" na edição) —
    // é a base de comparação para mostrar o efeito de futuras mudanças de prazo como
    // acréscimo/desconto na planilha (ver calcularResumoContratoEmpresarial).
    dados = {
      nomeEmpresa, cnpj, valorContrato, dataInicio, dataFimPrevista, dataFimPrevistaOriginal: dataFimPrevista,
      duracaoMesesPrevista, quantidadeFuncionariosIniciais
    };
  }
  const statusVisivel = !document.getElementById("ce-bloco-status").classList.contains("hidden");
  if (statusVisivel) {
    const status = document.getElementById("ce-status").value;
    const pausas = montarPausasAtualizadas(status);
    if (pausas === null) {
      return mostrarToast(`Informe a data de ${status === "pausado" ? "pausa" : "retomada"}.`, "erro");
    }
    dados.status = status;
    dados.dataEncerramentoReal = status === "encerrado" ? (document.getElementById("ce-fim-real").value || null) : null;
    dados.pausas = pausas;
  }

  try {
    let idContrato = contratoEmEdicao?.id || null;
    if (eraEdicao) {
      // Descreve exatamente o que muda (prazo e/ou status) para a confirmação + o histórico.
      // Sem mudança real (reenvio do formulário sem editar nada): não pede confirmação nem
      // grava movimentação, só fecha o modal.
      const partesDescricao = [];
      if (dados.dataFimPrevista !== contratoEmEdicao.dataFimPrevista) {
        const duracaoAntiga = calcularDuracaoMesesPrevista(contratoEmEdicao.dataInicio, contratoEmEdicao.dataFimPrevista);
        partesDescricao.push(`Prazo previsto alterado de ${duracaoAntiga} para ${dados.duracaoMesesPrevista} meses`);
      }
      if (statusVisivel && dados.status !== contratoEmEdicao.status) {
        const eraPausado = contratoEmEdicao.status === "pausado";
        if (dados.status === "pausado") {
          const dataPausa = dados.pausas[dados.pausas.length - 1]?.dataPausa;
          partesDescricao.push(`Contrato pausado em ${formatarData(dataPausa)}`);
        } else if (eraPausado) {
          const dataRetomada = dados.pausas[dados.pausas.length - 1]?.dataRetomada;
          partesDescricao.push(dados.status === "encerrado"
            ? `Contrato retomado em ${formatarData(dataRetomada)} e encerrado em ${formatarData(dados.dataEncerramentoReal)}`
            : `Contrato retomado em ${formatarData(dataRetomada)} (status voltou para Ativo)`);
        } else if (dados.status === "encerrado") {
          partesDescricao.push(`Contrato encerrado em ${formatarData(dados.dataEncerramentoReal)}`);
        } else {
          partesDescricao.push("Contrato reaberto (status voltou para Ativo)");
        }
      }
      if (!partesDescricao.length) {
        fecharModal("modal-contrato-empresarial");
        return;
      }
      const resultado = await confirmarEAplicarMovimentacao({
        idContrato,
        contratoBase: contratoEmEdicao,
        contratoDepois: { ...contratoEmEdicao, ...dados },
        tipo: "edicao_prazo",
        descricaoEvento: partesDescricao.join("; "),
        camposParaSalvar: dados
      });
      if (!resultado) return;
      mostrarToast(mensagemResultado(resultado, "Contrato atualizado! Fundo Shinatal recalculado."), "sucesso");
      await carregarTudo();
      await recalcularEPublicarFundo();
      renderTabela();
      fecharModal("modal-contrato-empresarial");
      return;
    }

    // Criação de contrato novo: só o Presidente grava direto; qualquer outro papel vira uma
    // solicitação pendente — nesse caso não existe contrato de verdade ainda, então não faz
    // sentido abrir a aba Funcionários, só avisar e fechar o modal.
    const contratoBaseCriacao = { ...dados, status: "ativo", dataEncerramentoReal: null, saidasIniciais: [], entradasContrato: [], pausas: [] };
    const creditoInicial = calcularResumoContratoEmpresarial(contratoBaseCriacao).totalCreditadoFundo;
    const historicoMovimentacoes = [{
      tipo: "criacao",
      descricao: `Crédito inicial lançado: ${dados.quantidadeFuncionariosIniciais} funcionário(s) × ${dados.duracaoMesesPrevista} meses previstos`,
      fundoAntes: 0, fundoDepois: creditoInicial, data: new Date(), registradoPor: perfil.uid
    }];
    const payloadCriacao = { ...contratoBaseCriacao, historicoMovimentacoes, registradoPor: perfil.uid, criadoEm: serverTimestamp() };

    if (!ehPresidente) {
      await criarSolicitacao(db, {
        tipo: "contrato_empresarial_criar",
        descricao: `Novo contrato empresarial: ${dados.nomeEmpresa} (${dados.quantidadeFuncionariosIniciais} funcionário(s))`,
        alvoUid: null, alvoNome: dados.nomeEmpresa,
        dadosAcao: payloadCriacao, operador: perfil
      });
      mostrarToast("Solicitação enviada — aguardando aprovação do Presidente.", "sucesso");
      fecharModal("modal-contrato-empresarial");
      return;
    }

    const ref = await addDoc(collection(db, "contratosEmpresariais"), payloadCriacao);
    idContrato = ref.id;
    mostrarToast(`Contrato cadastrado! ${dados.quantidadeFuncionariosIniciais} funcionário(s) do quadro inicial já creditados ao fundo.`, "sucesso");
    await carregarTudo();
    await recalcularEPublicarFundo();
    renderTabela();

    {
      // Contrato novo: mantemos o modal aberto e trocamos para a aba Funcionários (mesmo
      // diálogo) já com o quadro inicial contabilizado — como ninguém precisa de nome, não
      // há formulário extra a preencher aqui, só a confirmação visual do quadro.
      const contratoCriado = state.contratosEmpresariais.find((c) => c.id === idContrato)
        || { id: idContrato, ...dados, status: "ativo", dataEncerramentoReal: null, saidasIniciais: [], entradasContrato: [], pausas: [] };
      contratoEmEdicao = contratoCriado;
      contratoFuncionariosAberto = idContrato;
      travarDadosOriginais(true);
      document.getElementById("ce-titulo").textContent = `Editar contrato — ${contratoCriado.nomeEmpresa}`;
      document.getElementById("ce-botao-submit").textContent = "Salvar alterações";
      habilitarTabFuncionarios(true);
      renderQuadroInicial();
      renderEntradasContrato();
      renderHistoricoMovimentacoes();
      atualizarResumoQuadro();
      alternarTabContrato("funcionarios");
    }
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar o contrato.", "erro");
  }
});

document.getElementById("corpo-contratos-empresariais").addEventListener("click", async (e) => {
  const btnEditar = e.target.closest("[data-editar-contrato]");
  if (btnEditar) {
    const contrato = state.contratosEmpresariais.find((c) => c.id === btnEditar.dataset.editarContrato);
    if (contrato) prepararModalContrato(contrato, "dados");
    return;
  }

  const btnExcluir = e.target.closest("[data-excluir-contrato]");
  if (btnExcluir) {
    const id = btnExcluir.dataset.excluirContrato;
    const contratoAlvo = state.contratosEmpresariais.find((c) => c.id === id);
    const ok = await confirmarAcao({
      titulo: "Excluir contrato",
      mensagem: "ATENÇÃO: AO EXCLUIR ESTE CONTRATO, ELE DESAPARECE COMPLETAMENTE DO SISTEMA E DE TODOS OS FILTROS (ATIVOS E ENCERRADOS) — O HISTÓRICO DE MOVIMENTAÇÕES TAMBÉM SE PERDE. ESTA AÇÃO NÃO PODE SER DESFEITA."
        + (ehPresidente ? "" : " Isso vai virar uma solicitação, só valendo depois que o Presidente aprovar."),
      textoConfirmar: "Excluir",
      perigo: true
    });
    if (!ok) return;
    try {
      if (ehPresidente) {
        await deleteDoc(doc(db, "contratosEmpresariais", id));
        mostrarToast("Contrato excluído e fundo atualizado.", "sucesso");
        await carregarTudo();
        await recalcularEPublicarFundo();
        renderTabela();
      } else {
        await criarSolicitacao(db, {
          tipo: "contrato_empresarial_excluir",
          descricao: `Excluir contrato — ${contratoAlvo?.nomeEmpresa || id}`,
          alvoUid: null,
          alvoNome: contratoAlvo?.nomeEmpresa || null,
          dadosAcao: { docId: id },
          operador: perfil
        });
        mostrarToast("Solicitação enviada — aguardando aprovação do Presidente.", "sucesso");
      }
    } catch (erro) {
      console.error(erro);
      mostrarToast("Não foi possível excluir o contrato.", "erro");
    }
    return;
  }

  const btnVer = e.target.closest("[data-ver-funcionarios]");
  if (btnVer) {
    const contrato = state.contratosEmpresariais.find((c) => c.id === btnVer.dataset.verFuncionarios);
    if (contrato) prepararModalContrato(contrato, "funcionarios");
  }
});

/** Recarrega tudo, republica o fundo e atualiza a UI da aba Funcionários + tabela externa. */
async function atualizarAposMovimentacao(mensagemSucesso) {
  mostrarToast(mensagemSucesso, "sucesso");
  await carregarTudo();
  await recalcularEPublicarFundo();
  contratoEmEdicao = state.contratosEmpresariais.find((c) => c.id === contratoFuncionariosAberto) || contratoEmEdicao;
  renderQuadroInicial();
  renderEntradasContrato();
  renderHistoricoMovimentacoes();
  atualizarResumoQuadro();
  renderTabela();
}

/* ------------------------------------------------------------------ */
/* Quadro inicial — saídas registradas por contagem, sem nome individual */
/* ------------------------------------------------------------------ */

function esconderFormSaidaInicial() {
  document.getElementById("form-saida-inicial").classList.add("hidden");
  document.getElementById("form-saida-inicial").reset();
  atualizarVisibilidadeBotoesFuncionarios();
}

document.getElementById("btn-saida-inicial").addEventListener("click", () => {
  document.getElementById("form-saida-inicial").classList.remove("hidden");
  document.getElementById("btn-saida-inicial").classList.add("hidden");
  document.getElementById("si-data").value = new Date().toISOString().slice(0, 10);
  document.getElementById("si-quantidade").value = "1";
});

document.getElementById("si-botao-cancelar").addEventListener("click", esconderFormSaidaInicial);

document.getElementById("form-saida-inicial").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = document.getElementById("si-data").value;
  const motivo = document.getElementById("si-motivo").value.trim();
  const quantidade = Number(document.getElementById("si-quantidade").value);
  if (!data) return mostrarToast("Informe a data de saída.", "erro");
  if (!Number.isInteger(quantidade) || quantidade < 1) return mostrarToast("Informe uma quantidade válida (1 ou mais).", "erro");
  const ativosNoQuadro = (contratoEmEdicao.quantidadeFuncionariosIniciais || 0)
    - (contratoEmEdicao.saidasIniciais || []).reduce((soma, s) => soma + quantidadeDoRegistro(s), 0);
  if (quantidade > ativosNoQuadro) {
    return mostrarToast(`Só há ${ativosNoQuadro} funcionário(s) ativo(s) nesse grupo — quantidade maior que isso.`, "erro");
  }

  const novaLista = [...(contratoEmEdicao.saidasIniciais || []), { data, motivo: motivo || null, quantidade }];
  const resultado = await confirmarEAplicarMovimentacao({
    idContrato: contratoFuncionariosAberto,
    contratoBase: contratoEmEdicao,
    contratoDepois: { ...contratoEmEdicao, saidasIniciais: novaLista },
    tipo: "saida_inicial",
    descricaoEvento: `${quantidade} funcionário(s) saíram do quadro inicial em ${formatarData(data)}${motivo ? ` (${motivo})` : ""}`,
    camposParaSalvar: { saidasIniciais: novaLista }
  });
  if (!resultado) return;
  esconderFormSaidaInicial();
  try {
    await atualizarAposMovimentacao(mensagemResultado(resultado, "Saída do quadro inicial registrada — fundo atualizado."));
  } catch (erro) {
    console.error(erro);
    mostrarToast("Saída salva, mas houve um problema ao atualizar a tela.", "erro");
  }
});

document.getElementById("lista-saidas-iniciais").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-remover-saida-inicial]");
  if (!btn) return;

  const idx = Number(btn.dataset.removerSaidaInicial);
  const saidaRemovida = (contratoEmEdicao.saidasIniciais || [])[idx];
  const qtdRemovida = quantidadeDoRegistro(saidaRemovida);
  const novaLista = (contratoEmEdicao.saidasIniciais || []).filter((_, i) => i !== idx);
  const resultado = await confirmarEAplicarMovimentacao({
    idContrato: contratoFuncionariosAberto,
    contratoBase: contratoEmEdicao,
    contratoDepois: { ...contratoEmEdicao, saidasIniciais: novaLista },
    tipo: "estorno_saida_inicial",
    descricaoEvento: `Saída de ${qtdRemovida} funcionário(s) do quadro inicial em ${formatarData(saidaRemovida?.data)} desfeita`,
    camposParaSalvar: { saidasIniciais: novaLista }
  });
  if (!resultado) return;
  try {
    await atualizarAposMovimentacao(mensagemResultado(resultado, "Saída removida — fundo atualizado."));
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível desfazer a saída.", "erro");
  }
});

/* ------------------------------------------------------------------ */
/* Entradas durante o contrato — mesma lógica, também sem nome          */
/* ------------------------------------------------------------------ */

function esconderFormNovaEntrada() {
  document.getElementById("form-nova-entrada").classList.add("hidden");
  document.getElementById("form-nova-entrada").reset();
  atualizarVisibilidadeBotoesFuncionarios();
}

document.getElementById("btn-nova-entrada").addEventListener("click", () => {
  document.getElementById("form-nova-entrada").classList.remove("hidden");
  document.getElementById("btn-nova-entrada").classList.add("hidden");
  document.getElementById("ne-data").value = new Date().toISOString().slice(0, 10);
  document.getElementById("ne-quantidade").value = "1";
});

document.getElementById("ne-botao-cancelar").addEventListener("click", esconderFormNovaEntrada);

document.getElementById("form-nova-entrada").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dataEntrada = document.getElementById("ne-data").value;
  const motivo = document.getElementById("ne-motivo").value.trim();
  const quantidade = Number(document.getElementById("ne-quantidade").value);
  if (!dataEntrada) return mostrarToast("Informe a data de entrada.", "erro");
  if (!Number.isInteger(quantidade) || quantidade < 1) return mostrarToast("Informe uma quantidade válida (1 ou mais).", "erro");

  const novaLista = [...(contratoEmEdicao.entradasContrato || []), { dataEntrada, dataSaida: null, motivo: motivo || null, quantidade }];
  const resultado = await confirmarEAplicarMovimentacao({
    idContrato: contratoFuncionariosAberto,
    contratoBase: contratoEmEdicao,
    contratoDepois: { ...contratoEmEdicao, entradasContrato: novaLista },
    tipo: "entrada",
    descricaoEvento: `${quantidade} funcionário(s) entraram durante o contrato em ${formatarData(dataEntrada)}${motivo ? ` (${motivo})` : ""}`,
    camposParaSalvar: { entradasContrato: novaLista }
  });
  if (!resultado) return;
  esconderFormNovaEntrada();
  try {
    await atualizarAposMovimentacao(mensagemResultado(resultado, "Entrada registrada — fundo atualizado."));
  } catch (erro) {
    console.error(erro);
    mostrarToast("Entrada salva, mas houve um problema ao atualizar a tela.", "erro");
  }
});

// Mini-form compartilhado para marcar a saída de UMA entrada específica (por índice).
let entradaEmEdicaoIndex = null;

function esconderFormSaidaEntrada() {
  entradaEmEdicaoIndex = null;
  document.getElementById("form-saida-entrada").classList.add("hidden");
  document.getElementById("form-saida-entrada").reset();
}

document.getElementById("se-botao-cancelar").addEventListener("click", esconderFormSaidaEntrada);

document.getElementById("form-saida-entrada").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = document.getElementById("se-data").value;
  if (!data) return mostrarToast("Informe a data de saída.", "erro");
  if (entradaEmEdicaoIndex === null) return;

  const entradaAlterada = (contratoEmEdicao.entradasContrato || [])[entradaEmEdicaoIndex];
  const qtdAlterada = quantidadeDoRegistro(entradaAlterada);
  const novaLista = (contratoEmEdicao.entradasContrato || []).map((en, i) =>
    i === entradaEmEdicaoIndex ? { ...en, dataSaida: data } : en
  );
  const resultado = await confirmarEAplicarMovimentacao({
    idContrato: contratoFuncionariosAberto,
    contratoBase: contratoEmEdicao,
    contratoDepois: { ...contratoEmEdicao, entradasContrato: novaLista },
    tipo: "saida_entrada",
    descricaoEvento: `Saída de ${qtdAlterada} funcionário(s) em ${formatarData(data)} (do lote que entrou em ${formatarData(entradaAlterada?.dataEntrada)})`,
    camposParaSalvar: { entradasContrato: novaLista }
  });
  if (!resultado) return;
  esconderFormSaidaEntrada();
  try {
    await atualizarAposMovimentacao(mensagemResultado(resultado, "Saída registrada — fundo atualizado."));
  } catch (erro) {
    console.error(erro);
    mostrarToast("Saída salva, mas houve um problema ao atualizar a tela.", "erro");
  }
});

document.getElementById("lista-entradas-contrato").addEventListener("click", async (e) => {
  const btnMarcar = e.target.closest("[data-marcar-saida-entrada]");
  if (btnMarcar) {
    entradaEmEdicaoIndex = Number(btnMarcar.dataset.marcarSaidaEntrada);
    document.getElementById("form-saida-entrada").classList.remove("hidden");
    document.getElementById("se-data").value = new Date().toISOString().slice(0, 10);
    return;
  }

  const btnRemover = e.target.closest("[data-remover-entrada]");
  if (btnRemover) {
    const idx = Number(btnRemover.dataset.removerEntrada);
    const entradaRemovida = (contratoEmEdicao.entradasContrato || [])[idx];
    const qtdRemovida = quantidadeDoRegistro(entradaRemovida);
    const novaLista = (contratoEmEdicao.entradasContrato || []).filter((_, i) => i !== idx);
    const resultado = await confirmarEAplicarMovimentacao({
      idContrato: contratoFuncionariosAberto,
      contratoBase: contratoEmEdicao,
      contratoDepois: { ...contratoEmEdicao, entradasContrato: novaLista },
      tipo: "remocao_entrada",
      descricaoEvento: `Registro de ${qtdRemovida} entrada(s) de ${formatarData(entradaRemovida?.dataEntrada)} removido`,
      camposParaSalvar: { entradasContrato: novaLista }
    });
    if (!resultado) return;
    try {
      await atualizarAposMovimentacao(mensagemResultado(resultado, "Registro removido — fundo atualizado."));
    } catch (erro) {
      console.error(erro);
      mostrarToast("Registro removido, mas houve um problema ao atualizar a tela.", "erro");
    }
  }
});

/* ------------------------------------------------------------------ */
/* Modais + logout                                                     */
/* ------------------------------------------------------------------ */

function abrirModal(id) {
  const el = document.getElementById(id);
  el.classList.remove("hidden");
  el.classList.add("flex");
}
function fecharModal(id) {
  const el = document.getElementById(id);
  el.classList.add("hidden");
  el.classList.remove("flex");
}

document.addEventListener("click", (e) => {
  const abrir = e.target.closest("[data-abrir-modal]");
  if (abrir) abrirModal(abrir.dataset.abrirModal);
  const fechar = e.target.closest("[data-fechar-modal]");
  if (fechar) {
    const modal = fechar.closest(".fixed.inset-0");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  if (e.target.classList.contains("bg-inverse-surface/40")) {
    e.target.classList.add("hidden");
    e.target.classList.remove("flex");
  }
});

document.getElementById("btn-sair-desktop").addEventListener("click", fazerLogout);
document.getElementById("btn-sair-mobile").addEventListener("click", fazerLogout);
