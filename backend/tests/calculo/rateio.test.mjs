// Rateio do Fundo Shinatal: a soma das cotas de todos é exatamente o saldo do fundo, em
// centavos, com os redutores, faltas e adicionais mudando só a fatia de cada um (Seções 2, 6, 16).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularDistribuicaoFundo, calcularCotaColaborador, simularCotaColaborador, montarAgregadosFundo, arredondarCentavos
} from "../../../frontend/js/calculo-shinatal.js";

const ANO = 2026;
const pessoa = (uid, extra = {}) => ({ uid, role: "colaborador", status: "ativo", dataAdmissao: "2020-01-01", cargaHoraria: 8, ...extra });
const vazio = () => ({ faltas: [], atrasos: [], advertencias: [], avaliacoes: [] });
const centavos = (v) => Math.round(v * 100);
const somaCotas = (porUid) => Object.values(porUid).reduce((s, r) => s + centavos(r.cotaFinal), 0) / 100;

test("sem redutores nem bônus: divisão pelo peso (avos × jornada)", () => {
  const usuarios = [pessoa("a"), pessoa("b"), pessoa("c", { cargaHoraria: 4 })];
  const { porUid, totalDistribuido } = calcularDistribuicaoFundo(usuarios, {}, 1000, ANO);
  // Todos sem ocorrência ganham +3% de excelência: o bônus é igual para todos e se anula.
  assert.equal(porUid.a.cotaFinal, 400);
  assert.equal(porUid.b.cotaFinal, 400);
  assert.equal(porUid.c.cotaFinal, 200);
  assert.equal(totalDistribuido, 1000);
});

test("bônus e redutores mudam a fatia, e a soma continua igual ao fundo", () => {
  const usuarios = [pessoa("a"), pessoa("b"), pessoa("c")];
  const mapa = {
    a: vazio(), // +3% excelência
    b: { ...vazio(), atrasos: [{ mesAno: "2026-03", quantidadeAtrasos: 6 }] }, // −1%, sem bônus
    c: { ...vazio(), avaliacoes: [{ ano: ANO, conceito: "excelente", validadoRH: true }] } // +3% +2%
  };
  const { porUid, totalDistribuido, somaPesosAjustados } = calcularDistribuicaoFundo(usuarios, mapa, 11650, ANO);
  assert.equal(totalDistribuido, 11650);
  assert.equal(somaCotas(porUid), 11650);
  assert.ok(porUid.c.cotaFinal > porUid.a.cotaFinal && porUid.a.cotaFinal > porUid.b.cotaFinal);
  // Proporção exata dos pesos ajustados: 1,03 : 0,99 : 1,05.
  assert.ok(Math.abs(somaPesosAjustados - (1.03 + 0.99 + 1.05)) < 1e-12);
  assert.ok(Math.abs(porUid.a.cotaFinal - (1.03 / 3.07) * 11650) < 0.01);
});

test("faltas reduzem o peso como na Seção 7 (cota ÷ 30 × faltas)", () => {
  const usuarios = [pessoa("a"), pessoa("b")];
  const falta = (d) => ({ data: `2026-02-${d}`, justificada: false });
  const mapa = { a: { ...vazio(), faltas: [falta("10"), falta("11"), falta("12")] }, b: vazio() };
  const { porUid } = calcularDistribuicaoFundo(usuarios, mapa, 2000, ANO);
  // a: 1 × (1 − 3/30) = 0,9 (perde o bônus); b: 1 × 1,03.
  assert.ok(Math.abs(porUid.a.pesoAjustado - 0.9) < 1e-12);
  assert.ok(Math.abs(porUid.b.pesoAjustado - 1.03) < 1e-12);
  assert.equal(somaCotas(porUid), 2000);
});

test("inelegível, Presidente e 3ª suspensão ficam com zero e não entram na divisão", () => {
  const usuarios = [
    pessoa("a"), pessoa("pres", { role: "presidente" }), pessoa("dem", { status: "demitido" }), pessoa("susp")
  ];
  const mapa = { susp: { ...vazio(), advertencias: [{ data: "2026-05-01", tipo: "suspensao3" }] } };
  const { porUid } = calcularDistribuicaoFundo(usuarios, mapa, 500, ANO);
  assert.equal(porUid.pres.cotaFinal, 0);
  assert.equal(porUid.dem.cotaFinal, 0);
  assert.equal(porUid.susp.cotaFinal, 0);
  assert.equal(porUid.a.cotaFinal, 500);
});

