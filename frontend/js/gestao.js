// Shinatal — painel de gestão (DP / RH / Admin).
import { db, firebaseConfig } from "./firebase-init.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, sendEmailVerification, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  onSnapshot, query, orderBy, limit, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao, fazerLogout, traduzirErroAuth } from "./auth.js";
import { formatarMoeda, formatarData, formatarDataHora, mostrarToast, animarNumero, confirmarAcao, ativarRevelacaoAoRolar } from "./ui-utils.js";
import {
  calcularCotaColaborador, calcularFundo, calcularPesoIndividual, verificarElegibilidade, calcularResumoContratoEmpresarial
} from "./calculo-shinatal.js";
import { recalcularEPublicarFundo as publicarFundo } from "./fundo-service.js";
import { renderizarPerfilDetalhado } from "./perfil-view.js";
import { criarSolicitacao } from "./solicitacoes-service.js";

const ANO_EXERCICIO = new Date().getFullYear();
const ROTULOS_ROLE = { admin: "Administrador", dp: "Departamento Pessoal", rh: "Recursos Humanos", presidente: "Presidente" };
const EH_PRESIDENTE = () => perfil.role === "presidente";
const EH_ADMIN_OU_PRESIDENTE = () => perfil.role === "admin" || perfil.role === "presidente";

const perfil = await exigirAutenticacao(["admin", "dp", "rh", "presidente"]);
ativarRevelacaoAoRolar();
document.getElementById("nome-desktop").textContent = perfil.nome || perfil.email;
document.getElementById("badge-role").innerHTML =
  `<span class="material-symbols-outlined text-base">shield_person</span> ${ROTULOS_ROLE[perfil.role] || perfil.role}`;

const state = {
  usuarios: [], contratos: [], contratosEmpresariais: [], mapaDados: {},
  fundo: { saldoDisponivel: 0, somaPesos: 0, totalContratosAtivos: null, totalContratosEncerrados: null, estornos: null }
};

// Envolvido em try/catch: uma falha aqui (ex.: rede, regra do Firestore) não pode impedir o
// resto do script — abaixo — de rodar e ligar os botões/modais da página.
try {
  await carregarTudo();
  renderTudo();
  await recalcularEPublicarFundo(); // também publica os números públicos da landing page
} catch (erro) {
  console.error("[Shinatal] Falha ao carregar o painel de gestão:", erro);
  mostrarToast("Não foi possível carregar todos os dados. Alguns números podem estar desatualizados.", "erro");
}

/* ------------------------------------------------------------------ */
/* Carregamento                                                        */
/* ------------------------------------------------------------------ */

async function carregarTudo() {
  const [usuariosSnap, contratosSnap, contratosEmpresariaisSnap, faltasSnap, atrasosSnap, advertenciasSnap, avaliacoesSnap] =
    await Promise.all([
      getDocs(collection(db, "usuarios")),
      getDocs(collection(db, "contratos")),
      getDocs(collection(db, "contratosEmpresariais")),
      getDocs(collection(db, "faltas")),
      getDocs(collection(db, "atrasos")),
      getDocs(collection(db, "advertencias")),
      getDocs(collection(db, "avaliacoes"))
    ]);

  state.usuarios = usuariosSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  state.contratos = contratosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  state.contratosEmpresariais = contratosEmpresariaisSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  state.mapaDados = {};
  for (const u of state.usuarios) state.mapaDados[u.uid] = { faltas: [], atrasos: [], advertencias: [], avaliacoes: [] };
  distribuir(faltasSnap, "faltas");
  distribuir(atrasosSnap, "atrasos");
  distribuir(advertenciasSnap, "advertencias");
  distribuir(avaliacoesSnap, "avaliacoes");

  function distribuir(snap, chave) {
    snap.docs.forEach((d) => {
      const dado = { id: d.id, ...d.data() };
      if (!state.mapaDados[dado.uid]) state.mapaDados[dado.uid] = { faltas: [], atrasos: [], advertencias: [], avaliacoes: [] };
      state.mapaDados[dado.uid][chave].push(dado);
    });
  }

  const { saldoDisponivel } = calcularFundo(state.contratos, state.contratosEmpresariais);
  const elegiveis = state.usuarios.filter((u) => verificarElegibilidade(u).elegivel);
  const somaPesos = elegiveis.reduce((soma, u) => soma + calcularPesoIndividual(u, ANO_EXERCICIO), 0);
  state.fundo = { saldoDisponivel, somaPesos };
}

/** Recalcula e publica o agregado do fundo em `fundo/{ano}` para os dashboards dos colaboradores. */
async function recalcularEPublicarFundo() {
  const resultado = await publicarFundo({
    usuarios: state.usuarios, contratos: state.contratos, anoExercicio: ANO_EXERCICIO, atualizadoPorUid: perfil.uid
  });
  state.fundo = { saldoDisponivel: resultado.saldoDisponivel, somaPesos: resultado.somaPesos };
  state.contratosEmpresariais = resultado.contratosEmpresariais;
}

/* ------------------------------------------------------------------ */
/* Renderização                                                        */
/* ------------------------------------------------------------------ */

function renderTudo() {
  renderFundoCard();
  renderDiretorio();
  renderContratosResumo();
  popularSelects();
  filtrarAcoesPorRole();
}

function renderFundoCard() {
  const el = document.getElementById("fundo-saldo");
  el.classList.remove("skeleton", "w-40", "h-9");
  animarNumero(el, state.fundo.saldoDisponivel, { formatador: formatarMoeda });
  const ativos = state.fundo.totalContratosAtivos ?? state.contratos.filter((c) => c.status === "ativo").length;
  document.getElementById("fundo-detalhe").textContent = `${ativos} contratos ativos · Exercício ${ANO_EXERCICIO}`;
}

function computarResultado(usuario) {
  const dados = state.mapaDados[usuario.uid] || { faltas: [], atrasos: [], advertencias: [], avaliacoes: [] };
  return calcularCotaColaborador(usuario, dados, state.fundo.saldoDisponivel, state.fundo.somaPesos, ANO_EXERCICIO);
}

