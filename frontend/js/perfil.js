// Shinatal — página dedicada "Meu perfil": foto, senha e histórico, para qualquer papel.
import { db } from "./firebase-init.js";
import {
  collection, query, where, getDocs, doc, onSnapshot, updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao, fazerLogout, enviarLinkRedefinicaoSenha, PAGINA_POR_ROLE } from "./auth.js";
import {
  formatarData, formatarJornadaSemanal, mostrarToast, iniciarContagemReenvio,
  ativarRevelacaoAoRolar, sincronizarAlturaHeader, construirAvatarHTML, redimensionarImagemParaBase64
} from "./ui-utils.js";
import { calcularCotaColaborador } from "./calculo-shinatal.js?v=v2-2026-11c";
import { renderizarPerfilDetalhado } from "./perfil-view.js";
import { ENCARREGADO, CONTROLADORA, linkEncarregado } from "./lgpd-config.js";
import { gerarPdfMeusDados } from "./meus-dados-pdf.js";
import { buscarRespostas, avaliacoesConcluidas } from "./avaliacao-service.js";

/** Respostas sobre a própria pessoa num ciclo — só existem para ela depois das três avaliações. */
async function buscarRespostasRecebidas(ciclo) {
  if (!avaliacoesConcluidas(ciclo)) return [];
  const respostas = await buscarRespostas(ciclo);
  return Object.values(respostas).filter(Boolean);
}
import { getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const ANO_EXERCICIO = new Date().getFullYear();

// null = qualquer papel autenticado e com e-mail verificado pode acessar esta página.
const perfil = await exigirAutenticacao(null);
ativarRevelacaoAoRolar();
sincronizarAlturaHeader();


renderizarPerfilBasico(perfil);

const dados = await carregarRegistrosDoColaborador(perfil.uid);

// Mesmo padrão do dashboard.js: fundo/{ano} atualiza o bloco "Perfil detalhado" ao vivo.
let fundoAtual = { saldoDisponivel: 0, somaPesos: 0 };
let resultadoAtual = null;

function atualizarPerfilDetalhado() {
  if (!resultadoAtual) return;
  renderizarPerfilDetalhado(document.getElementById("perfil-detalhado"), {
    usuario: perfil, dados, resultado: resultadoAtual, somaPesos: fundoAtual.somaPesos || 0,
    anoExercicio: ANO_EXERCICIO
    // Sem tiposExcluiveis/aoExcluir: página de autoatendimento não expõe exclusão de lançamentos,
    // nem para admin/dp/rh/presidente vendo o próprio perfil.
  });
}

onSnapshot(doc(db, "fundo", String(ANO_EXERCICIO)), (snap) => {
  fundoAtual = snap.exists() ? snap.data() : { saldoDisponivel: 0, somaPesos: 0 };
  resultadoAtual = calcularCotaColaborador(
    perfil, dados, fundoAtual.saldoDisponivel || 0, fundoAtual.somaPesos || 0, ANO_EXERCICIO, fundoAtual.somaPesosAjustados || 0
  );
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

function renderizarPerfilBasico(p) {
  document.getElementById("avatar-perfil").innerHTML = construirAvatarHTML(p);
  document.getElementById("perfil-nome").textContent = p.nome || "—";
  document.getElementById("perfil-cargo").textContent = p.cargo ? `${p.cargo} · ${formatarJornadaSemanal(p.cargaHoraria)}` : "—";
  document.getElementById("perfil-email").textContent = p.email || "—";
  document.getElementById("perfil-admissao").textContent = p.dataAdmissao
    ? `Admissão em ${formatarData(p.dataAdmissao)}`
    : "—";
}

/* ------------------------------------------------------------------ */
/* Foto de perfil                                                      */
/* ------------------------------------------------------------------ */

const inputFoto = document.getElementById("input-foto-perfil");

inputFoto.addEventListener("change", async () => {
  const arquivo = inputFoto.files[0];
  if (!arquivo) return;
  if (!arquivo.type.startsWith("image/")) {
    mostrarToast("Selecione um arquivo de imagem válido.", "erro");
    inputFoto.value = "";
    return;
  }
  try {
    const fotoBase64 = await redimensionarImagemParaBase64(arquivo, { tamanhoMax: 256, qualidade: 0.8 });
    await updateDoc(doc(db, "usuarios", perfil.uid), { fotoBase64 });
    perfil.fotoBase64 = fotoBase64;
    document.getElementById("avatar-perfil").innerHTML = construirAvatarHTML(perfil);
    renderizarMeusDados();
    mostrarToast("Foto atualizada!", "sucesso");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível atualizar sua foto agora. Tente novamente.", "erro");
  } finally {
    inputFoto.value = "";
  }
});

/* ------------------------------------------------------------------ */
/* Meus dados (LGPD, art. 18)                                          */
/* ------------------------------------------------------------------ */

/** Timestamp do Firestore (ou Date) → texto ISO, para o arquivo exportado ser legível. */
function paraJson(valor) {
  if (valor && typeof valor.toDate === "function") return valor.toDate().toISOString();
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) return valor.map(paraJson);
  if (valor && typeof valor === "object") return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, paraJson(v)]));
  return valor;
}

