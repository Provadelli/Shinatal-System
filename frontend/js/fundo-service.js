// Shinatal — serviço compartilhado de recálculo/publicação do Fundo Shinatal.
// Usado por gestao.js e contratos.js sempre que uma mutação (colaborador, contrato
// por ativação, ou contrato empresarial/CNPJ) puder afetar o saldo do fundo ou o
// número de colaboradores mostrado publicamente na landing page.
import { db } from "./firebase-init.js";
import {
  collection, doc, getDocs, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { calcularFundo, calcularPesoIndividual, verificarElegibilidade, calcularResumoContratoEmpresarial } from "./calculo-shinatal.js";

/**
 * Carrega os contratos empresariais. Cada documento já carrega seu próprio
 * `quantidadeFuncionariosIniciais`/`saidasIniciais`/`entradasContrato` — sem subcoleção.
 */
async function carregarContratosEmpresariais() {
  const snap = await getDocs(collection(db, "contratosEmpresariais"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Recalcula o saldo do Fundo Shinatal e publica os agregados em `fundo/{ano}` (uso interno,
 * dashboards dos colaboradores) e `estatisticas/publico` (landing page, sem login).
 * @param {{usuarios: object[], contratos: object[], anoExercicio: number, atualizadoPorUid: string}} params
 */
async function recalcularEPublicarFundo({ usuarios, contratos, anoExercicio, atualizadoPorUid }) {
  const contratosEmpresariais = await carregarContratosEmpresariais();

  const { arrecadado, estornos, saldoDisponivel } = calcularFundo(contratosEmpresariais);
  const elegiveis = usuarios.filter((u) => verificarElegibilidade(u).elegivel);
  const somaPesos = elegiveis.reduce((soma, u) => soma + calcularPesoIndividual(u, anoExercicio), 0);

  await setDoc(doc(db, "fundo", String(anoExercicio)), {
    arrecadado, estornos, saldoDisponivel, somaPesos,
    totalContratosAtivos: contratos.filter((c) => c.status === "ativo").length,
    totalContratosEncerrados: contratos.filter((c) => c.status === "encerrado").length,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: atualizadoPorUid
  });

  // Agregado público (sem PII) para o card da landing page (index.html), lido sem login.
  // "Colaboradores" soma o quadro próprio ativo (por CONTRATO, não por conta de usuário — uma
  // conta cadastrada/logada sem contrato ativo, ou de Presidente/Admin/DP/RH, não deve inflar
  // essa contagem) + o headcount atual de cada contrato empresarial (quadro inicial líquido de
  // saídas + entradas ainda ativas).
  const colaboradoresAtivos = contratos.filter((c) => c.status === "ativo").length;
  const colaboradoresPorContratosEmpresariais = contratosEmpresariais.reduce(
    (soma, ce) => soma + calcularResumoContratoEmpresarial(ce).qtdAtual, 0
  );

  await setDoc(doc(db, "estatisticas", "publico"), {
    arrecadado,
    colaboradores: colaboradoresAtivos + colaboradoresPorContratosEmpresariais,
    atualizadoEm: serverTimestamp()
  }, { merge: true });

  return { saldoDisponivel, somaPesos, contratosEmpresariais };
}

export { carregarContratosEmpresariais, recalcularEPublicarFundo };
