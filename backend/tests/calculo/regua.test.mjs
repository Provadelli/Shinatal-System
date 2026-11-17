// Régua de meses v2 — função central `contarMesesContabilizados` e utilitários de data.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contarMesesContabilizados as contar, calcularMesReferenciaImplantacao, partesISO, hojeISOLocal,
  ehUltimoDiaDoMes, diasNoMes, mesesPausadosNoIntervalo, primeiroMesContabilizado, ultimoMesContabilizado,
  calcularDuracaoMesesPrevista, calcularAvosTrabalhados
} from "../../../frontend/js/calculo-shinatal.js";

test("1. entrada no dia 14: o mês da entrada conta", () => {
  assert.equal(contar({ inicio: "2026-02-14", fim: "2026-02-28", tipoFim: "termino_previsto" }), 1);
  assert.deepEqual(calcularMesReferenciaImplantacao("2026-02-14"), { ano: 2026, mes: 1 });
});

test("2. entrada no dia 15: o mês da entrada NÃO conta (começa no seguinte)", () => {
  assert.equal(contar({ inicio: "2026-02-15", fim: "2026-02-28", tipoFim: "termino_previsto" }), 0);
  assert.equal(contar({ inicio: "2026-02-15", fim: "2026-03-01", tipoFim: "termino_previsto" }), 1);
  assert.deepEqual(calcularMesReferenciaImplantacao("2026-02-15"), { ano: 2026, mes: 2 });
});

test("3/4. término previsto no dia 14, 15 ou 31: o mês final sempre conta", () => {
  for (const fim of ["2026-05-14", "2026-05-15", "2026-05-31", "2026-05-01"]) {
    assert.equal(contar({ inicio: "2026-01-10", fim, tipoFim: "termino_previsto" }), 5, fim);
  }
});

test("5. desligamento no dia 14: o mês do desligamento não conta (exemplo do enunciado)", () => {
  // Admitido 14/02/2026, desligado 14/05/2026 → fevereiro, março e abril.
  assert.equal(contar({ inicio: "2026-02-14", fim: "2026-05-14", tipoFim: "desligamento" }), 3);
});

test("6. desligamento no último dia do mês: o mês conta", () => {
  assert.equal(contar({ inicio: "2026-02-14", fim: "2026-05-31", tipoFim: "desligamento" }), 4);
  assert.equal(contar({ inicio: "2026-02-14", fim: "2026-04-30", tipoFim: "desligamento" }), 3);
  assert.equal(contar({ inicio: "2026-02-14", fim: "2026-05-30", tipoFim: "desligamento" }), 3);
});

test("encerramento antecipado: o mês do encerramento conta, qualquer que seja o dia", () => {
  assert.equal(contar({ inicio: "2026-01-10", fim: "2026-06-01", tipoFim: "encerramento" }), 6);
  assert.equal(contar({ inicio: "2026-01-10", fim: "2026-06-18", tipoFim: "encerramento" }), 6);
});

test("entrada e desligamento no mesmo mês ou sem mês completo: 0", () => {
  assert.equal(contar({ inicio: "2026-03-20", fim: "2026-04-10", tipoFim: "desligamento" }), 0);
  assert.equal(contar({ inicio: "2026-03-02", fim: "2026-03-20", tipoFim: "desligamento" }), 0);
  assert.equal(contar({ inicio: "2026-03-02", fim: "2026-03-31", tipoFim: "desligamento" }), 1);
});

test("15. virada de ano", () => {
  assert.equal(contar({ inicio: "2025-11-10", fim: "2026-02-12", tipoFim: "termino_previsto" }), 4);
  assert.equal(contar({ inicio: "2025-12-14", fim: "2026-01-05", tipoFim: "desligamento" }), 1);
  assert.deepEqual(calcularMesReferenciaImplantacao("2025-12-14"), { ano: 2025, mes: 11 });
  assert.deepEqual(calcularMesReferenciaImplantacao("2025-12-15"), { ano: 2026, mes: 0 });
  assert.equal(calcularDuracaoMesesPrevista("2025-12-15", "2026-12-31"), 12);
});