function renderDiretorio(filtro = "") {
  const corpo = document.getElementById("corpo-diretorio");
  const termo = filtro.trim().toLowerCase();
  const usuarios = state.usuarios
    .filter((u) => !termo || (u.nome || "").toLowerCase().includes(termo) || (u.cargo || "").toLowerCase().includes(termo))
    .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

  if (!usuarios.length) {
    corpo.innerHTML = `<tr><td colspan="7" class="py-8 text-center font-body text-on-surface-variant">Nenhum colaborador encontrado.</td></tr>`;
    return;
  }

  corpo.innerHTML = usuarios.map((u) => {
    const resultado = computarResultado(u);
    const iniciais = (u.nome || "?").trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
    const avatar = u.fotoBase64
      ? `<img src="${u.fotoBase64}" class="w-full h-full object-cover" alt="" />`
      : iniciais;
    const cotaLabel = resultado.elegivel ? formatarMoeda(resultado.cotaFinal) : "Inelegível";
    const totalFaltas = (state.mapaDados[u.uid]?.faltas || []).length;
    const totalAdvertencias = (state.mapaDados[u.uid]?.advertencias || []).length;
    // Participação = peso individual ÷ soma de pesos de todos os elegíveis (Seção 6). Mostrar
    // isso aqui é o jeito mais rápido de auditar por que alguém está "levando" a maior parte do
    // fundo: se o percentual estiver muito acima do esperado, o problema está nos dados de
    // admissão/jornada de OUTROS colaboradores (peso zerado ou ano de admissão errado), não na
    // fórmula — a divisão em si (cotaBase = peso/somaPesos × saldo) segue a Seção 6 à risca.
    const participacaoPct = state.fundo.somaPesos > 0 ? (resultado.pesoIndividual / state.fundo.somaPesos) * 100 : 0;
    return `
      <tr class="border-b border-outline-variant/50 hover:bg-surface-container-lowest/60 transition-colors">
        <td class="py-3 px-3">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-display font-bold text-xs overflow-hidden shrink-0">${avatar}</div>
            <div>
              <p class="font-body font-medium text-on-surface leading-tight">${u.nome || "—"}</p>
              <p class="font-body text-label-sm text-on-surface-variant leading-tight">${ROTULOS_ROLE[u.role] || "Colaborador"}</p>
            </div>
          </div>
        </td>
        <td class="py-3 px-3 font-body text-body-md text-on-surface-variant">${u.cargo || "—"} <span class="text-label-sm">(${u.cargaHoraria || "-"}h)</span></td>
        <td class="py-3 px-3 text-center font-body text-body-md ${totalFaltas ? "text-christmas-red font-semibold" : "text-on-surface-variant"}">${totalFaltas}</td>
        <td class="py-3 px-3 text-center font-body text-body-md ${totalAdvertencias ? "text-christmas-red font-semibold" : "text-on-surface-variant"}">${totalAdvertencias}</td>
        <td class="py-3 px-3 text-center font-body text-body-md text-on-surface-variant" title="Peso bruto: ${resultado.pesoIndividual.toFixed(3)} de ${state.fundo.somaPesos.toFixed(3)} no total">${participacaoPct.toFixed(1)}%</td>
        <td class="py-3 px-3 font-body text-body-md ${resultado.elegivel ? "text-on-surface" : "text-christmas-red"}">${cotaLabel}</td>
        <td class="py-3 px-3 text-right whitespace-nowrap">
          ${EH_ADMIN_OU_PRESIDENTE() ? `
          <button data-ver-perfil-uid="${u.uid}" title="Ver perfil" aria-label="Ver perfil" class="text-on-surface-variant hover:text-primary transition-colors p-1">
            <span class="material-symbols-outlined">person</span>
          </button>
          <button data-editar-uid="${u.uid}" title="Editar colaborador" aria-label="Editar colaborador" class="text-on-surface-variant hover:text-primary transition-colors p-1">
            <span class="material-symbols-outlined">edit</span>
          </button>` : ""}
          <button data-acao-uid="${u.uid}" title="Registrar ação" aria-label="Registrar ação" class="text-primary hover:text-on-primary-container transition-colors p-1">
            <span class="material-symbols-outlined">edit_note</span>
          </button>
          ${EH_ADMIN_OU_PRESIDENTE() ? `
          <button data-excluir-uid="${u.uid}" title="Excluir colaborador" aria-label="Excluir colaborador" class="text-christmas-red hover:opacity-70 transition-opacity p-1">
            <span class="material-symbols-outlined">delete</span>
          </button>` : ""}
        </td>
      </tr>`;
  }).join("");
}

/* Linka o card "Status de contratos" com a tela dedicada de Contratos Empresariais
   (contratos.html): mostra a contagem e o total líquido creditado por eles, com atalho. */
function renderContratosResumo() {
  const ativos = state.fundo.totalContratosAtivos ?? state.contratos.filter((c) => c.status === "ativo").length;
  const encerrados = state.fundo.totalContratosEncerrados ?? state.contratos.filter((c) => c.status === "encerrado").length;
  const estornos = state.fundo.estornos ?? calcularFundo(state.contratos).estornos;

  const totalContratosEmp = state.contratosEmpresariais.length;
  const totalCreditadoEmp = state.contratosEmpresariais.reduce(
    (soma, c) => soma + calcularResumoContratoEmpresarial(c).totalCreditadoFundo, 0
  );
  const blocoContratosEmpresariais = `
    <div class="flex justify-between items-center p-3 border border-outline-variant rounded-lg">
      <div>
        <p class="font-body font-bold text-on-surface">Contratos empresariais</p>
        <p class="font-body text-label-sm text-on-surface-variant">Creditado ao fundo: ${formatarMoeda(totalCreditadoEmp)}</p>
        <a href="/contratos" class="font-body text-label-sm text-rio-deep-blue hover:underline mt-1 inline-flex items-center gap-1">
          ${perfil.role === "admin" ? "Ver planilha de contratos" : "Ver contratos"} <span class="material-symbols-outlined text-xs">arrow_forward</span>
        </a>
      </div>
      <span class="font-display text-headline-md text-rio-deep-blue">${totalContratosEmp}</span>
    </div>`;

  document.getElementById("resumo-contratos").innerHTML = `
    <div class="flex justify-between items-center p-3 border border-outline-variant rounded-lg">
      <div><p class="font-body font-bold text-on-surface">Contratos ativos</p><p class="font-body text-label-sm text-on-surface-variant">Contribuindo com o fundo</p></div>
      <span class="font-display text-headline-md text-primary">${ativos}</span>
    </div>
    <div class="flex justify-between items-center p-3 border border-outline-variant rounded-lg">
      <div><p class="font-body font-bold text-on-surface">Contratos encerrados</p><p class="font-body text-label-sm text-on-surface-variant">Total de estornos: ${formatarMoeda(estornos)}</p></div>
      <span class="font-display text-headline-md text-christmas-red">${encerrados}</span>
    </div>${blocoContratosEmpresariais}`;
}