function dataDoAceite(aceite) {
  const d = aceite?.aceitoEm?.toDate ? aceite.aceitoEm.toDate() : aceite?.aceitoEm instanceof Date ? aceite.aceitoEm : null;
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : null;
}

function renderizarMeusDados() {
  const quando = dataDoAceite(perfil.aceiteTermos);
  document.getElementById("perfil-aceite").textContent = perfil.aceiteTermos?.versao
    ? `Você aceitou os Termos de Uso e a Política de Privacidade (versão ${perfil.aceiteTermos.versao})${quando ? ` em ${quando}` : ""}.`
    : "";
  document.getElementById("email-encarregado").textContent = ENCARREGADO.email;
  document.getElementById("link-pedido-titular").href = linkEncarregado(`Pedido do titular — ${perfil.nome || perfil.email}`);
  document.getElementById("btn-remover-foto").classList.toggle("hidden", !perfil.fotoBase64);
}
renderizarMeusDados();

// Acesso e portabilidade (art. 18, II e V): tudo o que o sistema guarda sobre a pessoa e que ela
// mesma pode ler (as firestore.rules já limitam cada leitura ao próprio titular).
document.getElementById("btn-baixar-dados").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const docsDe = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const [contratos, votosDados, contagemRecebida, ciclos, respostasQueVoceDeu, respostasAoPresidente] = await Promise.all([
      buscarPorUid("contratos", perfil.uid),
      getDocs(query(collection(db, "votosConduta"), where("avaliadorUid", "==", perfil.uid))).then(docsDe),
      getDoc(doc(db, "condutaContagem", perfil.uid)).then((s) => (s.exists() ? s.data() : null)),
      buscarPorUid("ciclosAvaliacao", perfil.uid).catch(() => []),
      getDocs(query(collection(db, "respostasAvaliacao"), where("avaliadorUid", "==", perfil.uid))).then(docsDe).catch(() => []),
      buscarPorUid("respostasAoPresidente", perfil.uid).catch(() => [])
    ]);
    // Avaliações sobre a pessoa: as regras só liberam a leitura depois das duas avaliações.
    const respostasRecebidas = (await Promise.all(ciclos.map((c) =>
      buscarRespostasRecebidas(c).catch(() => [])
    ))).flat();
    const { uid, ...dadosPerfil } = perfil;
    const exportacao = paraJson({
      sobre: {
        sistema: "Shinatal — programa de premiação da Shine Rio",
        controladora: CONTROLADORA,
        encarregado: ENCARREGADO,
        geradoEm: new Date(),
        observacao: "Cópia dos seus dados pessoais no Shinatal (LGPD, art. 18). Senha não é guardada pelo sistema."
      },
      identificador: uid,
      perfil: dadosPerfil,
      faltas: dados.faltas,
      atrasos: dados.atrasos,
      advertencias: dados.advertencias,
      avaliacoesDeDesempenho: dados.avaliacoes,
      contratosIndividuais: contratos,
      processoDeAvaliacao: {
        ciclos,
        respostasRecebidas,
        respostasQueVoceDeu,
        respostasAoPresidente
      },
      avaliacaoDeConduta: {
        votosQueVoceDeu: votosDados,
        contagemRecebidaAnonima: contagemRecebida
      }
    });
    const arquivo = await gerarPdfMeusDados(exportacao);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(arquivo);
    link.download = `shinatal-meus-dados-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    mostrarToast("PDF com os seus dados baixado.", "sucesso");
  } catch (erro) {
    console.error("[Shinatal] Falha ao exportar os dados:", erro);
    mostrarToast("Não foi possível gerar o arquivo agora. Tente novamente.", "erro");
  } finally {
    btn.disabled = false;
  }
});

// Revogação do consentimento da foto (art. 8º, §5º): a foto é opcional e sai na hora.
document.getElementById("btn-remover-foto").addEventListener("click", async () => {
  try {
    await updateDoc(doc(db, "usuarios", perfil.uid), { fotoBase64: null });
    perfil.fotoBase64 = null;
    document.getElementById("avatar-perfil").innerHTML = construirAvatarHTML(perfil);
    renderizarMeusDados();
    document.getElementById("btn-baixar-dados").focus();
    mostrarToast("Foto removida.", "sucesso");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível remover a foto agora. Tente novamente.", "erro");
  }
});

/* ------------------------------------------------------------------ */
/* Senha e logout                                                      */
/* ------------------------------------------------------------------ */

document.getElementById("btn-trocar-senha").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  try {
    await enviarLinkRedefinicaoSenha(perfil.email);
    mostrarToast("Link de redefinição enviado. Verifique seu e-mail institucional.", "sucesso");
    iniciarContagemReenvio("btn-trocar-senha", 60);
  } catch (erro) {
    mostrarToast("Não foi possível enviar o link agora. Tente novamente.", "erro");
  }
});

