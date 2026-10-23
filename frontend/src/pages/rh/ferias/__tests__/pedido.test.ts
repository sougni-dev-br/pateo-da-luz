import { describe, expect, test } from "vitest";
import type { ListaFerias, PeriodoFerias, PessoaFerias, ProgramacaoFerias, SolicitacaoFerias } from "../../../../api/client";
import { compararPedido, diferencaEmPalavras, pedidosAguardando, resumoDoPedido } from "../pedido";

const pedido = (o: Partial<SolicitacaoFerias> = {}): SolicitacaoFerias => ({
  id: "s1", inicio: "2026-12-14", fim: "2026-12-28", dias: 15, diasAbono: 0, observacao: null, registradaEm: "2026-10-20T12:00:00.000Z", ...o,
});
const programada = (gozoInicio: string, dias: number, id = "g1"): ProgramacaoFerias => ({
  id, aquisitivoInicio: "2025-03-01", gozoInicio, gozoFim: gozoInicio, dias, diasAbono: 0, status: "PROGRAMADA", observacao: null, passouDaData: false,
});
const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 107, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], solicitacao: null, ...o,
});

describe("pedido do colaborador × o que a empresa quer", () => {
  test("sem pedido não há comparação", () => {
    expect(compararPedido(periodo())).toBeNull();
  });

  test("pedido sem programação fica aguardando a empresa", () => {
    const c = compararPedido(periodo({ solicitacao: pedido() }));
    expect(c).toMatchObject({ situacao: "AGUARDANDO", programacao: null, diferencaEmDias: null, passaDoPrazo: false });
  });

  test("programação com o mesmo início e os mesmos dias atende o pedido", () => {
    const c = compararPedido(periodo({ solicitacao: pedido(), programacoes: [programada("2026-12-14", 15)] }));
    expect(c).toMatchObject({ situacao: "ATENDIDO", diferencaEmDias: 0 });
  });

  test("programação em outra data é diferente do pedido, com a diferença em dias", () => {
    const depois = compararPedido(periodo({ solicitacao: pedido(), programacoes: [programada("2026-12-21", 15)] }));
    expect(depois).toMatchObject({ situacao: "DIFERENTE", diferencaEmDias: 7 });
    const antes = compararPedido(periodo({ solicitacao: pedido(), programacoes: [programada("2026-12-11", 15)] }));
    expect(antes?.diferencaEmDias).toBe(-3);
  });

  test("mesmo início com dias diferentes também é diferente", () => {
    expect(compararPedido(periodo({ solicitacao: pedido(), programacoes: [programada("2026-12-14", 10)] }))?.situacao).toBe("DIFERENTE");
  });

  test("com várias partes, a mais próxima do pedido é a comparada; uma parte igual atende", () => {
    const partes = [programada("2027-01-11", 15, "g2"), programada("2026-12-16", 15, "g1")];
    expect(compararPedido(periodo({ solicitacao: pedido(), programacoes: partes }))?.programacao?.id).toBe("g1");
    expect(compararPedido(periodo({ solicitacao: pedido(), programacoes: [...partes, programada("2026-12-14", 15, "g3")] }))?.situacao).toBe("ATENDIDO");
  });

  test("férias já gozadas não contam como o que a empresa quer", () => {
    const gozada: ProgramacaoFerias = { ...programada("2026-12-14", 15), status: "GOZADA" };
    expect(compararPedido(periodo({ solicitacao: pedido(), programacoes: [gozada] }))?.situacao).toBe("AGUARDANDO");
  });

  test("pedido que termina depois do fim do prazo avisa que passa do prazo", () => {
    const c = compararPedido(periodo({ fimConcessivo: "2026-12-20", solicitacao: pedido() }));
    expect(c?.passaDoPrazo).toBe(true);
    expect(compararPedido(periodo({ fimConcessivo: "2026-12-28", solicitacao: pedido() }))?.passaDoPrazo).toBe(false);
  });
});

describe("textos", () => {
  test("resumo do pedido, com e sem abono", () => {
    expect(resumoDoPedido(pedido())).toBe("14/12/2026 a 28/12/2026 · 15 dias");
    expect(resumoDoPedido(pedido({ dias: 1, fim: "2026-12-14", diasAbono: 10 }))).toBe("14/12/2026 a 14/12/2026 · 1 dia + abono de 10");
  });

  test("diferença em palavras", () => {
    expect(diferencaEmPalavras(7)).toBe("7 dias depois do pedido");
    expect(diferencaEmPalavras(-1)).toBe("1 dia antes do pedido");
    expect(diferencaEmPalavras(0)).toBe("");
    expect(diferencaEmPalavras(null)).toBe("");
  });
});

describe("pedidos aguardando", () => {
  const pessoa = (nome: string, periodos: PeriodoFerias[]): PessoaFerias =>
    ({ employeeId: nome, nome, empresa: null, setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos });
  test("conta só os pedidos que a empresa ainda não respondeu com uma programação", () => {
    const lista: ListaFerias = {
      hoje: "2026-10-20", semDataDeAdmissao: [], resumo: { vencidas: 0, aVencer: 0 }, feriados: {},
      pessoas: [
        pessoa("Ana", [periodo({ solicitacao: pedido() })]),
        pessoa("Bia", [periodo({ solicitacao: pedido(), programacoes: [programada("2026-12-14", 15)] })]),
        pessoa("Caio", [periodo()]),
        pessoa("Dani", [periodo({ solicitacao: pedido(), programacoes: [programada("2027-01-11", 15)] })]),
      ],
    };
    expect(pedidosAguardando(lista)).toBe(1);
  });
});