function popularSelects() {
  const opcoes = state.usuarios
    .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""))
    .map((u) => `<option value="${u.uid}">${u.nome} — ${u.cargo || ""}</option>`).join("");
  document.getElementById("acao-uid").innerHTML = `<option value="">Selecione...</option>${opcoes}`;
  document.getElementById("sim-colaborador").innerHTML = `<option value="">Selecione um colaborador...</option>${opcoes}`;
}

/* Mostra só as ações/tipos permitidos ao papel do usuário logado. */
function filtrarAcoesPorRole() {
  document.querySelectorAll(".acao-rapida").forEach((btn) => {
    const roles = btn.dataset.roles.split(",");
    btn.classList.toggle("hidden", !roles.includes(perfil.role));
  });
  document.querySelectorAll("#acao-tipo option").forEach((opt) => {
    const roles = (opt.dataset.roles || "").split(",");
    opt.classList.toggle("hidden", !roles.includes(perfil.role));
    opt.disabled = !roles.includes(perfil.role);
  });
  const primeiraPermitida = [...document.querySelectorAll("#acao-tipo option")].find((o) => !o.disabled);
  if (primeiraPermitida) document.getElementById("acao-tipo").value = primeiraPermitida.value;

  // Log de atividade — só o Admin (e o Presidente, que enxerga tudo que o Admin enxerga).
  const vePrivilegiado = EH_ADMIN_OU_PRESIDENTE();
  document.getElementById("nav-log-desktop").classList.toggle("hidden", !vePrivilegiado);
  document.getElementById("nav-log-mobile").classList.toggle("hidden", !vePrivilegiado);

  // Solicitações — aba exclusiva do Presidente.
  document.getElementById("nav-solicitacoes-desktop").classList.toggle("hidden", !EH_PRESIDENTE());
  document.getElementById("nav-solicitacoes-mobile").classList.toggle("hidden", !EH_PRESIDENTE());

  // Aba/página Contratos, e "Novo colaborador" — só Admin/Presidente (DP/RH perderam acesso).
  document.getElementById("nav-contratos-desktop").classList.toggle("hidden", !vePrivilegiado);
  document.getElementById("nav-contratos-mobile").classList.toggle("hidden", !vePrivilegiado);
  const btnNovoColaborador = document.getElementById("btn-novo-colaborador");
  btnNovoColaborador.classList.toggle("hidden", !vePrivilegiado);
  btnNovoColaborador.classList.toggle("flex", vePrivilegiado);
}

/* ------------------------------------------------------------------ */
/* Modal: Nova ação — campos dinâmicos                                 */
/* ------------------------------------------------------------------ */

const CAMPOS_POR_TIPO = {
  falta: ["data-generica", "justificada", "motivo"],
  atraso: ["data-generica", "atraso-horarios"],
  advertencia: ["data-generica", "tipo-advertencia", "motivo"],
  avaliacao: ["avaliacao", "motivo"],
  ativar_contrato: ["data-generica"],
  encerrar_contrato: ["contrato-ativo", "data-generica"],
  role: ["role"]
};

function alternarCamposAcao(tipo) {
  const todosOsCampos = ["data-generica", "justificada", "tipo-justificativa", "motivo", "atraso-horarios", "tipo-advertencia", "avaliacao", "role", "contrato-ativo"];
  todosOsCampos.forEach((campo) => {
    document.querySelectorAll(`[data-campo="${campo}"]`).forEach((el) => el.classList.add("hidden"));
  });
  (CAMPOS_POR_TIPO[tipo] || []).forEach((campo) => {
    document.querySelectorAll(`[data-campo="${campo}"]`).forEach((el) => el.classList.remove("hidden"));
  });
  document.getElementById("acao-data").placeholder = tipo === "ativar_contrato" ? "Data de ativação" : tipo === "encerrar_contrato" ? "Data de encerramento" : "Data";
}

// "Tipo de justificativa" só aparece quando o gestor marca "Falta justificada" — evita
// mostrar um campo de justificativa junto de uma falta que ainda vai descontar do fundo.
document.getElementById("acao-justificada").addEventListener("change", (e) => {
  document.querySelectorAll('[data-campo="tipo-justificativa"]').forEach((el) => el.classList.toggle("hidden", !e.target.checked));
});

function popularContratosAtivos(uid) {
  const ativos = state.contratos.filter((c) => c.uid === uid && c.status === "ativo");
  document.getElementById("acao-contrato").innerHTML = ativos.length
    ? ativos.map((c) => `<option value="${c.id}">Ativado em ${c.dataAtivacao}</option>`).join("")
    : `<option value="">Nenhum contrato ativo</option>`;
}

document.getElementById("acao-tipo").addEventListener("change", (e) => {
  alternarCamposAcao(e.target.value);
  renderLancamentosExistentesAcao();
});
document.getElementById("acao-uid").addEventListener("change", (e) => {
  popularContratosAtivos(e.target.value);
  renderLancamentosExistentesAcao();
});

const TITULOS_ACAO = {
  falta: "Lançar falta", atraso: "Lançar atraso", advertencia: "Registrar advertência",
  avaliacao: "Avaliação de desempenho", ativar_contrato: "Ativar contrato",
  encerrar_contrato: "Encerrar contrato", role: "Alterar papel (role)"
};

