import { describe, expect, test } from "vitest";
import { escolherCicloDaCompra, notasParaTrazer } from "../supplier-cycle-choice.js";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Ciclos da FLD em 08/10/2026: um esquecido aberto de julho e dois quinzenais novos.
const julhoVencido = { id: "julho", periodStart: d("2026-07-01"), periodEnd: d("2026-07-15") };
const fimDeSetembro = { id: "set-2", periodStart: d("2026-09-19"), periodEnd: d("2026-09-30") };
const inicioDeOutubro = { id: "out-1", periodStart: d("2026-10-01"), periodEnd: d("2026-10-15") };

describe("ciclo em que a compra de fornecedor de ciclo entra", () => {
  test("usa o ciclo aberto cujo período cobre a data da compra", () => {
    const ciclos = [julhoVencido, fimDeSetembro, inicioDeOutubro];
    expect(escolherCicloDaCompra(ciclos, d("2026-09-23"))).toEqual({ cicloId: "set-2" });
    expect(escolherCicloDaCompra(ciclos, d("2026-10-05"))).toEqual({ cicloId: "out-1" });
  });

  test("as pontas do período contam como dentro", () => {
    const ciclos = [fimDeSetembro];
    expect(escolherCicloDaCompra(ciclos, d("2026-09-19"))).toEqual({ cicloId: "set-2" });
    expect(escolherCicloDaCompra(ciclos, d("2026-09-30"))).toEqual({ cicloId: "set-2" });
  });

  test("ciclo sem fim cobre qualquer data a partir do início", () => {
    const semFim = { id: "aberto", periodStart: d("2026-09-01"), periodEnd: null };
    expect(escolherCicloDaCompra([semFim], d("2026-12-20"))).toEqual({ cicloId: "aberto" });
  });

  test("com dois ciclos cobrindo a data, fica o que começou por último", () => {
    const semFim = { id: "aberto", periodStart: d("2026-09-01"), periodEnd: null };
    expect(escolherCicloDaCompra([semFim, fimDeSetembro], d("2026-09-23"))).toEqual({ cicloId: "set-2" });
  });

  test("nunca cai num ciclo aberto cujo período já acabou", () => {
    // O defeito de 17/09 a 07/10/2026: sem ciclo para a data, a nota ia para o de julho.
    const escolha = escolherCicloDaCompra([julhoVencido], d("2026-09-24"));
    expect(escolha).toEqual({ criar: { periodStart: d("2026-09-24"), periodEnd: null } });
  });

  test("sem ciclo para a data, cria um que termina na véspera do próximo ciclo aberto", () => {
    const escolha = escolherCicloDaCompra([julhoVencido, fimDeSetembro, inicioDeOutubro], d("2026-09-16"));
    expect(escolha).toEqual({ criar: { periodStart: d("2026-09-16"), periodEnd: d("2026-09-18") } });
  });

  test("sem nenhum ciclo aberto, cria um a partir da data da compra", () => {
    expect(escolherCicloDaCompra([], d("2026-10-08"))).toEqual({
      criar: { periodStart: d("2026-10-08"), periodEnd: null }
    });
  });
});

describe("notas que um ciclo novo traz de outros ciclos abertos", () => {
  const nota = (purchaseId: string, data: string, ciclo: { id: string; periodStart: Date; periodEnd: Date | null }) => ({
    purchaseId,
    purchaseDate: d(data),
    cycleId: ciclo.id,
    cicloInicio: ciclo.periodStart,
    cicloFim: ciclo.periodEnd
  });

  // As notas da FLD presas no ciclo de julho em 08/10/2026.
  const presas = [
    nota("542048", "2026-07-07", julhoVencido),
    nota("569786", "2026-09-16", julhoVencido),
    nota("572478", "2026-09-23", julhoVencido),
    nota("576476", "2026-10-01", julhoVencido)
  ];

  test("traz as notas com data dentro do período do ciclo novo", () => {
    const trazidas = notasParaTrazer(presas, { inicio: d("2026-09-19"), fim: d("2026-09-30") });
    expect(trazidas.map((n) => n.purchaseId)).toEqual(["572478"]);
  });

  test("as pontas do período contam como dentro", () => {
    const trazidas = notasParaTrazer(presas, { inicio: d("2026-09-16"), fim: d("2026-10-01") });
    expect(trazidas.map((n) => n.purchaseId)).toEqual(["569786", "572478", "576476"]);
  });

  test("ciclo novo sem fim traz tudo a partir do início", () => {
    const trazidas = notasParaTrazer(presas, { inicio: d("2026-09-20"), fim: null });
    expect(trazidas.map((n) => n.purchaseId)).toEqual(["572478", "576476"]);
  });

  test("não tira nota do ciclo cujo período cobre a data dela", () => {
    const semFim = { id: "aberto", periodStart: d("2026-09-01"), periodEnd: null };
    const trazidas = notasParaTrazer([nota("580000", "2026-10-10", semFim)], { inicio: d("2026-10-01"), fim: d("2026-10-15") });
    expect(trazidas).toEqual([]);
  });

  test("nota fora do período fica onde está", () => {
    expect(notasParaTrazer(presas, { inicio: d("2026-11-01"), fim: d("2026-11-15") })).toEqual([]);
  });
});
