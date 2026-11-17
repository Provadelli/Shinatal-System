// Shinatal — serviço compartilhado de recálculo/publicação do Fundo Shinatal.
// Usado por gestao.js e contratos.js sempre que uma mutação (colaborador ou contrato
// empresarial/CNPJ) puder afetar o saldo do fundo ou o número de colaboradores mostrado
// publicamente na landing page. Contrato individual do colaborador (aba RH) nunca afeta
// nada aqui — é dado interno.
import { db } from "./firebase-init.js";
import {
  collection, doc, getDocs, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { montarAgregadosFundo } from "./calculo-shinatal.js";

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

  // Mesmo montador usado pelo script de migração (backend/scripts/recalcular-regra-v2.mjs).
  // "Colaboradores" públicos = headcount atual dos contratos empresariais (sem PII, sem contrato
  // individual); `arrecadado` público = saldo líquido, o mesmo exibido na gestão.
  const { fundo, publico } = montarAgregadosFundo(contratosEmpresariais, usuarios, anoExercicio);

  await setDoc(doc(db, "fundo", String(anoExercicio)), {
    ...fundo,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: atualizadoPorUid
  });

  await setDoc(doc(db, "estatisticas", "publico"), {
    ...publico,
    atualizadoEm: serverTimestamp()
  }, { merge: true });

  return { saldoDisponivel: fundo.saldoDisponivel, somaPesos: fundo.somaPesos, contratosEmpresariais };
}

export { carregarContratosEmpresariais, recalcularEPublicarFundo };