document.querySelectorAll("[data-nova-acao]").forEach((btn) => {
  btn.addEventListener("click", () => {
    abrirModal("modal-nova-acao");
    document.getElementById("form-nova-acao").reset();
    document.getElementById("acao-tipo").value = btn.dataset.novaAcao;
    document.getElementById("acao-titulo").textContent = TITULOS_ACAO[btn.dataset.novaAcao] || "Nova ação";
    alternarCamposAcao(btn.dataset.novaAcao);
    renderLancamentosExistentesAcao();
  });
});

document.getElementById("corpo-diretorio").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-acao-uid]");
  if (!btn) return;
  abrirModal("modal-nova-acao");
  document.getElementById("form-nova-acao").reset();
  const tipo = document.getElementById("acao-tipo").value;
  document.getElementById("acao-titulo").textContent = TITULOS_ACAO[tipo] || "Nova ação";
  document.getElementById("acao-uid").value = btn.dataset.acaoUid;
  popularContratosAtivos(btn.dataset.acaoUid);
  alternarCamposAcao(tipo);
  renderLancamentosExistentesAcao();
});

document.getElementById("lista-lancamentos-existentes").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-excluir-lancamento-acao]");
  if (!btn) return;
  excluirRegistro(btn.dataset.tipo, btn.dataset.id, btn.dataset.uid);
});

document.getElementById("busca-diretorio").addEventListener("input", (e) => renderDiretorio(e.target.value));

/* ------------------------------------------------------------------ */
/* Perfil (próprio ou de outro colaborador) — mesma vitrine do dashboard */
/* ------------------------------------------------------------------ */

// Quais tipos de lançamento cada papel pode apagar "por engano" (ver seção E do plano) —
// só quem participa de criar aquele tipo pode corrigi-lo.
const COLECAO_POR_TIPO_REGISTRO = { falta: "faltas", atraso: "atrasos", advertencia: "advertencias", avaliacao: "avaliacoes" };
const TIPOS_EXCLUIVEIS_POR_ROLE = {
  dp: ["falta", "atraso", "advertencia", "avaliacao"],
  admin: ["falta", "atraso", "advertencia", "avaliacao"],
  presidente: ["falta", "atraso", "advertencia", "avaliacao"],
  rh: ["avaliacao"]
};

let perfilAbertoUid = null;

async function excluirRegistro(tipo, id, uidAlvo = perfilAbertoUid) {
  const ok = await confirmarAcao({
    titulo: "Excluir lançamento",
    mensagem: "Excluir este lançamento (feito por engano)? Esta ação não pode ser desfeita.",
    textoConfirmar: "Excluir",
    perigo: true
  });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, COLECAO_POR_TIPO_REGISTRO[tipo], id));
    await registrarLog(tipo, `Lançamento de ${tipo} removido (correção)`, uidAlvo, null);
    await carregarTudo();
    renderTudo();
    if (perfilAbertoUid) abrirPerfil(perfilAbertoUid);
    renderLancamentosExistentesAcao();
    mostrarToast("Lançamento excluído.", "sucesso");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível excluir.", "erro");
  }
}

const ROTULOS_TIPO_ADVERTENCIA_ACAO = {
  verbal: "Advertência verbal", escrita: "Advertência escrita",
  suspensao1: "1ª suspensão", suspensao2: "2ª suspensão", suspensao3: "3ª suspensão"
};
const ROTULOS_CONCEITO_ACAO = { excelente: "Excelente", bom: "Bom", regular: "Regular", insatisfatorio: "Insatisfatório" };

function descreverLancamentoAcao(tipo, registro) {
  const data = formatarData(registro.data);
  if (tipo === "falta") return `${data} — ${registro.justificada ? "justificada" : "injustificada"}`;
  if (tipo === "atraso") return `${data} — ${registro.minutosAtraso ?? "?"} min de atraso`;
  if (tipo === "advertencia") return `${data} — ${ROTULOS_TIPO_ADVERTENCIA_ACAO[registro.tipo] || registro.tipo}`;
  if (tipo === "avaliacao") return `${data} — ${ROTULOS_CONCEITO_ACAO[registro.conceito] || registro.conceito}`;
  return data;
}

/* Lista compacta (só data + resumo) dos lançamentos já existentes do colaborador selecionado
   no modal "Registrar ação", com botão de excluir "por engano" — é por aqui que DP/RH corrigem
   lançamentos de OUTRO colaborador, já que eles não têm o ícone "ver perfil" de terceiros. */
function renderLancamentosExistentesAcao() {
  const secao = document.getElementById("acao-lancamentos-existentes");
  const lista = document.getElementById("lista-lancamentos-existentes");
  const tipo = document.getElementById("acao-tipo").value;
  const uid = document.getElementById("acao-uid").value;
  const chave = COLECAO_POR_TIPO_REGISTRO[tipo];
  if (!chave || !uid) {
    secao.classList.add("hidden");
    lista.innerHTML = "";
    return;
  }
  const registros = [...(state.mapaDados[uid]?.[chave] || [])].sort((a, b) => (a.data < b.data ? 1 : -1));
  const podeExcluir = (TIPOS_EXCLUIVEIS_POR_ROLE[perfil.role] || []).includes(tipo);
  secao.classList.remove("hidden");
  if (!registros.length) {
    lista.innerHTML = `<p class="font-body text-label-sm text-on-surface-variant">Nenhum lançamento ainda.</p>`;
    return;
  }
  lista.innerHTML = registros.map((r) => `
    <div class="flex items-center justify-between gap-2 bg-surface-container rounded-lg px-3 py-2">
      <span class="font-body text-label-sm text-on-surface">${descreverLancamentoAcao(tipo, r)}</span>
      ${podeExcluir ? `<button type="button" data-excluir-lancamento-acao data-tipo="${tipo}" data-id="${r.id}" data-uid="${uid}" title="Excluir (lançado por engano)" aria-label="Excluir lançamento" class="text-christmas-red hover:opacity-70 transition-opacity p-1 shrink-0">
        <span class="material-symbols-outlined text-lg">delete</span>
      </button>` : ""}
    </div>`).join("");
}

