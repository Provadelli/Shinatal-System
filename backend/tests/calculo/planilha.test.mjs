// Planilha de controle do Shinatal: o sistema tem que reproduzir, linha a linha e no total,
// os valores da planilha (aba PLANILHA SHINE NATAL 2026 e aba PLANILHA GLOBAL).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  calcularResumoContratoEmpresarial as resumo, calcularFundo, calcularContribuicaoNoAno, calcularVisaoSemestral,
  contarMesesContabilizados, montarAgregadosFundo
} from "../../../frontend/js/calculo-shinatal.js";
import {
  montarContratosDaPlanilha, contratosEsperados, contratoDoAlvo, planejarReconciliacao, aplicarPlanoEmMemoria,
  pareceContratoExcluido, relatorioCSV
} from "../../scripts/lib/planilha.mjs";

const URL_DADOS = new URL("../../scripts/dados/planilha-controle-2026.json", import.meta.url);
const TEXTO = fs.readFileSync(URL_DADOS, "utf8");
const DADOS = JSON.parse(TEXTO);
const HOJE = DADOS.dataReferencia;
const ANO = DADOS.exercicio;
const ESPERADO = DADOS.totaisEsperados;
const perto = (obtido, esperado, msg) => assert.ok(Math.abs(obtido - esperado) < 0.005, `${msg}: obtido ${obtido}, esperado ${esperado}`);

/** Uma linha da planilha como contrato isolado (mesma régua do contrato real). */
function contratoDaLinha(l) {
  const alvo = {
    docId: `linha-${l.id}`, nomeEmpresa: l.tomador, cnpj: "00000000000000", dataInicio: l.implantacao,
    quantidadeFuncionariosIniciais: l.quantidade,
    saidasIniciais: l.saida ? [{ data: l.saida, motivo: null, quantidade: l.quantidade }] : [],
    entradasContrato: []
  };
  const historico = l.excecaoManual
    ? [{ tipo: "ajuste_manual", efeito: "contribuicao_zero", motivo: "decisão do gestor, planilha de controle de 17/11/2026", data: HOJE }]
    : [];
  return contratoDoAlvo(alvo, { historicoMovimentacoes: historico });
}

/* ------------------------------------------------------------------ */
/* Contrato excluído da tarefa                                         */
/* ------------------------------------------------------------------ */

test("o contrato CPRM não aparece em nenhum dado da planilha nem nos contratos montados", () => {
  assert.doesNotMatch(TEXTO, /CPRM/i);
  assert.doesNotMatch(TEXTO, /Urca/i);
  for (const l of DADOS.linhas) assert.equal(pareceContratoExcluido(l), false, `linha ${l.id}`);
  for (const c of montarContratosDaPlanilha(DADOS)) assert.equal(pareceContratoExcluido(c), false, c.chave);
  // Nenhuma implantação de 16/11/2026 com 16 funcionários (a linha 79 a 94 da planilha).
  assert.ok(!DADOS.linhas.some((l) => l.implantacao === "2026-11-16"));
});

/* ------------------------------------------------------------------ */
/* Linha a linha                                                       */
/* ------------------------------------------------------------------ */

for (const l of DADOS.linhas) {
  test(`linha ${l.id}: ${l.tomador} (${l.funcao}) bate com a planilha`, () => {
    const c = contratoDaLinha(l);
    const r = resumo(c, HOJE);
    const noAno = calcularContribuicaoNoAno(c, ANO, HOJE);
    if (l.esperado.mesesContados !== undefined) {
      assert.equal(r.lotes.find((x) => x.saida).mesesContados, l.esperado.mesesContados, "meses contados");
    }
    perto(noAno.creditado, l.esperado.credito, "crédito no exercício");
    perto(noAno.descontado + noAno.estorno, l.esperado.desconto, "desconto no exercício");
    perto(noAno.liquido, l.esperado.liquido, "líquido no exercício");
    if (l.excecaoManual) {
      perto(r.ajusteManual.descontoRegua, l.esperado.descontoRegua, "desconto que a régua daria");
    }
  });
}

test("todos os contratos são de prazo indeterminado, sem término e R$ 150 por funcionário", () => {
  for (const c of contratosEsperados(DADOS)) {
    assert.equal(c.prazoIndeterminado, true);
    assert.equal(c.dataFimPrevista, null);
    for (const l of resumo(c, HOJE).lotes) assert.equal(l.credito, 150 * l.quantidade);
  }
});