test("centavos: a soma fecha exatamente mesmo quando a divisão é dízima", () => {
  const usuarios = [pessoa("a"), pessoa("b"), pessoa("c")];
  for (const saldo of [100, 1000.01, 11650, 0.02, 7]) {
    const { porUid, totalDistribuido } = calcularDistribuicaoFundo(usuarios, {}, saldo, ANO);
    assert.equal(centavos(totalDistribuido), centavos(saldo), `saldo ${saldo}`);
    const valores = Object.values(porUid).map((r) => centavos(r.cotaFinal));
    assert.ok(Math.max(...valores) - Math.min(...valores) <= 1, `diferença de no máximo 1 centavo (${saldo})`);
  }
});

test("a ordem da lista não muda quem recebe cada centavo", () => {
  const usuarios = [pessoa("a"), pessoa("b"), pessoa("c")];
  const ida = calcularDistribuicaoFundo(usuarios, {}, 100, ANO).porUid;
  const volta = calcularDistribuicaoFundo([...usuarios].reverse(), {}, 100, ANO).porUid;
  for (const uid of ["a", "b", "c"]) assert.equal(ida[uid].cotaFinal, volta[uid].cotaFinal);
});

test("contrato entra ou sai: a nova divisão fecha com o novo saldo", () => {
  const usuarios = [pessoa("a"), pessoa("b", { cargaHoraria: 6 }), pessoa("c", { dataAdmissao: "2026-07-10" })];
  const mapa = { a: vazio(), b: { ...vazio(), atrasos: [{ mesAno: "2026-04", quantidadeAtrasos: 12 }] }, c: vazio() };
  for (const saldo of [11650, 11800, 11500, 0]) {
    const { porUid, totalDistribuido } = calcularDistribuicaoFundo(usuarios, mapa, saldo, ANO);
    assert.equal(totalDistribuido, saldo);
    assert.equal(somaCotas(porUid), saldo);
  }
});

test("tela do colaborador (só com a soma publicada) mostra a mesma cota da gestão, ±1 centavo", () => {
  const usuarios = [pessoa("a"), pessoa("b", { cargaHoraria: 6 }), pessoa("c", { dataAdmissao: "2026-03-20" })];
  const mapa = { a: vazio(), b: { ...vazio(), atrasos: [{ mesAno: "2026-01", quantidadeAtrasos: 6 }] }, c: vazio() };
  const saldo = 11650;
  const dist = calcularDistribuicaoFundo(usuarios, mapa, saldo, ANO);
  for (const u of usuarios) {
    const individual = calcularCotaColaborador(u, mapa[u.uid], saldo, dist.somaPesos, ANO, dist.somaPesosAjustados);
    assert.ok(Math.abs(individual.cotaFinal - dist.porUid[u.uid].cotaFinal) <= 0.01 + 1e-9, u.uid);
  }
});

test("agregado publicado leva a soma dos pesos ajustados (só quando há lançamentos)", () => {
  const usuarios = [pessoa("a"), pessoa("b")];
  assert.equal(montarAgregadosFundo([], usuarios, ANO, "2026-11-27").fundo.somaPesosAjustados, undefined);
  const { fundo } = montarAgregadosFundo([], usuarios, ANO, "2026-11-27", {});
  assert.equal(typeof fundo.somaPesosAjustados, "number");
});

test("simulador: mais faltas reduzem a própria cota e a soma do fundo continua a mesma", () => {
  const usuarios = [pessoa("a"), pessoa("b")];
  const saldo = 3000;
  const dist = calcularDistribuicaoFundo(usuarios, {}, saldo, ANO);
  const comFaltas = { ...vazio(), faltas: [{ data: "2026-01-02", justificada: false }, { data: "2026-01-03", justificada: false }] };
  const { atual, simulado } = simularCotaColaborador(usuarios[0], vazio(), comFaltas, saldo, dist.somaPesos, ANO, dist.somaPesosAjustados);
  assert.equal(atual.cotaFinal, 1500);
  assert.ok(simulado.cotaFinal < atual.cotaFinal);
  const outro = calcularDistribuicaoFundo(usuarios, { a: comFaltas }, saldo, ANO);
  assert.ok(Math.abs(simulado.cotaFinal - outro.porUid.a.cotaFinal) <= 0.01);
});

test("arredondarCentavos não erra em valores como 1,005", () => {
  assert.equal(arredondarCentavos(1.005), 1.01);
  assert.equal(arredondarCentavos(2.675), 2.68);
});
