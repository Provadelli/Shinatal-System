// Shinatal — serviço compartilhado de recálculo/publicação do Fundo Shinatal.
// Usado por gestao.js, contratos.js, solicitacoes.js e pela Avaliação de desempenho sempre que
// uma mutação puder mudar o saldo do fundo OU a divisão dele: contrato empresarial (CNPJ) que
// entra/sai, colaborador ativado/desligado, jornada, faltas, atrasos, advertências e avaliação.
// Contrato individual do colaborador (aba RH) nunca afeta nada aqui — é dado interno.
import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { montarAgregadosFundo } from "./calculo-shinatal.js?v=v2-2026-11c";

const COLECOES_LANCAMENTOS = ["faltas", "atrasos", "advertencias", "avaliacoes"];

/**
 * Carrega os contratos empresariais. Cada documento já carrega seu próprio
 * `quantidadeFuncionariosIniciais`/`saidasIniciais`/`entradasContrato` — sem subcoleção.
 */
async function carregarContratosEmpresariais() {
  const snap = await getDocs(collection(db, "contratosEmpresariais"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function carregarUsuarios() {
  const snap = await getDocs(collection(db, "usuarios"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

/** Lançamentos de todos, agrupados por uid — o peso ajustado de cada um depende deles. */
async function carregarMapaDados() {
  const snaps = await Promise.all(COLECOES_LANCAMENTOS.map((c) => getDocs(collection(db, c))));
  const mapa = {};
  snaps.forEach((snap, i) => {
    for (const d of snap.docs) {
      const dado = { id: d.id, ...d.data() };
      mapa[dado.uid] ??= { faltas: [], atrasos: [], advertencias: [], avaliacoes: [] };
      mapa[dado.uid][COLECOES_LANCAMENTOS[i]].push(dado);
    }
  });
  return mapa;
}

const difere = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) >= 1e-9;
const difereValor = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) >= 0.005;

/**
 * Recalcula o Fundo Shinatal e publica os agregados em `fundo/{ano}` (dashboards: saldo, soma dos
 * pesos e soma dos pesos ajustados, que é o que faz as cotas de todos somarem o saldo) e em
 * `estatisticas/publico` (landing page, sem login).
 *
 * `usuarios` e `mapaDados` são opcionais: quem já tem os dados em memória passa; os demais deixam
 * o serviço buscar. Com `soSeMudou`, compara com o que está gravado e só regrava se houver
 * diferença — usado ao abrir as telas de gestão, para corrigir sozinho qualquer valor desatualizado.
 * @param {{usuarios?: object[], mapaDados?: object, anoExercicio: number, atualizadoPorUid: string, soSeMudou?: boolean}} params
 */
async function recalcularEPublicarFundo({ usuarios, mapaDados, anoExercicio, atualizadoPorUid, soSeMudou = false }) {
  const [contratosEmpresariais, listaUsuarios, dados] = await Promise.all([
    carregarContratosEmpresariais(),
    usuarios ? Promise.resolve(usuarios) : carregarUsuarios(),
    mapaDados ? Promise.resolve(mapaDados) : carregarMapaDados()
  ]);

  // Mesmo montador usado pelo script de migração (backend/scripts/recalcular-regra-v2.mjs).
  // "Colaboradores" públicos = headcount atual dos contratos empresariais (sem PII, sem contrato
  // individual); `arrecadado` público = saldo líquido, o mesmo exibido na gestão.
  const { fundo, publico } = montarAgregadosFundo(contratosEmpresariais, listaUsuarios, anoExercicio, undefined, dados);
  const resultado = {
    saldoDisponivel: fundo.saldoDisponivel, somaPesos: fundo.somaPesos,
    somaPesosAjustados: fundo.somaPesosAjustados, contratosEmpresariais
  };

  if (soSeMudou) {
    const [fundoSnap, publicoSnap] = await Promise.all([
      getDoc(doc(db, "fundo", String(anoExercicio))),
      getDoc(doc(db, "estatisticas", "publico"))
    ]);
    const atual = fundoSnap.exists() ? fundoSnap.data() : null;
    const atualPublico = publicoSnap.exists() ? publicoSnap.data() : null;
    const mudou = !atual
      || ["arrecadado", "estornos", "saldoDisponivel"].some((k) => difereValor(atual[k], fundo[k]))
      || ["somaPesos", "somaPesosAjustados"].some((k) => difere(atual[k], fundo[k]))
      || ["totalContratosAtivos", "totalContratosEncerrados"].some((k) => atual[k] !== fundo[k])
      || difereValor(atualPublico?.arrecadado, publico.arrecadado)
      || atualPublico?.colaboradores !== publico.colaboradores;
    if (!mudou) return resultado;
  }

  await setDoc(doc(db, "fundo", String(anoExercicio)), {
    ...fundo,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: atualizadoPorUid
  });

  await setDoc(doc(db, "estatisticas", "publico"), {
    ...publico,
    atualizadoEm: serverTimestamp()
  }, { merge: true });

  return resultado;
}

export { carregarContratosEmpresariais, recalcularEPublicarFundo };