test("contratos de 2025: crédito fica em 2025, em 2026 só o desconto (R$ 350)", () => {
  const de2025 = contratosEsperados(DADOS).filter((c) => c.dataInicio < "2026-01-01");
  assert.equal(de2025.length, 4);
  perto(calcularFundo(de2025, 2025, HOJE).arrecadado, 600, "crédito 2025");
  const f = calcularFundo(de2025, 2026, HOJE);
  perto(f.arrecadado, 0, "crédito 2026");
  perto(f.estornos, ESPERADO.descontosSaidaContratos2025, "desconto 2026");
});

/* ------------------------------------------------------------------ */
/* Totais do exercício e visão global                                  */
/* ------------------------------------------------------------------ */

test("totais 2026 sem o CPRM: 59 ativos, créditos 9.750, descontos 950, saldo R$ 8.800,00", () => {
  const contratos = contratosEsperados(DADOS);
  const f = calcularFundo(contratos, ANO, HOJE);
  perto(f.arrecadado, ESPERADO.creditosBrutos, "créditos brutos");
  perto(f.estornos, ESPERADO.descontosSaida, "descontos de saída");
  perto(f.saldoDisponivel, 8800, "saldo");
  perto(f.saldoDisponivel, ESPERADO.saldo, "saldo (arquivo)");
  const ativos = contratos.reduce((s, c) => s + resumo(c, HOJE).qtdAtual, 0);
  assert.equal(ativos, ESPERADO.funcionariosAtivos);
  // O que é publicado no banco (painel e página pública) é o mesmo número.
  const { fundo, publico } = montarAgregadosFundo(contratos, [], ANO, HOJE);
  perto(fundo.saldoDisponivel, 8800, "fundo publicado");
  perto(publico.arrecadado, 8800, "página pública");
  assert.equal(publico.colaboradores, 59);
});

test("descontos de saída por origem: R$ 350 dos contratos de 2025 + R$ 600 dos de 2026", () => {
  const contratos = contratosEsperados(DADOS);
  const de2026 = contratos.filter((c) => c.dataInicio >= "2026-01-01");
  perto(calcularFundo(de2026, ANO, HOJE).estornos, ESPERADO.descontosSaidaContratos2026, "descontos 2026");
});

test("visão global por semestre bate com a aba PLANILHA GLOBAL", () => {
  const v = calcularVisaoSemestral(contratosEsperados(DADOS), ANO, HOJE);
  for (const s of ["1", "2"]) {
    const e = ESPERADO.semestres[s];
    assert.equal(v.semestres[s].ativos, e.ativos, `${s}º ativos`);
    perto(v.semestres[s].positivo, e.positivo, `${s}º positivo`);
    perto(v.semestres[s].remanescente, e.remanescente, `${s}º remanescente`);
    perto(v.semestres[s].negativo, e.negativo, `${s}º negativo`);
  }
  assert.equal(v.total.ativos, ESPERADO.global.ativos);
  perto(v.total.positivo, ESPERADO.global.positivo, "positivo global");
  perto(v.total.negativo, ESPERADO.global.negativo, "negativo global");
  perto(v.total.valorTotal, ESPERADO.global.valorTotal, "valor total");
});

test("visão semestral sempre fecha com o saldo do fundo (inclusive com mudança de prazo e estorno)", () => {
  const extras = [
    contratoDoAlvo({ docId: "d", nomeEmpresa: "x", cnpj: "x", dataInicio: "2026-02-10", quantidadeFuncionariosIniciais: 3, saidasIniciais: [], entradasContrato: [] }),
    { dataInicio: "2026-03-03", dataFimPrevista: "2026-12-31", dataFimPrevistaOriginal: "2026-08-31", quantidadeFuncionariosIniciais: 2,
      status: "encerrado", dataEncerramentoReal: "2026-10-20", saidasIniciais: [{ data: "2026-05-10", quantidade: 1 }],
      entradasContrato: [{ dataEntrada: "2026-07-01", dataSaida: null, quantidade: 1 }],
      historicoMovimentacoes: [{ tipo: "edicao_prazo", descricao: "prazo alterado", data: "2026-09-02" }] }
  ];
  const contratos = [...contratosEsperados(DADOS), ...extras];
  for (const ano of [2025, 2026]) {
    const v = calcularVisaoSemestral(contratos, ano, HOJE);
    const f = calcularFundo(contratos, ano, HOJE);
    perto(v.total.valorTotal, f.arrecadado - f.estornos, `ano ${ano}`);
  }
});

/* ------------------------------------------------------------------ */
/* Exceção manual (Porto Alegre)                                       */
/* ------------------------------------------------------------------ */

