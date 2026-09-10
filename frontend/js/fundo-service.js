// Shinatal — serviço compartilhado de recálculo/publicação do Fundo Shinatal.
// Usado por gestao.js e contratos.js sempre que uma mutação (colaborador ou contrato
// empresarial/CNPJ) puder afetar o saldo do fundo ou o número de colaboradores mostrado
// publicamente na landing page. Contrato individual do colaborador (aba RH) nunca afeta
// nada aqui — é dado interno.
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
 *
 * O contrato individual do colaborador (coleção `contratos`, aba RH) é dado interno — não
 * entra em NENHUMA contagem aqui (nem valor, nem quantidade de funcionários/contratos). A
 * única fonte, para tudo isto, é `contratosEmpresariais` (aba "Contratos").
 * @param {{usuarios: object[], anoExercicio: number, atualizadoPorUid: string}} params
 */
async function recalcularEPublicarFundo({ usuarios, anoExercicio, atualizadoPorUid }) {
  const contratosEmpresariais = await carregarContratosEmpresariais();

  const { arrecadado, estornos, saldoDisponivel } = calcularFundo(contratosEmpresariais);
  const elegiveis = usuarios.filter((u) => verificarElegibilidade(u).elegivel);
  const somaPesos = elegiveis.reduce((soma, u) => soma + calcularPesoIndividual(u, anoExercicio), 0);

  await setDoc(doc(db, "fundo", String(anoExercicio)), {
    arrecadado, estornos, saldoDisponivel, somaPesos,
    totalContratosAtivos: contratosEmpresariais.filter((c) => c.status === "ativo").length,
    totalContratosEncerrados: contratosEmpresariais.filter((c) => c.status === "encerrado").length,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: atualizadoPorUid
  });

  // Agregado público (sem PII) para o card da landing page (index.html), lido sem login.
  // "Colaboradores" é só o headcount atual de cada contrato empresarial (quadro inicial
  // líquido de saídas + entradas ainda ativas) — não soma contrato individual do colaborador.
  const colaboradores = contratosEmpresariais.reduce(
    (soma, ce) => soma + calcularResumoContratoEmpresarial(ce).qtdAtual, 0
  );

  await setDoc(doc(db, "estatisticas", "publico"), {
    arrecadado,
    colaboradores,
    atualizadoEm: serverTimestamp()
  }, { merge: true });

  return { saldoDisponivel, somaPesos, contratosEmpresariais };
}

export { carregarContratosEmpresariais, recalcularEPublicarFundo };
