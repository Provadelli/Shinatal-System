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
import { calcularCotaColaborador } from "./calculo-shinatal.js";
import { renderizarPerfilDetalhado } from "./perfil-view.js";

const ANO_EXERCICIO = new Date().getFullYear();

// null = qualquer papel autenticado e com e-mail verificado pode acessar esta página.
const perfil = await exigirAutenticacao(null);
ativarRevelacaoAoRolar();
sincronizarAlturaHeader();

// "Voltar ao painel" leva ao painel certo do papel de quem está logado.
document.querySelectorAll("[data-link-voltar]").forEach((a) => {
  a.href = PAGINA_POR_ROLE[perfil.role] || "/login";
});

renderizarPerfilBasico(perfil);

const dados = await carregarRegistrosDoColaborador(perfil.uid);

// Mesmo padrão do dashboard.js: fundo/{ano} e condutaContagem/{uid} atualizam o mesmo bloco
// "Perfil detalhado" de forma independente, cada um com seu próprio listener do Firestore.
let fundoAtual = { saldoDisponivel: 0, somaPesos: 0 };
let resultadoAtual = null;
let contagemCondutaAtual = null;

function atualizarPerfilDetalhado() {
  if (!resultadoAtual) return;
  renderizarPerfilDetalhado(document.getElementById("perfil-detalhado"), {
    usuario: perfil, dados, resultado: resultadoAtual, somaPesos: fundoAtual.somaPesos || 0,
    anoExercicio: ANO_EXERCICIO, contagemConduta: contagemCondutaAtual
    // Sem tiposExcluiveis/aoExcluir: página de autoatendimento não expõe exclusão de lançamentos,
    // nem para admin/dp/rh/presidente vendo o próprio perfil.
  });
}

onSnapshot(doc(db, "fundo", String(ANO_EXERCICIO)), (snap) => {
  fundoAtual = snap.exists() ? snap.data() : { saldoDisponivel: 0, somaPesos: 0 };
  resultadoAtual = calcularCotaColaborador(
    perfil, dados, fundoAtual.saldoDisponivel || 0, fundoAtual.somaPesos || 0, ANO_EXERCICIO
  );
  atualizarPerfilDetalhado();
});

onSnapshot(doc(db, "condutaContagem", perfil.uid), (snap) => {
  contagemCondutaAtual = snap.exists() ? snap.data() : null;
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
    mostrarToast("Foto atualizada!", "sucesso");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível atualizar sua foto agora. Tente novamente.", "erro");
  } finally {
    inputFoto.value = "";
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
    mostrarToast("Link enviado! Confira seu e-mail institucional.", "sucesso");
    iniciarContagemReenvio("btn-trocar-senha", 60);
  } catch (erro) {
    mostrarToast("Não foi possível enviar o link agora. Tente novamente.", "erro");
  }
});

document.getElementById("btn-sair-desktop").addEventListener("click", fazerLogout);
document.getElementById("btn-sair-mobile").addEventListener("click", fazerLogout);