function abrirPerfil(uidAlvo) {
  const usuario = uidAlvo === perfil.uid ? perfil : state.usuarios.find((u) => u.uid === uidAlvo);
  if (!usuario) return;
  perfilAbertoUid = uidAlvo;
  document.getElementById("perfil-modal-titulo").textContent =
    uidAlvo === perfil.uid ? "Meu perfil" : `Perfil de ${usuario.nome || usuario.email}`;
  const dados = state.mapaDados[uidAlvo] || { faltas: [], atrasos: [], advertencias: [], avaliacoes: [] };
  const resultado = computarResultado(usuario);
  renderizarPerfilDetalhado(document.getElementById("perfil-detalhado"), {
    usuario, dados, resultado, somaPesos: state.fundo.somaPesos, anoExercicio: ANO_EXERCICIO,
    tiposExcluiveis: TIPOS_EXCLUIVEIS_POR_ROLE[perfil.role] || [],
    aoExcluir: excluirRegistro
  });
  abrirModal("modal-perfil");
}

document.getElementById("corpo-diretorio").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-ver-perfil-uid]");
  if (!btn) return;
  abrirPerfil(btn.dataset.verPerfilUid);
});

document.getElementById("nav-perfil-desktop").addEventListener("click", () => abrirPerfil(perfil.uid));
document.getElementById("nav-perfil-mobile").addEventListener("click", () => abrirPerfil(perfil.uid));

/* ------------------------------------------------------------------ */
/* Status de contratos — ao vivo, pra não depender de recarregar a     */
/* página quando outra aba/sessão ativa, encerra ou edita um contrato. */
/* ------------------------------------------------------------------ */

// Só leitura: nunca dispara recalcularEPublicarFundo()/gravações a partir daqui, senão várias
// abas abertas ao mesmo tempo entrariam em disputa de escrita redundante no mesmo agregado.
onSnapshot(doc(db, "fundo", String(ANO_EXERCICIO)), (snap) => {
  if (!snap.exists()) return;
  const dados = snap.data();
  state.fundo = {
    saldoDisponivel: dados.saldoDisponivel || 0,
    somaPesos: dados.somaPesos || 0,
    totalContratosAtivos: dados.totalContratosAtivos ?? 0,
    totalContratosEncerrados: dados.totalContratosEncerrados ?? 0,
    estornos: dados.estornos || 0
  };
  renderFundoCard();
  renderContratosResumo();
  renderDiretorio(document.getElementById("busca-diretorio")?.value || "");
});

onSnapshot(collection(db, "contratosEmpresariais"), (snap) => {
  state.contratosEmpresariais = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderContratosResumo();
});

/* ------------------------------------------------------------------ */
/* Log de atividade — só Admin (ver filtrarAcoesPorRole)                */
/* ------------------------------------------------------------------ */

/** Grava uma entrada imutável no log — chamado a partir de cada ação de gestão abaixo. */
async function registrarLog(tipo, descricao, alvoUid = null, alvoNome = null) {
  try {
    await addDoc(collection(db, "logs"), {
      tipo, descricao, alvoUid, alvoNome,
      operadorUid: perfil.uid, operadorNome: perfil.nome || perfil.email,
      criadoEm: serverTimestamp()
    });
  } catch (erro) {
    console.error("[Shinatal] Falha ao registrar log:", erro);
  }
}