test("16. ano bissexto: 29/02 é o último dia de fevereiro só em ano bissexto", () => {
  assert.equal(diasNoMes(2028, 1), 29);
  assert.equal(diasNoMes(2026, 1), 28);
  assert.equal(diasNoMes(2100, 1), 28);
  assert.equal(diasNoMes(2000, 1), 29);
  assert.equal(ehUltimoDiaDoMes("2028-02-29"), true);
  assert.equal(ehUltimoDiaDoMes("2028-02-28"), false);
  assert.equal(ehUltimoDiaDoMes("2026-02-28"), true);
  assert.equal(contar({ inicio: "2028-01-10", fim: "2028-02-29", tipoFim: "desligamento" }), 2);
  assert.equal(contar({ inicio: "2028-01-10", fim: "2028-02-28", tipoFim: "desligamento" }), 1);
  assert.equal(contar({ inicio: "2026-01-10", fim: "2026-02-28", tipoFim: "desligamento" }), 2);
  assert.equal(partesISO("2026-02-29"), null);
  assert.deepEqual(partesISO("2028-02-29"), { ano: 2028, mes: 1, dia: 29 });
});

test("datas de calendário: sem desvio de um dia por fuso/UTC", () => {
  // 23h30 local continua sendo o mesmo dia (toISOString já viraria o dia seguinte no Brasil).
  assert.equal(hojeISOLocal(new Date(2026, 10, 17, 23, 30)), "2026-11-17");
  assert.equal(hojeISOLocal(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
  assert.equal(primeiroMesContabilizado("2026-03-01"), 2026 * 12 + 2);
  assert.equal(ultimoMesContabilizado("2026-03-31", "desligamento"), 2026 * 12 + 2);
  assert.equal(partesISO("lixo"), null);
  assert.equal(contar({ inicio: "lixo", fim: "2026-01-01" }), 0);
});

test("12. pausas: pausar = saída, retomar = entrada", () => {
  const base = { inicio: "2026-01-10", fim: "2026-12-31", tipoFim: "encerramento" };
  assert.equal(contar(base), 12);
  // 10/03 → 20/03: março pausado (retomada depois do dia 14) → 11.
  assert.equal(contar({ ...base, pausas: [{ dataPausa: "2026-03-10", dataRetomada: "2026-03-20" }] }), 11);
  // 10/03 → 10/05: março e abril pausados; maio volta a contar → 10.
  assert.equal(contar({ ...base, pausas: [{ dataPausa: "2026-03-10", dataRetomada: "2026-05-10" }] }), 10);
  // 31/03 (último dia) → 10/05: março conta, abril pausado → 11.
  assert.equal(contar({ ...base, pausas: [{ dataPausa: "2026-03-31", dataRetomada: "2026-05-10" }] }), 11);
  // Pausa aberta desde 10/11: novembro e dezembro pausados.
  assert.equal(contar({ ...base, pausas: [{ dataPausa: "2026-11-10", dataRetomada: null }] }), 10);
  // Pausas sobrepostas não contam o mesmo mês duas vezes.
  assert.equal(contar({ ...base, pausas: [
    { dataPausa: "2026-03-10", dataRetomada: "2026-05-10" },
    { dataPausa: "2026-04-01", dataRetomada: "2026-04-20" }
  ] }), 10);
  // Pausa iniciada depois da data final é ignorada.
  assert.equal(mesesPausadosNoIntervalo([{ dataPausa: "2027-01-10", dataRetomada: null }], 0, 99999, "2026-12-31"), 0);
});

test("avos dos colaboradores (Seção 4.1, divisão) continuam na regra do dia 15/16 — fora do escopo", () => {
  assert.equal(calcularAvosTrabalhados("2026-02-15", 2026), 11);
  assert.equal(calcularAvosTrabalhados("2026-02-16", 2026), 10);
});
