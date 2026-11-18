// Shinatal: utilitários de Firestore compartilhados pelos scripts de manutenção dos contratos
// (recalcular-regra-v2.mjs e importar-planilha-controle.mjs). O cálculo continua todo em
// frontend/js/calculo-shinatal.js; aqui só há leitura, backup e publicação dos agregados.
import crypto from "node:crypto";
import * as motor from "../../../frontend/js/calculo-shinatal.js";

export const TOLERANCIA = 0.005;

/** Firestore → JSON (Timestamps viram {_timestamp: ISO}). */
export function serializar(valor) {
  if (valor && typeof valor.toDate === "function" && typeof valor.toMillis === "function") {
    return { _timestamp: valor.toDate().toISOString() };
  }
  if (Array.isArray(valor)) return valor.map(serializar);
  if (valor && typeof valor === "object") return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, serializar(v)]));
  return valor;
}

function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
  return v;
}

// Entradas do histórico que mudam o cálculo (o resto do histórico é só registro).
const TIPOS_HISTORICO_CALCULO = ["edicao_prazo", "ajuste_manual", "reversao_ajuste_manual"];

/** Hash do que importa para o cálculo: detecta contrato alterado entre a simulação e a aplicação. */
export function hashContrato(c) {
  const { historicoMovimentacoes, ...resto } = serializar(c);
  const calculo = (historicoMovimentacoes || []).filter((h) => TIPOS_HISTORICO_CALCULO.includes(h?.tipo));
  return crypto.createHash("sha256").update(JSON.stringify(ordenar({ ...resto, prazo: calculo }))).digest("hex");
}

const TIPOS_SOLICITACAO_CONTRATO = ["contrato_empresarial_criar", "contrato_empresarial_editar", "contrato_empresarial_excluir"];

/** Lê contratos, usuários, fundos publicados e solicitações pendentes de contrato. */
export async function carregar(db) {
  const [contratosSnap, usuariosSnap, fundoSnap, publicoSnap, solicitacoesSnap] = await Promise.all([
    db.collection("contratosEmpresariais").get(),
    db.collection("usuarios").get(),
    db.collection("fundo").get(),
    db.collection("estatisticas").doc("publico").get(),
    db.collection("solicitacoes").where("status", "==", "pendente").get()
  ]);
  return {
    contratos: contratosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    usuarios: usuariosSnap.docs.map((d) => ({ uid: d.id, ...d.data() })),
    fundos: Object.fromEntries(fundoSnap.docs.map((d) => [d.id, d.data()])),
    publico: publicoSnap.exists ? publicoSnap.data() : null,
    pendentesContrato: solicitacoesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => TIPOS_SOLICITACAO_CONTRATO.includes(s.tipo))
  };
}

/** Republica `fundo/{ano}` (todos os anos com movimento ou já publicados) e `estatisticas/publico`. */
export async function republicarAgregados(db, FieldValue, autor, contratos, usuarios, anosExistentes, hojeISO) {
  const anoAtual = Number(hojeISO.slice(0, 4));
  const anos = [...new Set([...motor.anosComMovimento(contratos, hojeISO), ...anosExistentes.map(Number), anoAtual])]
    .filter(Number.isFinite).sort((a, b) => a - b);
  const publicados = {};
  for (const ano of anos) {
    const { fundo } = motor.montarAgregadosFundo(contratos, usuarios, ano, hojeISO);
    await db.collection("fundo").doc(String(ano)).set({
      ...fundo, atualizadoEm: FieldValue.serverTimestamp(), atualizadoPor: autor
    });
    publicados[ano] = fundo;
  }
  const { publico } = motor.montarAgregadosFundo(contratos, usuarios, anoAtual, hojeISO);
  await db.collection("estatisticas").doc("publico").set({ ...publico, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  return { anos, publicados, publico };
}

/** Relê o banco e confere que cada `fundo/{ano}` bate com o recálculo. */
export async function validarAgregados(db, hojeISO) {
  const { contratos, usuarios, fundos } = await carregar(db);
  const divergencias = [];
  for (const [ano, gravado] of Object.entries(fundos)) {
    const { fundo } = motor.montarAgregadosFundo(contratos, usuarios, Number(ano), hojeISO);
    for (const k of ["arrecadado", "estornos", "saldoDisponivel"]) {
      if (Math.abs((gravado[k] || 0) - fundo[k]) >= TOLERANCIA) divergencias.push({ ano, campo: k, gravado: gravado[k], esperado: fundo[k] });
    }
  }
  return divergencias;
}
