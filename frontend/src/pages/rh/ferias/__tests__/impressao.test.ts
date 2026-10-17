import { describe, expect, test } from "vitest";
import type { ListaFerias, PeriodoFerias, PessoaFerias, ProgramacaoFerias } from "../../../../api/client";
import { SEM_EMPRESA, folhasDeConversa, folhasParaContabilidade } from "../impressao";

const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 107, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], ...o,
});
const pessoa = (nome: string, empresa: string | null, periodos: PeriodoFerias[]): PessoaFerias =>
  ({ employeeId: nome, nome, empresa, setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos });
const lista = (pessoas: PessoaFerias[]): ListaFerias => ({ hoje: "2026-10-15", pessoas, semDataDeAdmissao: [], resumo: { vencidas: 0, aVencer: 0 }, feriados: {} });
const prog = (o: Partial<ProgramacaoFerias> = {}): ProgramacaoFerias => ({
  id: "g1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", gozoFim: "2026-12-30", dias: 30, diasAbono: 0, status: "PROGRAMADA", observacao: null, passouDaData: false, ...o,
});

describe("folhasDeConversa", () => {
  test("uma folha por empresa, só com quem ainda precisa de data, urgentes primeiro", () => {
    const folhas = folhasDeConversa(lista([
      pessoa("Ana", "Pateo da Luz", [periodo()]),
      pessoa("Bia", "Frei Caneca", [periodo({ nivel: "atencao", situacao: "A_VENCER", limiteInicioGozo: "2027-01-02", diasParaLimite: 79 })]),
      pessoa("Caio", "Frei Caneca", [periodo({ situacao: "EM_AQUISICAO", diasPendentes: 30 })]),
      pessoa("Dani", "Frei Caneca", [periodo({ situacao: "PROGRAMADA", diasPendentes: 0, programacoes: [prog()] })]),
      pessoa("Edu", "Frei Caneca", [periodo({ situacao: "GOZADA", diasPendentes: 0 })]),
      pessoa("Flavia", "Frei Caneca", [periodo({ nivel: "perigo", situacao: "VENCIDA", limiteInicioGozo: "2026-09-01", diasParaLimite: -44 })]),
    ]));
    expect(folhas.map((f) => f.empresa)).toEqual(["Frei Caneca", "Pateo da Luz"]);
    expect(folhas[0].linhas.map((l) => l.nome)).toEqual(["Flavia", "Bia"]);
    expect(folhas[0].linhas[0]).toMatchObject({ urgente: true, limite: "01/09/2026", prazo: "venceu há 44 dias", diasAProgramar: 30, periodo: "01/03/2025 a 28/02/2026" });
  });

  test("quem tem parte programada entra pelo que falta e mostra o que já foi combinado", () => {
    const [folha] = folhasDeConversa(lista([
      pessoa("Ana", "Pateo", [periodo({ diasPendentes: 10, diasProgramados: 20, programacoes: [prog({ dias: 20 })] })]),
    ]));
    expect(folha.linhas[0]).toMatchObject({ diasAProgramar: 10, jaProgramado: "01/12/2026 (20 d)" });
  });

  test("período programado fora do prazo volta para a conversa", () => {
    const [folha] = folhasDeConversa(lista([
      pessoa("Ana", "Pateo", [periodo({ situacao: "PROGRAMADA", nivel: "perigo", foraDoPrazo: true, diasPendentes: 0, programacoes: [prog({ gozoInicio: "2027-02-25", dias: 10 })] })]),
    ]));
    expect(folha.linhas).toHaveLength(1);
  });

  test("sem empresa fica por último; sem ninguém pendente não gera folha", () => {
    const folhas = folhasDeConversa(lista([pessoa("Ana", null, [periodo()]), pessoa("Bia", "Pateo", [periodo()])]));
    expect(folhas.map((f) => f.empresa)).toEqual(["Pateo", SEM_EMPRESA]);
    expect(folhasDeConversa(lista([pessoa("Ana", "Pateo", [periodo({ situacao: "GOZADA", diasPendentes: 0 })])]))).toEqual([]);
  });
});

describe("folhasParaContabilidade", () => {
  test("uma linha por parte programada, com fim e retorno, em ordem de início", () => {
    const folhas = folhasParaContabilidade(lista([
      pessoa("Ana", "Pateo", [periodo({ situacao: "PROGRAMADA", diasPendentes: 0, programacoes: [prog({ id: "a", gozoInicio: "2027-01-05", dias: 20, diasAbono: 10 })] })]),
      pessoa("Bia", "Pateo", [periodo({ situacao: "PROGRAMADA", diasPendentes: 0, programacoes: [prog({ id: "b", gozoInicio: "2026-12-01", dias: 30, observacao: "Fim de ano" })] })]),
    ]));
    expect(folhas).toHaveLength(1);
    expect(folhas[0].linhas.map((l) => l.nome)).toEqual(["Bia", "Ana"]);
    expect(folhas[0].linhas[0]).toMatchObject({ inicio: "01/12/2026", fim: "30/12/2026", retorno: "31/12/2026", dias: 30, abono: 0, observacao: "Fim de ano" });
    expect(folhas[0].linhas[1]).toMatchObject({ inicio: "05/01/2027", fim: "24/01/2027", retorno: "25/01/2027", dias: 20, abono: 10 });
  });

  test("ignora gozadas e avisa quando está fora do prazo", () => {
    const folhas = folhasParaContabilidade(lista([
      pessoa("Ana", "Pateo", [periodo({ situacao: "GOZADA", diasPendentes: 0, programacoes: [prog({ status: "GOZADA" })] })]),
      pessoa("Bia", "Pateo", [periodo({ situacao: "PROGRAMADA", foraDoPrazo: true, diasPendentes: 0, programacoes: [prog({ gozoInicio: "2027-02-25", dias: 10 })] })]),
    ]));
    expect(folhas[0].linhas).toHaveLength(1);
    expect(folhas[0].linhas[0].observacao).toBe("Fora do prazo (pagar em dobro)");
  });
});