if (EH_ADMIN_OU_PRESIDENTE()) {
  const qLog = query(collection(db, "logs"), orderBy("criadoEm", "desc"), limit(100));
  onSnapshot(qLog, (snap) => {
    const lista = document.getElementById("lista-log");
    if (!snap.size) {
      lista.innerHTML = `<li class="text-center py-6">Nenhuma ação registrada ainda.</li>`;
      return;
    }
    lista.innerHTML = snap.docs.map((d) => {
      const l = d.data();
      return `
        <li class="flex justify-between items-start gap-3 border-b border-outline-variant/20 pb-2">
          <div>
            <p class="text-on-surface font-medium">${l.descricao || l.tipo}</p>
            <p class="text-label-sm">${l.operadorNome || "—"}${l.alvoNome ? " → " + l.alvoNome : ""}</p>
          </div>
          <span class="text-label-sm whitespace-nowrap">${l.criadoEm ? formatarDataHora(l.criadoEm) : "—"}</span>
        </li>`;
    }).join("");
  });

  document.getElementById("btn-excluir-log").addEventListener("click", async () => {
    const ok = await confirmarAcao({
      titulo: "Excluir todo o log de atividade",
      mensagem: "Isso apaga PERMANENTEMENTE todo o histórico de ações registradas (faltas, atrasos, advertências, avaliações, papéis, colaboradores). Esta ação não pode ser desfeita.",
      textoConfirmar: "Excluir tudo",
      perigo: true
    });
    if (!ok) return;
    try {
      const snap = await getDocs(collection(db, "logs"));
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 450) {
        const lote = writeBatch(db);
        docs.slice(i, i + 450).forEach((d) => lote.delete(d.ref));
        await lote.commit();
      }
      // Registrado DEPOIS de excluir — vira a primeira entrada do log novo, preservando quem/quando limpou.
      await registrarLog("log_limpo", `Log de atividade excluído (${docs.length} registro(s) removido(s))`);
      mostrarToast("Log de atividade excluído.", "sucesso");
    } catch (erro) {
      console.error("[Shinatal] Falha ao excluir o log:", erro);
      mostrarToast("Não foi possível excluir o log.", "erro");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Solicitações — fila de aprovação (só o Presidente vê/decide)        */
/* ------------------------------------------------------------------ */

const ROTULOS_SOLICITACAO = {
  avaliacao: "Avaliação de desempenho",
  ativar_contrato: "Ativar contrato",
  encerrar_contrato: "Encerrar contrato",
  contrato_empresarial_criar: "Novo contrato empresarial",
  contrato_empresarial_editar: "Alteração em contrato empresarial",
  contrato_empresarial_excluir: "Exclusão de contrato empresarial"
};

/** Aplica de verdade uma solicitação aceita — despacha pra coleção certa conforme o tipo.
 * `dadosAcao` já vem pronto (mesmo payload que iria direto num addDoc/updateDoc/deleteDoc). */
async function aplicarSolicitacao(sol) {
  const d = sol.dadosAcao;
  if (sol.tipo === "avaliacao") {
    await addDoc(collection(db, "avaliacoes"), d);
  } else if (sol.tipo === "ativar_contrato") {
    await addDoc(collection(db, "contratos"), d);
  } else if (sol.tipo === "encerrar_contrato") {
    await updateDoc(doc(db, "contratos", d.contratoId), d.campos);
  } else if (sol.tipo === "contrato_empresarial_criar") {
    await addDoc(collection(db, "contratosEmpresariais"), d);
  } else if (sol.tipo === "contrato_empresarial_editar") {
    await updateDoc(doc(db, "contratosEmpresariais", d.docId), d.campos);
  } else if (sol.tipo === "contrato_empresarial_excluir") {
    await deleteDoc(doc(db, "contratosEmpresariais", d.docId));
  }
}

if (EH_PRESIDENTE()) {
  const qSolPendentes = query(collection(db, "solicitacoes"), where("status", "==", "pendente"), orderBy("criadoEm", "desc"));
  onSnapshot(qSolPendentes, (snap) => {
    const qtd = snap.size;
    [document.getElementById("badge-solicitacoes-desktop"), document.getElementById("badge-solicitacoes-mobile")].forEach((b) => {
      b.textContent = String(qtd);
      b.classList.toggle("hidden", qtd === 0);
    });

    const lista = document.getElementById("lista-solicitacoes");
    if (!qtd) {
      lista.innerHTML = `<li class="text-center py-6">Nenhuma solicitação pendente.</li>`;
      return;
    }
    lista.innerHTML = snap.docs.map((d) => {
      const s = d.data();
      return `
        <li class="border border-outline-variant rounded-lg p-4">
          <p class="font-body font-semibold text-on-surface">${ROTULOS_SOLICITACAO[s.tipo] || s.tipo}</p>
          <p class="font-body text-body-md text-on-surface-variant">${s.descricao}</p>
          <p class="font-body text-label-sm text-on-surface-variant mt-1">Pedido por ${s.solicitadoPorNome || "—"} em ${s.criadoEm ? formatarDataHora(s.criadoEm) : "—"}</p>
          <div class="flex gap-2 mt-3">
            <button data-aceitar-solicitacao="${d.id}" class="btn-primario flex-1 !py-2">Aceitar</button>
            <button data-rejeitar-solicitacao="${d.id}" class="btn-fantasma flex-1 !py-2">Rejeitar</button>
          </div>
        </li>`;
    }).join("");
  }, (erro) => {
    // Sem isso, uma falha aqui (ex.: índice composto do Firestore ausente) fica muda — a aba
    // simplesmente nunca preenche, sem nenhum aviso visível.
    console.error("[Shinatal] Falha ao carregar solicitações pendentes:", erro);
    mostrarToast("Não foi possível carregar as solicitações pendentes.", "erro");
  });

  document.getElementById("lista-solicitacoes").addEventListener("click", async (e) => {
    const btnAceitar = e.target.closest("[data-aceitar-solicitacao]");
    const btnRejeitar = e.target.closest("[data-rejeitar-solicitacao]");
    const btn = btnAceitar || btnRejeitar;
    if (!btn) return;
    const id = btn.dataset.aceitarSolicitacao || btn.dataset.rejeitarSolicitacao;
    btn.disabled = true;

    try {
      const solSnap = await getDoc(doc(db, "solicitacoes", id));
      if (!solSnap.exists() || solSnap.data().status !== "pendente") {
        mostrarToast("Essa solicitação já foi resolvida.", "erro");
        return;
      }
      const sol = solSnap.data();

      if (btnAceitar) {
        await aplicarSolicitacao(sol);
        await updateDoc(doc(db, "solicitacoes", id), { status: "aceita", resolvidoPorUid: perfil.uid, resolvidoEm: serverTimestamp() });
        await registrarLog(sol.tipo, `Solicitação aceita: ${sol.descricao}`, sol.alvoUid, sol.alvoNome);
        await carregarTudo();
        await recalcularEPublicarFundo();
        renderTudo();
        mostrarToast("Solicitação aceita e aplicada.", "sucesso");
      } else {
        await updateDoc(doc(db, "solicitacoes", id), { status: "rejeitada", resolvidoPorUid: perfil.uid, resolvidoEm: serverTimestamp() });
        mostrarToast("Solicitação rejeitada.", "sucesso");
      }
    } catch (erro) {
      console.error(erro);
      mostrarToast("Não foi possível concluir. Tente novamente.", "erro");
      btn.disabled = false;
    }
  });
}

/* Editar colaborador (nome, cargo, jornada, admissão) — a jornada define o % da cota
   (Seção 4.2 do regulamento: 8h=100%, 6h=75%, 4h=50%, já aplicado em calculo-shinatal.js). */
document.getElementById("corpo-diretorio").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-editar-uid]");
  if (!btn) return;
  const usuario = state.usuarios.find((u) => u.uid === btn.dataset.editarUid);
  if (!usuario) return;
  document.getElementById("ec-uid").value = usuario.uid;
  document.getElementById("ec-nome").value = usuario.nome || "";
  document.getElementById("ec-cargo").value = usuario.cargo || "";
  document.getElementById("ec-carga").value = usuario.cargaHoraria || 8;
  document.getElementById("ec-admissao").value = usuario.dataAdmissao || "";
  abrirModal("modal-editar-colaborador");
});

/* Excluir colaborador — só Admin (botão só é renderizado para esse role, mas a regra do
   Firestore em usuarios/{uid} também exige ehAdmin() para o delete). Remove o perfil do
   Firestore; a conta do Firebase Auth continua existindo até rodar
   `node scripts/excluir-usuario.js <email>` (Admin SDK, fora do alcance do cliente web). */
