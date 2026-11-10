import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PeriodoFerias, PessoaFerias, ProgramacaoFerias } from "../../../../api/client";
import { ImpressaoIndividual } from "../ImpressaoIndividual";
import { fichaIndividual } from "../impressao";

const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 107, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], ...o,
});
const prog = (o: Partial<ProgramacaoFerias> = {}): ProgramacaoFerias => ({
  id: "g1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", gozoFim: "2026-12-14", dias: 14, diasAbono: 0, status: "PROGRAMADA", observacao: null, passouDaData: false, ...o,
});
const pessoa = (periodos: PeriodoFerias[]): PessoaFerias =>
  ({ employeeId: "e1", nome: "Jodeni", nomeCompleto: "Joana Dias", empresa: "Pateo da Luz", setor: "Cozinha", repousoSemanal: [0], repousoPelaEscala: false, admissao: "2023-03-01", nivel: "ok", periodos });

describe("fichaIndividual", () => {
  test("usa o nome completo, a empresa e o setor, e ordena os períodos do mais antigo ao mais novo", () => {
    const f = fichaIndividual(pessoa([periodo({ aquisitivoInicio: "2026-03-01", aquisitivoFim: "2027-02-28" }), periodo()]));
    expect(f).toMatchObject({ nome: "Joana Dias", empresa: "Pateo da Luz", setor: "Cozinha", admissao: "2023-03-01" });
    expect(f.periodos.map((p) => p.periodo)).toEqual(["01/03/2025 a 28/02/2026", "01/03/2026 a 28/02/2027"]);
  });

  test("cada parte traz início, último dia, volta e os prazos de aviso e pagamento", () => {
    const [p] = fichaIndividual(pessoa([periodo({ diasPendentes: 16, programacoes: [prog(), prog({ id: "g2", gozoInicio: "2027-01-12", dias: 16, diasAbono: 0 })] })])).periodos;
    expect(p.partes).toHaveLength(2);
    expect(p.partes[0]).toMatchObject({ inicio: "01/12/2026", ultimoDia: "14/12/2026", volta: "15/12/2026", dias: 14, avisarAte: "01/11/2026", pagarAte: "29/11/2026" });
    expect(p.podeSair).toBe("01/03/2026");
    expect(p.limite).toBe("30/01/2027");
  });

  test("pré-programada e fora do prazo trazem a observação; 'já gozou' sem data não vira parte", () => {
    const pre = fichaIndividual(pessoa([periodo({ aquisitivoInicio: "2026-03-01", aquisitivoFim: "2027-02-28", situacao: "EM_AQUISICAO", programacoes: [prog({ gozoInicio: "2027-06-01" })] })])).periodos[0];
    expect(pre.situacao).toBe("Pré-programada");
    expect(pre.observacao).toBe("Pré-programada: o direito só nasce em 01/03/2027");
    const fora = fichaIndividual(pessoa([periodo({ foraDoPrazo: true, programacoes: [prog({ id: "x", gozoInicio: null, status: "GOZADA", dias: 30 })] })])).periodos[0];
    expect(fora.observacao).toBe("Fora do prazo (pagar em dobro)");
    expect(fora.partes).toEqual([]);
  });
});

describe("ImpressaoIndividual", () => {
  let imprimir: ReturnType<typeof vi.fn>;
  beforeEach(() => { imprimir = vi.fn(); window.print = imprimir as unknown as typeof window.print; });
  afterEach(() => { document.body.classList.remove("imprimindo-ferias"); });

  test("mostra a ficha da pessoa e imprime em A4 em pé", () => {
    render(<ImpressaoIndividual pessoa={pessoa([periodo({ programacoes: [prog()] })])} hoje="2026-10-15" onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: /Imprimir férias de Joana Dias/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Férias · Joana Dias/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains("imprimindo-ferias")).toBe(true);
    expect(document.head.textContent).toContain("A4 portrait");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.classList.contains("imprimindo-ferias")).toBe(false);
  });

  test("Esc e Fechar chamam onClose", () => {
    const onClose = vi.fn();
    render(<ImpressaoIndividual pessoa={pessoa([periodo()])} hoje="2026-10-15" onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Fechar (Esc)" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
