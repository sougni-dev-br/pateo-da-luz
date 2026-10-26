import { describe, expect, test } from "vitest";
import type { PeriodoFerias, PessoaFerias, ProgramacaoFerias, SolicitacaoFerias } from "../../../../api/client";
import { ordenarPorUrgencia, periodoDaFicha, proximoPasso, resumoDoQueFazer } from "../proximoPasso";

const HOJE = "2026-10-21";
const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 101, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], solicitacao: null, ...o,
});
const programada = (gozoInicio: string, dias: number, extra: Partial<ProgramacaoFerias> = {}): ProgramacaoFerias => ({
  id: "g1", aquisitivoInicio: "2025-03-01", gozoInicio, gozoFim: gozoInicio, dias, diasAbono: 0, status: "PROGRAMADA", observacao: null, passouDaData: false, ...extra,
});
const pedido = (inicio: string, dias = 15): SolicitacaoFerias => ({ id: "s1", inicio, fim: inicio, dias, diasAbono: 0, observacao: null, registradaEm: "2026-10-20T12:00:00.000Z" });
const pessoa = (periodos: PeriodoFerias[]): PessoaFerias =>
  ({ employeeId: "e1", nome: "Ana", empresa: null, setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos });

describe("próximo passo", () => {
  test("prazo vencido sem data: definir já", () => {
    const p = proximoPasso(periodo({ situacao: "VENCIDA", nivel: "perigo", limiteInicioGozo: "2026-10-01" }), HOJE);
    expect(p).toEqual({ texto: "Definir a data já: o prazo venceu em 01/10/2026", tipo: "vencido", urgente: true });
  });

  test("dias a programar: definir a data até o limite, e urgente quando o prazo aperta", () => {
    expect(proximoPasso(periodo(), HOJE)).toEqual({ texto: "Definir a data até 30/01/2027", tipo: "definir", urgente: false });
    expect(proximoPasso(periodo({ nivel: "atencao", situacao: "A_VENCER" }), HOJE)?.urgente).toBe(true);
  });

  test("pedido aguardando: responder ao pedido e definir a data", () => {
    expect(proximoPasso(periodo({ solicitacao: pedido("2026-12-14") }), HOJE)?.texto).toBe("Responder ao pedido e definir a data até 30/01/2027");
  });

  test("parte já programada e saldo: programar o resto", () => {
    const p = proximoPasso(periodo({ diasPendentes: 16, programacoes: [programada("2026-12-04", 14)] }), HOJE);
    expect(p?.texto).toBe("Programar o resto (16 dias) até 30/01/2027");
  });

  test("tudo programado com data diferente do pedido: avisar que a empresa quer outra data", () => {
    const p = proximoPasso(periodo({ diasPendentes: 0, situacao: "PROGRAMADA", solicitacao: pedido("2026-12-14"), programacoes: [programada("2026-12-21", 15, { avisadoEm: "2026-10-10T12:00:00.000Z" })] }), HOJE);
    expect(p?.texto).toBe("Avisar que a empresa quer outra data (ele pediu 14/12/2026)");
  });

  test("programada sem aviso: avisar até 30 dias antes; passou do prazo de aviso fica urgente", () => {
    const longe = proximoPasso(periodo({ diasPendentes: 0, situacao: "PROGRAMADA", programacoes: [programada("2026-12-21", 30)] }), HOJE);
    expect(longe).toEqual({ texto: "Avisar até 21/11/2026", tipo: "avisar", urgente: false });
    const tarde = proximoPasso(periodo({ diasPendentes: 0, situacao: "PROGRAMADA", programacoes: [programada("2026-11-10", 30)] }), HOJE);
    expect(tarde).toEqual({ texto: "Avisar já: o prazo era 11/10/2026", tipo: "avisar", urgente: true });
  });

  test("programada e já avisada não tem providência; a que já passou da data pede confirmar", () => {
    const avisada = periodo({ diasPendentes: 0, situacao: "PROGRAMADA", programacoes: [programada("2026-12-21", 30, { avisadoEm: "2026-10-10T12:00:00.000Z" })] });
    expect(proximoPasso(avisada, HOJE)).toBeNull();
    const passou = periodo({ diasPendentes: 0, situacao: "PROGRAMADA", programacoes: [programada("2026-10-05", 30, { passouDaData: true, avisadoEm: "2026-08-01T12:00:00.000Z" })] });
    expect(proximoPasso(passou, HOJE)?.texto).toBe("Confirmar que gozou");
  });

  test("período em aquisição ou já gozado não tem providência", () => {
    expect(proximoPasso(periodo({ situacao: "EM_AQUISICAO" }), HOJE)).toBeNull();
    expect(proximoPasso(periodo({ diasPendentes: 0, situacao: "GOZADA" }), HOJE)).toBeNull();
  });
});

