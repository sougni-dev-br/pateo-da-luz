import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ListaFerias, PeriodoFerias, PessoaFerias, ProgramacaoFerias } from "../../../../api/client";
import { ImpressaoTela } from "../ImpressaoTela";
import { linhasDaLista } from "../feriasFormato";

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

const abrir = (visao: "linha" | "lista" = "linha") =>
  render(<ImpressaoTela lista={lista} visao={visao} pessoas={lista.pessoas} linhas={linhasDaLista(lista)} filtroRotulo="Todas" empresaDaTela="" ausencias={[]} onClose={() => undefined} />);

let imprimir: ReturnType<typeof vi.fn>;
beforeEach(() => { imprimir = vi.fn(); window.print = imprimir as unknown as typeof window.print; document.title = "Pateo da Luz"; });
afterEach(() => { document.body.classList.remove("imprimindo-ferias"); });

describe("ImpressaoTela", () => {
  test("a linha do tempo oferece período, legenda e faixa de cobertura; a lista não", () => {
    abrir("linha");
    const d = screen.getByRole("dialog", { name: "Imprimir a tela" });
    expect(within(d).getByRole("radio", { name: /12 meses/ })).toBeChecked();
    expect(within(d).getByRole("radio", { name: /3 meses/ })).not.toBeChecked(); // trimestre
    expect(within(d).getByRole("checkbox", { name: /Legenda das cores/ })).toBeChecked();
    expect(within(d).getByRole("checkbox", { name: /Quem está fora/ })).toBeChecked();
  });

  test("na lista só aparecem papel, orientação e empresas", () => {
    abrir("lista");
    const d = screen.getByRole("dialog");
    expect(within(d).queryByRole("radio", { name: /12 meses/ })).toBeNull();
    expect(within(d).queryByRole("checkbox", { name: /Legenda/ })).toBeNull();
    expect(within(d).getByRole("radio", { name: "A4" })).toBeChecked();
    expect(within(d).getAllByRole("table").length).toBeGreaterThan(0);
  });

  test("imprimir marca o corpo, define o papel escolhido, abre a impressora e limpa no fim", () => {
    abrir("linha");
    fireEvent.click(screen.getByRole("radio", { name: "A3" }));
    fireEvent.click(screen.getByRole("radio", { name: "Em pé" }));
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains("imprimindo-ferias")).toBe(true);
    expect(document.head.textContent).toContain("@page { size: A3 portrait; margin: 10mm; }");
    expect(document.title).toBe("Pateo da Luz"); // imprimir não mexe no nome do arquivo
    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.classList.contains("imprimindo-ferias")).toBe(false);
    expect(document.head.textContent).not.toContain("A3 portrait");
  });

  test("salvar em PDF sugere o nome do arquivo e devolve o título depois", () => {
    abrir("lista");
    fireEvent.click(screen.getByRole("button", { name: "Salvar em PDF" }));
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("Ferias - Lista - 2026-10-15");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Pateo da Luz");
  });

  test("restaurar padrão só liga depois de mudar algo e desfaz as escolhas", () => {
    abrir("linha");
    const restaurar = screen.getByRole("button", { name: "Restaurar padrão" });
    expect(restaurar).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("radio", { name: /18 meses/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Legenda das cores/ }));
    expect(restaurar).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(restaurar);
    expect(screen.getByRole("radio", { name: /12 meses/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Legenda das cores/ })).toBeChecked();
    expect(restaurar).toHaveAttribute("aria-disabled", "true");
  });

  test("desmarcar todas as empresas tira os botões de imprimir", () => {
    abrir("linha");
    fireEvent.click(screen.getByRole("checkbox", { name: /Frei Caneca/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Pateo da Luz/ }));
    expect(screen.getByText("Marque ao menos uma empresa.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar em PDF" }));
    expect(imprimir).not.toHaveBeenCalled();
  });

  test("só o trimestre leva marcas por semana na folha", () => {
    abrir("linha");
    const d = screen.getByRole("dialog");
    expect(d.querySelectorAll(".fe-ti-seg").length).toBe(0);
    fireEvent.click(screen.getByRole("radio", { name: /3 meses/ }));
    const dias = [...d.querySelectorAll(".fe-ti-seg")].map((e) => e.textContent);
    expect(dias.length).toBeGreaterThanOrEqual(12);
    expect(dias.slice(0, 3)).toEqual(["5", "12", "19"]); // out/2026: primeira segunda é 05/10
  });

  test("a folha da linha do tempo traz as barras e a faixa de cobertura", () => {
    abrir("linha");
    const d = screen.getByRole("dialog");
    expect(within(d).getByText("Caio Reis")).toBeInTheDocument();
    expect(within(d).getByText("Quem está fora")).toBeInTheDocument();
    expect(within(d).getByText(/01\/12–30\/12|30d/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Quem está fora/ }));
    expect(within(d).queryByText("Quem está fora")).toBeNull();
  });
});