document.getElementById("corpo-diretorio").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-excluir-uid]");
  if (!btn) return;
  const usuario = state.usuarios.find((u) => u.uid === btn.dataset.excluirUid);
  if (!usuario) return;

  const ok = await confirmarAcao({
    titulo: "Excluir colaborador",
    mensagem: `Excluir "${usuario.nome || usuario.email}" do sistema? Ele perde o acesso imediatamente e some do diretório e do fundo. Esta ação não pode ser desfeita.`,
    textoConfirmar: "Excluir",
    perigo: true
  });
  if (!ok) return;

  try {
    await deleteDoc(doc(db, "usuarios", usuario.uid));
    await registrarLog("exclusao_colaborador", `Colaborador excluído do sistema`, usuario.uid, usuario.nome || usuario.email);
    mostrarToast("Colaborador excluído.", "sucesso");
    await carregarTudo();
    await recalcularEPublicarFundo();
    renderTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível excluir o colaborador.", "erro");
  }
});

document.getElementById("form-editar-colaborador").addEventListener("submit", async (e) => {
  e.preventDefault();
  const uid = document.getElementById("ec-uid").value;
  const nome = document.getElementById("ec-nome").value.trim();
  const cargo = document.getElementById("ec-cargo").value.trim();
  const cargaHoraria = Number(document.getElementById("ec-carga").value);
  const dataAdmissao = document.getElementById("ec-admissao").value;

  try {
    await updateDoc(doc(db, "usuarios", uid), { nome, cargo, cargaHoraria, dataAdmissao });
    await registrarLog("edicao_colaborador", `Dados de cadastro atualizados`, uid, nome);
    mostrarToast("Colaborador atualizado com sucesso!", "sucesso");
    fecharModal("modal-editar-colaborador");
    await carregarTudo();
    await recalcularEPublicarFundo(); // jornada afeta o peso do colaborador no rateio do fundo
    renderTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar as alterações.", "erro");
  }
});

/* ------------------------------------------------------------------ */
/* Submissão da ação                                                   */
/* ------------------------------------------------------------------ */

/** Minutos entre dois horários "HH:MM" do mesmo dia (nunca negativo). */
function minutosEntre(horarioEntrada, horarioChegada) {
  const [he, hc] = [horarioEntrada, horarioChegada].map((h) => (h || "00:00").split(":").map(Number));
  return Math.max(0, (hc[0] * 60 + hc[1]) - (he[0] * 60 + he[1]));
}

document.getElementById("form-nova-acao").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tipo = document.getElementById("acao-tipo").value;
  const uid = document.getElementById("acao-uid").value;
  if (!uid) return mostrarToast("Selecione um colaborador.", "erro");

  const data = document.getElementById("acao-data").value || new Date().toISOString().slice(0, 10);
  const motivo = document.getElementById("acao-motivo").value.trim();
  const alvoNome = state.usuarios.find((u) => u.uid === uid)?.nome || null;

  // Contratos e avaliação passam pela fila de aprovação do Presidente — exceto quando é o
  // próprio Presidente agindo, que grava direto (ver firestore.rules e o plano aprovado).
  const precisaAprovacao = !EH_PRESIDENTE() && ["avaliacao", "ativar_contrato", "encerrar_contrato"].includes(tipo);

  try {
    if (tipo === "falta") {
      const justificada = document.getElementById("acao-justificada").checked;
      await addDoc(collection(db, "faltas"), {
        uid, data, justificada,
        tipoJustificativa: document.getElementById("acao-tipo-justificativa").value || null,
        motivo, registradoPor: perfil.uid, criadoEm: serverTimestamp()
      });
      await registrarLog("falta", `Falta ${justificada ? "justificada" : "injustificada"} lançada em ${data}`, uid, alvoNome);
    } else if (tipo === "atraso") {
      const horarioEntrada = document.getElementById("acao-horario-entrada").value;
      const horarioAtraso = document.getElementById("acao-horario-atraso").value;
      const minutosAtraso = minutosEntre(horarioEntrada, horarioAtraso);
      await addDoc(collection(db, "atrasos"), {
        uid, data, horarioEntrada, horarioAtraso, minutosAtraso,
        registradoPor: perfil.uid, criadoEm: serverTimestamp()
      });
      await registrarLog("atraso", `Atraso de ${minutosAtraso}min lançado em ${data}${minutosAtraso >= 20 ? " (ponto)" : ""}`, uid, alvoNome);
    } else if (tipo === "advertencia") {
      const tipoAdvertencia = document.getElementById("acao-tipo-advertencia").value;
      await addDoc(collection(db, "advertencias"), {
        uid, data, tipo: tipoAdvertencia, motivo,
        registradoPor: perfil.uid, criadoEm: serverTimestamp()
      });
      await registrarLog("advertencia", `Advertência (${tipoAdvertencia}) registrada em ${data}`, uid, alvoNome);
    } else if (tipo === "avaliacao") {
      const dataAvaliacao = document.getElementById("acao-avaliacao-data").value;
      const ano = dataAvaliacao ? new Date(dataAvaliacao + "T00:00:00").getFullYear() : ANO_EXERCICIO;
      const conceito = document.getElementById("acao-conceito").value;
      const dadosAvaliacao = {
        uid, data: dataAvaliacao || null, ano,
        conceito, justificativa: motivo,
        validadoRH: true, avaliadoPor: perfil.uid, criadoEm: serverTimestamp()
      };
      const descricao = `Avaliação de desempenho (${conceito})${dataAvaliacao ? " em " + dataAvaliacao : ""} para ${alvoNome || uid}`;
      if (precisaAprovacao) {
        await criarSolicitacao(db, { tipo: "avaliacao", descricao, alvoUid: uid, alvoNome, dadosAcao: dadosAvaliacao, operador: perfil });
      } else {
        await addDoc(collection(db, "avaliacoes"), dadosAvaliacao);
        await registrarLog("avaliacao", descricao, uid, alvoNome);
      }
    } else if (tipo === "ativar_contrato") {
      const dadosContrato = {
        uid, dataAtivacao: data, dataEncerramento: null, valorCredito: 150, status: "ativo",
        registradoPor: perfil.uid, criadoEm: serverTimestamp()
      };
      const descricao = `Ativar contrato para ${alvoNome || uid} em ${data}`;
      if (precisaAprovacao) {
        await criarSolicitacao(db, { tipo: "ativar_contrato", descricao, alvoUid: uid, alvoNome, dadosAcao: dadosContrato, operador: perfil });
      } else {
        await addDoc(collection(db, "contratos"), dadosContrato);
      }
    } else if (tipo === "encerrar_contrato") {
      const contratoId = document.getElementById("acao-contrato").value;
      if (!contratoId) return mostrarToast("Este colaborador não possui contrato ativo.", "erro");
      const descricao = `Encerrar contrato de ${alvoNome || uid} em ${data}`;
      if (precisaAprovacao) {
        await criarSolicitacao(db, {
          tipo: "encerrar_contrato", descricao, alvoUid: uid, alvoNome,
          dadosAcao: { contratoId, campos: { status: "encerrado", dataEncerramento: data } },
          operador: perfil
        });
      } else {
        await updateDoc(doc(db, "contratos", contratoId), { status: "encerrado", dataEncerramento: data });
      }
    } else if (tipo === "role") {
      const novoRole = document.getElementById("acao-role").value;
      await updateDoc(doc(db, "usuarios", uid), { role: novoRole });
      await registrarLog("role", `Papel alterado para "${novoRole}"`, uid, alvoNome);
    }

    mostrarToast(precisaAprovacao ? "Solicitação enviada — aguardando aprovação do Presidente." : "Ação registrada com sucesso!", "sucesso");
    fecharModal("modal-nova-acao");
    await carregarTudo();
    if (!precisaAprovacao && ["ativar_contrato", "encerrar_contrato"].includes(tipo)) await recalcularEPublicarFundo();
    renderTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar. Verifique os dados e tente novamente.", "erro");
  }
});