test("Porto Alegre: a régua daria desconto de R$ 137,50; com o ajuste manual contribui R$ 0,00", () => {
  const linha = DADOS.linhas.find((l) => l.excecaoManual);
  const semAjuste = contratoDaLinha({ ...linha, excecaoManual: false });
  const comAjuste = contratoDaLinha(linha);
  const rSem = resumo(semAjuste, HOJE);
  assert.equal(rSem.lotes[0].mesesContados, 1); // fev conta (entrada dia 9); mar não (saída dia 1)
  perto(rSem.descontado, 137.5, "desconto pela régua");
  const rCom = resumo(comAjuste, HOJE);
  perto(rCom.totalCreditadoFundo, 0, "total no fundo");
  const noAno = calcularContribuicaoNoAno(comAjuste, ANO, HOJE);
  perto(noAno.creditado, 0, "positivo");
  perto(noAno.descontado, 0, "negativo");
  assert.equal(rCom.ajusteManual.motivo, "decisão do gestor, planilha de controle de 17/11/2026");
});

test("o ajuste manual só afeta o contrato dele, e a reversão desfaz", () => {
  const contratos = contratosEsperados(DADOS);
  const comAjuste = contratos.filter((c) => resumo(c, HOJE).ajusteManual);
  assert.equal(comAjuste.length, 1);
  assert.equal(comAjuste[0].id, "EjiePPIDcHYWRmSpDH8D");
  const revertido = { ...comAjuste[0], historicoMovimentacoes: [...comAjuste[0].historicoMovimentacoes, { tipo: "reversao_ajuste_manual" }] };
  assert.equal(resumo(revertido, HOJE).ajusteManual, null);
  perto(calcularContribuicaoNoAno(revertido, ANO, HOJE).liquido, 12.5, "volta à régua");
});

/* ------------------------------------------------------------------ */
/* Régua: casos de borda usados pela planilha                          */
/* ------------------------------------------------------------------ */

test("régua: desligamento no último dia de fevereiro (28/02/2026 e 29/02/2028) conta o mês", () => {
  assert.equal(contarMesesContabilizados({ inicio: "2026-01-14", fim: "2026-02-28", tipoFim: "desligamento" }), 2);
  assert.equal(contarMesesContabilizados({ inicio: "2026-01-14", fim: "2026-02-27", tipoFim: "desligamento" }), 1);
  assert.equal(contarMesesContabilizados({ inicio: "2028-01-14", fim: "2028-02-29", tipoFim: "desligamento" }), 2);
  assert.equal(contarMesesContabilizados({ inicio: "2028-01-14", fim: "2028-02-28", tipoFim: "desligamento" }), 1);
  assert.equal(contarMesesContabilizados({ inicio: "2026-01-15", fim: "2026-01-31", tipoFim: "desligamento" }), 0);
});

test("régua: entrada dia 14 conta o mês, dia 15 começa no seguinte (com saída no meio do mês)", () => {
  assert.equal(contarMesesContabilizados({ inicio: "2026-03-14", fim: "2026-09-16", tipoFim: "desligamento" }), 6);
  assert.equal(contarMesesContabilizados({ inicio: "2026-03-15", fim: "2026-09-16", tipoFim: "desligamento" }), 5);
  // Término previsto e encerramento: o mês final sempre conta.
  assert.equal(contarMesesContabilizados({ inicio: "2026-03-14", fim: "2026-09-16", tipoFim: "termino_previsto" }), 7);
  assert.equal(contarMesesContabilizados({ inicio: "2026-03-14", fim: "2026-09-01", tipoFim: "encerramento" }), 7);
});

/* ------------------------------------------------------------------ */
/* Reconciliação com o banco                                           */
/* ------------------------------------------------------------------ */

/** Banco de exemplo no estado de 17/11/2026 (antes da conferência), com o mesmo formato do Firestore. */
function bancoAntes() {
  const contratos = contratosEsperados(DADOS).filter((c) => c.id !== "planilha-2026-sp-pw-tec-manutencao")
    .map((c) => ({ ...c, prazoIndeterminado: false, dataFimPrevista: "2027-12-31", historicoMovimentacoes: [{ tipo: "criacao", descricao: "x" }] }));
  const casa = contratos.find((c) => c.id === "wnEpxvpfGq5iZ8vwREdA");
  casa.saidasIniciais = [];
  casa.entradasContrato = casa.entradasContrato.map((e) => ({ ...e, dataSaida: null, motivo: "registro antigo" }));
  return contratos;
}