describe("período da ficha", () => {
  test("prefere o que tem pedido, depois o que tem dias a programar, depois o que tem férias programadas", () => {
    const comPedido = periodo({ aquisitivoInicio: "2024-03-01", solicitacao: pedido("2026-12-14"), diasPendentes: 0, situacao: "PROGRAMADA" });
    const pendente = periodo({ aquisitivoInicio: "2025-03-01" });
    expect(periodoDaFicha(pessoa([pendente, comPedido]))?.aquisitivoInicio).toBe("2024-03-01");
    expect(periodoDaFicha(pessoa([periodo({ situacao: "EM_AQUISICAO" }), pendente]))?.aquisitivoInicio).toBe("2025-03-01");
    const soProgramada = periodo({ diasPendentes: 0, situacao: "PROGRAMADA", programacoes: [programada("2026-12-21", 30)] });
    expect(periodoDaFicha(pessoa([soProgramada]))).toBe(soProgramada);
    expect(periodoDaFicha(pessoa([periodo({ situacao: "EM_AQUISICAO" })]))).toBeNull();
  });
});

describe("urgência e resumo da folha", () => {
  const nomeado = (nome: string, empresa: string | null, periodos: PeriodoFerias[]): PessoaFerias => ({ ...pessoa(periodos), employeeId: nome, nome, empresa });
  const vencida = periodo({ situacao: "VENCIDA", nivel: "perigo", limiteInicioGozo: "2026-10-01" });
  const comPedido = periodo({ solicitacao: pedido("2026-12-14") });
  const nada = periodo({ situacao: "EM_AQUISICAO", diasPendentes: 0 });

  test("dentro de cada empresa, prazo vencido, depois pedido, depois o resto, e quem não tem nada por último", () => {
    const todas = [nomeado("Ana", "A", [nada]), nomeado("Bia", "A", [comPedido]), nomeado("Caio", "B", [nada]), nomeado("Duda", "A", [vencida]), nomeado("Edu", "B", [vencida])];
    expect(ordenarPorUrgencia(todas, HOJE).map((p) => p.nome)).toEqual(["Duda", "Bia", "Ana", "Edu", "Caio"]);
  });

  test("o resumo junta as providências por tipo, com os nomes, e ignora quem não tem nada", () => {
    const itens = resumoDoQueFazer([nomeado("Ana", null, [nada]), nomeado("Bia", null, [comPedido]), nomeado("Duda", null, [vencida]), nomeado("Edu", null, [vencida])], HOJE);
    expect(itens).toEqual([
      { tipo: "vencido", urgente: true, nomes: ["Duda", "Edu"] },
      { tipo: "responder", urgente: false, nomes: ["Bia"] },
    ]);
  });

  test("quem completa o período aquisitivo em até 90 dias entra no resumo, do mais próximo ao mais distante", () => {
    const completa = (dias: number, fim: string) => periodo({ situacao: "EM_AQUISICAO", diasPendentes: 0, diasParaCompletar: dias, aquisitivoFim: fim });
    const itens = resumoDoQueFazer([
      nomeado("Longe", null, [completa(120, "2027-02-18")]),
      nomeado("Perto", null, [completa(20, "2026-11-09")]),
      nomeado("Meio", null, [completa(70, "2027-01-01")]),
    ], HOJE);
    expect(itens).toEqual([{ tipo: "completar", urgente: true, nomes: ["Perto (10/11/2026, em 20 dias)", "Meio (02/01/2027, em 70 dias)"] }]);
  });
});
