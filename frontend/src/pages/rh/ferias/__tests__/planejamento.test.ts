import { describe, expect, test } from "vitest";
import type { ListaFerias, PeriodoFerias, PessoaFerias, ProgramacaoFerias } from "../../../../api/client";
import type { Ausencia } from "../eixoDoTempo";
import { prazosDeAviso, resumoPorMes } from "../planejamento";
import { motivoInicioVedado, prazoParaAvisar, repousosPorExtenso } from "../regrasFerias";

const aus = (employeeId: string, inicio: string, fim: string): Ausencia => ({ employeeId, nome: employeeId, setor: null, inicio, fim, gozada: false });

describe("dias fora por mês", () => {
  test("soma os dias de cada pessoa e acha o pico ao mesmo tempo", () => {
    const meses = resumoPorMes([aus("a", "2026-11-02", "2026-11-11"), aus("b", "2026-11-09", "2026-11-12")], "2026-10-15", 3);
    expect(meses.map((m) => m.nome)).toEqual(["out", "nov", "dez"]);
    expect(meses[0]).toMatchObject({ diasFora: 0, pico: 0, pessoas: 0 });
    expect(meses[1]).toMatchObject({ diasFora: 10 + 4, pico: 2, pessoas: 2 });
  });

  test("férias que atravessam a virada do mês contam em cada mês só os dias dele", () => {
    const meses = resumoPorMes([aus("a", "2026-11-25", "2026-12-04")], "2026-10-15", 3);
    expect(meses[1].diasFora).toBe(6); // 25 a 30/11
    expect(meses[2].diasFora).toBe(4); // 1 a 4/12
  });
});

const programacao = (id: string, gozoInicio: string, status: ProgramacaoFerias["status"] = "PROGRAMADA"): ProgramacaoFerias => ({
  id, aquisitivoInicio: "2025-03-01", gozoInicio, gozoFim: gozoInicio, dias: 1, diasAbono: 0, status, observacao: null, passouDaData: false,
});
const periodo = (programacoes: ProgramacaoFerias[]): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 0, situacao: "PROGRAMADA", nivel: "ok",
  diasParaLimite: null, diasParaCompletar: null, foraDoPrazo: false, doHistorico: false, programacoes,
});
const pessoa = (nome: string, programacoes: ProgramacaoFerias[]): PessoaFerias => ({
  employeeId: nome, nome, empresa: null, setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos: [periodo(programacoes)],
});
const lista = (pessoas: PessoaFerias[]): ListaFerias => ({ hoje: "2026-10-15", pessoas, semDataDeAdmissao: [], resumo: { vencidas: 0, aVencer: 0 }, feriados: {} });

describe("avisar e pagar", () => {
  test("avisar 30 dias antes e pagar 2 dias antes, só do que ainda não começou, o mais urgente primeiro", () => {
    const prazos = prazosDeAviso(lista([
      pessoa("Bia", [programacao("g2", "2026-12-14")]),
      pessoa("Ana", [programacao("g1", "2026-10-26"), programacao("g0", "2026-09-01"), programacao("g9", "2026-11-30", "GOZADA")]),
    ]));
    expect(prazos.map((p) => p.nome)).toEqual(["Ana", "Bia"]);
    expect(prazos[0]).toMatchObject({ avisarAte: "2026-09-26", pagarAte: "2026-10-24", diasParaAvisar: -19, diasParaPagar: 9 });
    expect(prazos[1]).toMatchObject({ avisarAte: "2026-11-14", pagarAte: "2026-12-12" });
  });
});

describe("aviso por escrito (já avisei)", () => {
  const avisada: ProgramacaoFerias = { ...programacao("g3", "2026-11-23"), avisadoEm: "2026-10-10T15:00:00.000Z" };

  test("a lista traz o aviso e deixa os já avisados por último", () => {
    const prazos = prazosDeAviso(lista([
      pessoa("Ana", [avisada]),
      pessoa("Bia", [programacao("g4", "2026-12-14")]),
    ]));
    expect(prazos.map((p) => [p.nome, p.avisadoEm])).toEqual([["Bia", null], ["Ana", "2026-10-10T15:00:00.000Z"]]);
  });
});

describe("repouso na regra do início", () => {
  test("com repouso na terça, vedam-se a terça e os 2 dias antes; a quinta passa", () => {
    expect(motivoInicioVedado("2026-12-06", {}, [2])).toMatch(/domingo está a 2 dias do repouso semanal \(terça-feira\)/);
    expect(motivoInicioVedado("2026-12-10", {}, [2])).toBeNull(); // quinta: nem a sexta nem o sábado são terça
    expect(motivoInicioVedado("2026-12-08", {}, [2])).toMatch(/terça-feira é o dia de repouso/);
  });

  test("data que não existe não vira vedada nem estoura", () => {
    expect(motivoInicioVedado("20266-10-16", {})).toBeNull();
    expect(motivoInicioVedado("2026-02-31", {})).toBeNull();
    expect(motivoInicioVedado("2026-13-01", {})).toBeNull(); // mês que não existe: já estourava com RangeError
    expect(motivoInicioVedado("2026-00-10", {})).toBeNull();
  });

  test("o texto do repouso e o prazo de aviso", () => {
    expect(repousosPorExtenso([0, 6])).toBe("dom e sáb");
    expect(prazoParaAvisar("2026-12-14")).toBe("2026-11-14");
  });
});