test("reconciliação: cria só o contrato novo, atualiza os demais e chega a R$ 8.800,00", () => {
  const plano = planejarReconciliacao(bancoAntes(), DADOS, HOJE);
  assert.deepEqual(plano.divergencias, []);
  assert.deepEqual(plano.acoes.filter((a) => a.tipo === "criar").map((a) => a.id), ["planilha-2026-sp-pw-tec-manutencao"]);
  const depois = aplicarPlanoEmMemoria(bancoAntes(), plano);
  assert.equal(depois.length, 20);
  perto(calcularFundo(depois, ANO, HOJE).saldoDisponivel, 8800, "saldo");
  // Dados existentes preservados (motivo das entradas) e histórico só acrescido.
  const casa = depois.find((c) => c.id === "wnEpxvpfGq5iZ8vwREdA");
  assert.ok(casa.entradasContrato.every((e) => e.motivo === "registro antigo" && e.dataSaida === "2026-09-16"));
  assert.equal(casa.historicoMovimentacoes[0].tipo, "criacao");
  const auditoria = casa.historicoMovimentacoes.find((h) => h.tipo === "importacao_planilha");
  assert.ok(auditoria.funcionarios.length === 4 && "fundoAntes" in auditoria && "diferenca" in auditoria && auditoria.motivo);
  assert.match(relatorioCSV(plano), /criar/);
});

test("reprocessamento sem duplicidade: rodar de novo não gera nenhum contrato nem lançamento", () => {
  const primeiro = aplicarPlanoEmMemoria(bancoAntes(), planejarReconciliacao(bancoAntes(), DADOS, HOJE));
  const segundo = planejarReconciliacao(primeiro, DADOS, HOJE);
  assert.equal(segundo.acoes.filter((a) => a.tipo !== "igual").length, 0);
  const terceiro = aplicarPlanoEmMemoria(primeiro, segundo);
  assert.equal(terceiro.length, primeiro.length);
  const lancamentos = (cs) => cs.reduce((s, c) => s + (c.historicoMovimentacoes || []).length, 0);
  assert.equal(lancamentos(terceiro), lancamentos(primeiro));
  const ajustes = terceiro.flatMap((c) => c.historicoMovimentacoes || []).filter((h) => h.tipo === "ajuste_manual");
  assert.equal(ajustes.length, 1);
});

test("reconciliação nunca apaga: registro do banco ausente da planilha vira divergência e é mantido", () => {
  const banco = bancoAntes();
  banco.find((c) => c.id === "TQAHSckPxSXWa0N3zOJN").saidasIniciais = [{ data: "2026-04-10", quantidade: 1 }];
  const plano = planejarReconciliacao(banco, DADOS, HOJE);
  assert.ok(plano.divergencias.some((d) => d.gravidade === "bloqueante" && /2026-04-10/.test(d.mensagem)));
  const marinha = aplicarPlanoEmMemoria(banco, plano).find((c) => c.id === "TQAHSckPxSXWa0N3zOJN");
  assert.equal(marinha.saidasIniciais.length, 1);
});

test("contrato do sistema fora da planilha não é alterado nem apagado, só informado", () => {
  const outro = { id: "fora-da-planilha", nomeEmpresa: "EMPRESA FORA DA PLANILHA", cnpj: "11222333000181", dataInicio: "2026-06-01", quantidadeFuncionariosIniciais: 2, status: "ativo", prazoIndeterminado: true };
  const banco = [...bancoAntes(), outro];
  const plano = planejarReconciliacao(banco, DADOS, HOJE);
  assert.deepEqual(plano.foraDaPlanilha, [{ id: "fora-da-planilha", nomeEmpresa: outro.nomeEmpresa, excluidoDaTarefa: false }]);
  assert.ok(!plano.acoes.some((a) => a.id === "fora-da-planilha"));
  assert.deepEqual(aplicarPlanoEmMemoria(banco, plano).find((c) => c.id === "fora-da-planilha"), outro);
});

test("campo travado diferente (quadro inicial) bloqueia em vez de alterar", () => {
  const banco = bancoAntes();
  banco.find((c) => c.id === "4pz01KdVHFIg4flby07k").quantidadeFuncionariosIniciais = 27;
  const plano = planejarReconciliacao(banco, DADOS, HOJE);
  assert.ok(plano.divergencias.some((d) => d.gravidade === "bloqueante" && /quantidadeFuncionariosIniciais/.test(d.mensagem)));
  const acao = plano.acoes.find((a) => a.id === "4pz01KdVHFIg4flby07k");
  assert.ok(!("quantidadeFuncionariosIniciais" in (acao.campos || {})));
});
