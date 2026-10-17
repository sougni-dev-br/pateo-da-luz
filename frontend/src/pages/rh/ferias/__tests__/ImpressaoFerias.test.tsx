import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ListaFerias, PeriodoFerias, PessoaFerias, ProgramacaoFerias } from "../../../../api/client";
import { ImpressaoFerias } from "../ImpressaoFerias";

const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 107, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], ...o,
});
const pessoa = (nome: string, empresa: string, periodos: PeriodoFerias[]): PessoaFerias =>
  ({ employeeId: nome, nome, empresa, setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos });
const programada: ProgramacaoFerias = { id: "g1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", gozoFim: "2026-12-30", dias: 30, diasAbono: 0, status: "PROGRAMADA", observacao: null, passouDaData: false };

const lista: ListaFerias = {
  hoje: "2026-10-15", semDataDeAdmissao: [], resumo: { vencidas: 0, aVencer: 0 }, feriados: {},
  pessoas: [
    pessoa("Ana Souza", "Pateo da Luz", [periodo()]),
    pessoa("Bia Lima", "Frei Caneca", [periodo({ nivel: "atencao", situacao: "A_VENCER", diasParaLimite: 40 })]),
    pessoa("Caio Reis", "Frei Caneca", [periodo({ situacao: "PROGRAMADA", diasPendentes: 0, programacoes: [programada] })]),
  ],
};

let imprimir: ReturnType<typeof vi.fn>;
beforeEach(() => { imprimir = vi.fn(); window.print = imprimir as unknown as typeof window.print; });
afterEach(() => { document.body.classList.remove("imprimindo-ferias"); });

describe("ImpressaoFerias", () => {
  test("por padrão imprime o papel de conversa, uma folha por empresa, com espaço para anotar", () => {
    render(<ImpressaoFerias lista={lista} onClose={() => undefined} />);
    const dialogo = screen.getByRole("dialog", { name: "Imprimir férias por empresa" });
    const folhas = within(dialogo).getAllByRole("region", { name: /Programação de férias —/ });
    expect(folhas.map((f) => f.getAttribute("aria-label"))).toEqual(["Programação de férias — Frei Caneca", "Programação de férias — Pateo da Luz"]);
    expect(within(folhas[0]).getByText("Bia Lima")).toBeInTheDocument();
    expect(within(folhas[0]).queryByText("Caio Reis")).toBeNull();
    expect(within(folhas[0]).getByText("Data combinada")).toBeInTheDocument();
    expect(within(folhas[0]).getByText("Ciente")).toBeInTheDocument();
  });

  test("o modo da contabilidade lista só o que está programado, com fim e volta", () => {
    render(<ImpressaoFerias lista={lista} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("radio", { name: /Para a contabilidade/ }));
    const dialogo = screen.getByRole("dialog");
    const folha = within(dialogo).getByRole("region", { name: "Férias programadas — Frei Caneca" });
    expect(within(folha).getByText("Caio Reis")).toBeInTheDocument();
    expect(within(folha).getByText("30/12/2026")).toBeInTheDocument();
    expect(within(folha).getByText("31/12/2026")).toBeInTheDocument();
    expect(within(dialogo).queryByRole("region", { name: /Pateo da Luz/ })).toBeNull();
    expect(screen.getByText(/Ainda há períodos sem data/)).toBeInTheDocument();
  });

  test("desmarcar uma empresa tira a folha dela; sem nenhuma, não imprime", () => {
    render(<ImpressaoFerias lista={lista} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Frei Caneca/ }));
    expect(within(screen.getByRole("dialog")).queryByRole("region", { name: /Frei Caneca/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Pateo da Luz/ }));
    expect(screen.getByText("Marque ao menos uma empresa.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(imprimir).not.toHaveBeenCalled();
  });

  test("imprimir marca o corpo da página, abre a impressora e limpa depois", () => {
    render(<ImpressaoFerias lista={lista} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains("imprimindo-ferias")).toBe(true);
    expect(document.head.textContent).toContain("A4 landscape");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.classList.contains("imprimindo-ferias")).toBe(false);
    expect(document.head.textContent).not.toContain("A4 landscape");
  });

  test("foca a primeira opção ao abrir e fecha com Esc", () => {
    const fechar = vi.fn();
    render(<ImpressaoFerias lista={lista} onClose={fechar} />);
    expect(screen.getByRole("radio", { name: /Para conversar/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(fechar).toHaveBeenCalled();
  });

  test("a cópia de impressão fica fora da tela e escondida do leitor de tela", () => {
    render(<ImpressaoFerias lista={lista} onClose={() => undefined} />);
    const area = document.body.querySelector(".fe-area-impressao");
    expect(area).not.toBeNull();
    expect(area?.getAttribute("aria-hidden")).toBe("true");
  });
});
