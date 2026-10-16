import { describe, expect, test } from "vitest";
import type { ListaFerias, PeriodoFerias, PessoaFerias } from "../../../../api/client";
import { contarPorFiltro, dataBr, fimEVolta, linhasDaLista, pertenceAoFiltro, resumoProgramacao, rotuloDaSituacao, textoPrazo, tomDaSituacao } from "../feriasFormato";

const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 107, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], ...o,
});
const pessoa = (nome: string, periodos: PeriodoFerias[]): PessoaFerias => ({ employeeId: nome, nome, empresa: null, setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos });
const lista = (pessoas: PessoaFerias[]): ListaFerias => ({ hoje: "2026-10-15", pessoas, semDataDeAdmissao: [], resumo: { vencidas: 0, aVencer: 0 }, feriados: {} });

describe("formatação", () => {
  test("dataBr inverte a data e trata vazio", () => {
    expect(dataBr("2027-01-30")).toBe("30/01/2027");
    expect(dataBr(null)).toBe("—");
  });
  test("textoPrazo diz quanto falta ou há quanto venceu", () => {
    expect(textoPrazo(periodo({ diasParaLimite: 107 }))).toBe("faltam 107 dias");
    expect(textoPrazo(periodo({ diasParaLimite: 1 }))).toBe("faltam 1 dia");
    expect(textoPrazo(periodo({ diasParaLimite: 0 }))).toBe("vence hoje");
    expect(textoPrazo(periodo({ diasParaLimite: -12 }))).toBe("venceu há 12 dias");
    expect(textoPrazo(periodo({ situacao: "EM_AQUISICAO", diasParaLimite: null, diasParaCompletar: 289 }))).toBe("direito em 289 dias");
    expect(textoPrazo(periodo({ situacao: "GOZADA", diasParaLimite: null }))).toBe("");
  });
  test("tom e rótulo seguem o nível do alerta", () => {
    expect(tomDaSituacao(periodo({ nivel: "perigo", situacao: "VENCIDA" }))).toBe("danger");
    expect(tomDaSituacao(periodo({ nivel: "atencao", situacao: "A_VENCER" }))).toBe("warning");
    expect(tomDaSituacao(periodo({ situacao: "PROGRAMADA" }))).toBe("info");
    expect(tomDaSituacao(periodo({ situacao: "GOZADA" }))).toBe("success");
    expect(rotuloDaSituacao(periodo({ situacao: "PROGRAMADA", foraDoPrazo: true, nivel: "perigo" }))).toBe("Fora do prazo");
    expect(rotuloDaSituacao(periodo({ situacao: "DISPONIVEL" }))).toBe("No prazo");
  });
  test("resumoProgramacao mostra datas, dias e abono", () => {
    expect(resumoProgramacao({ id: "1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", gozoFim: "2026-12-20", dias: 20, diasAbono: 10, status: "PROGRAMADA", observacao: null, passouDaData: false }))
      .toBe("01/12/2026 a 20/12/2026 · 20 dias + abono de 10");
  });
  test("fimEVolta calcula o último dia e a volta", () => {
    expect(fimEVolta("2026-12-01", 30)).toEqual({ fim: "2026-12-30", volta: "2026-12-31" });
    expect(fimEVolta("", 30)).toBeNull();
    expect(fimEVolta("2026-12-01", 0)).toBeNull();
  });
});

describe("lista e filtros", () => {
  const ana = pessoa("Ana", [periodo({ situacao: "DISPONIVEL", nivel: "ok", limiteInicioGozo: "2027-06-01" })]);
  const bia = pessoa("Bia", [periodo({ situacao: "VENCIDA", nivel: "perigo", limiteInicioGozo: "2026-09-01" }), periodo({ situacao: "EM_AQUISICAO", nivel: "ok", limiteInicioGozo: "2028-01-01", aquisitivoInicio: "2026-03-01" })]);
  const caio = pessoa("Caio", [periodo({ situacao: "A_VENCER", nivel: "atencao", limiteInicioGozo: "2027-01-10" }), periodo({ situacao: "PROGRAMADA", nivel: "ok", limiteInicioGozo: "2027-03-01" }), periodo({ situacao: "GOZADA", limiteInicioGozo: "2026-02-01" })]);

  test("urgentes primeiro, depois pelo limite", () => {
    const ordem = linhasDaLista(lista([ana, bia, caio])).map((l) => `${l.pessoa.nome}:${l.periodo.situacao}`);
    expect(ordem[0]).toBe("Bia:VENCIDA");
    expect(ordem[1]).toBe("Caio:A_VENCER");
    expect(ordem[ordem.length - 1]).toBe("Bia:EM_AQUISICAO");
  });
  test("filtros e contagens", () => {
    const linhas = linhasDaLista(lista([ana, bia, caio]));
    expect(contarPorFiltro(linhas)).toEqual({ PENDENTES: 3, PROGRAMADAS: 1, EM_AQUISICAO: 1, GOZADAS: 1, TODAS: 6 });
    expect(pertenceAoFiltro({ situacao: "VENCIDA", foraDoPrazo: false }, "PENDENTES")).toBe(true);
    expect(pertenceAoFiltro({ situacao: "PROGRAMADA", foraDoPrazo: false }, "PENDENTES")).toBe(false);
    expect(pertenceAoFiltro({ situacao: "PROGRAMADA", foraDoPrazo: true }, "PENDENTES")).toBe(true);
    expect(pertenceAoFiltro({ situacao: "EM_AQUISICAO", foraDoPrazo: false }, "PENDENTES")).toBe(false);
  });
});