/* ------------------------------------------------------------------ */
/* Novo colaborador (cria login sem derrubar a sessão atual)           */
/* ------------------------------------------------------------------ */

/** Gera uma senha aleatória de uso único (Web Crypto) — nunca é mostrada nem guardada; o
 * colaborador sempre define a própria senha pelo link de verificação + "Esqueci minha senha". */
function gerarSenhaTemporaria() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

document.getElementById("form-novo-colaborador").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("nc-nome").value.trim();
  const cargo = document.getElementById("nc-cargo").value.trim();
  const cargaHoraria = Number(document.getElementById("nc-carga").value);
  const email = document.getElementById("nc-email").value.trim().toLowerCase();
  const dataAdmissao = document.getElementById("nc-admissao").value;

  if (!email.endsWith("@shinerio.com")) return mostrarToast("Use um e-mail @shinerio.com.", "erro");

  const appSecundario = initializeApp(firebaseConfig, `operador-${Date.now()}`);
  const authSecundario = getAuth(appSecundario);
  try {
    // Senha aleatória de uso único — ninguém (nem o operador) chega a conhecê-la. O colaborador
    // confirma o e-mail (link enviado abaixo) e depois define a própria senha em "Esqueci minha
    // senha", exatamente como no autocadastro — sem senha padrão compartilhada.
    const cred = await createUserWithEmailAndPassword(authSecundario, email, gerarSenhaTemporaria());
    await setDoc(doc(db, "usuarios", cred.user.uid), {
      nome, cargo, cargaHoraria, email, role: "colaborador", status: "ativo",
      motivoPerdaIntegral: null, dataAdmissao, dataDesligamento: null, fotoBase64: null,
      criadoPor: perfil.uid, criadoEm: serverTimestamp()
    });
    await sendEmailVerification(cred.user);
    await signOut(authSecundario);
    await registrarLog("novo_colaborador", `Colaborador criado (${email})`, cred.user.uid, nome);
    mostrarToast(`Colaborador ${nome} criado. Enviamos um e-mail de confirmação — ele(a) deve clicar no link e depois usar "Esqueci minha senha" para definir o acesso.`, "sucesso");
    fecharModal("modal-novo-colaborador");
    e.target.reset();
    await carregarTudo();
    await recalcularEPublicarFundo(); // novo colaborador entra no rateio do fundo
    renderTudo();
  } catch (erro) {
    mostrarToast(traduzirErroAuth(erro), "erro");
  } finally {
    await deleteApp(appSecundario);
  }
});

/* ------------------------------------------------------------------ */
/* Simulador                                                           */
/* ------------------------------------------------------------------ */

function simular() {
  const uid = document.getElementById("sim-colaborador").value;
  const bloco = document.getElementById("sim-resultado");
  if (!uid) return bloco.classList.add("hidden");

  const usuario = state.usuarios.find((u) => u.uid === uid);
  const dadosReais = state.mapaDados[uid] || { faltas: [], atrasos: [], advertencias: [], avaliacoes: [] };
  const extraFaltas = Number(document.getElementById("sim-faltas").value) || 0;
  const extraPontos = Number(document.getElementById("sim-pontos").value) || 0;

  const dadosSimulados = {
    faltas: [...dadosReais.faltas],
    atrasos: [...dadosReais.atrasos],
    advertencias: dadosReais.advertencias,
    avaliacoes: dadosReais.avaliacoes
  };
  for (let i = 0; i < extraFaltas; i++) dadosSimulados.faltas.push({ data: `${ANO_EXERCICIO}-01-0${(i % 9) + 1}`, justificada: false });
  for (let m = 1; m <= extraPontos && m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    for (let d = 1; d <= 6; d++) dadosSimulados.atrasos.push({ data: `${ANO_EXERCICIO}-${mm}-0${d}`, minutosAtraso: 25 });
  }

  const atual = calcularCotaColaborador(usuario, dadosReais, state.fundo.saldoDisponivel, state.fundo.somaPesos, ANO_EXERCICIO);
  const simulado = calcularCotaColaborador(usuario, dadosSimulados, state.fundo.saldoDisponivel, state.fundo.somaPesos, ANO_EXERCICIO);

  document.getElementById("sim-atual").textContent = formatarMoeda(atual.cotaFinal);
  document.getElementById("sim-simulada").textContent = formatarMoeda(simulado.cotaFinal);
  bloco.classList.remove("hidden");
}

["sim-colaborador", "sim-faltas", "sim-pontos"].forEach((id) => document.getElementById(id).addEventListener("input", simular));

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
