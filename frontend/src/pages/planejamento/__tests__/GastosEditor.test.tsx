import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanejamentoLinhaDeGasto } from "../../../api/client";
import { GastosEditor, linhasPadraoDeGasto } from "../GastosEditor";

const ocupacao = (): PlanejamentoLinhaDeGasto => ({ grupo: "OCUPACAO", nome: "Ocupação", modo: "FIXO", valores: Array(12).fill(52000) });
const tributos = (): PlanejamentoLinhaDeGasto => ({ grupo: "TRIBUTOS", nome: "Tributos", modo: "PERCENTUAL", valores: Array(12).fill(0.06) });

function montar(gastos: PlanejamentoLinhaDeGasto[], sobre: { servicoPercentual?: number | null; desabilitado?: boolean } = {}) {
  const props = { gastos, servicoPercentual: null, desabilitado: false, onMudarGastos: vi.fn<(proximos: PlanejamentoLinhaDeGasto[]) => void>(), onMudarServico: vi.fn<(valor: number | null) => void>(), ...sobre };
  render(<GastosEditor {...props} />);
  return props;
}

describe("GastosEditor", () => {
  it("mostra valores em R$ e em % e muda só o mês digitado", () => {
    const p = montar([ocupacao(), tributos()]);
    expect(screen.getByLabelText("Ocupação em Jan")).toHaveValue("52.000");
    expect(screen.getByLabelText("Tributos em Jan")).toHaveValue("6");
    fireEvent.change(screen.getByLabelText("Ocupação em Mar"), { target: { value: "60.000" } });
    const proximos = (p.onMudarGastos.mock.calls[0][0] as PlanejamentoLinhaDeGasto[])[0];
    expect(proximos.valores[2]).toBe(60000);
    expect(proximos.valores[3]).toBe(52000);
  });

  it('"Todos" preenche os 12 meses da linha; percentual vira fração', () => {
    const p = montar([ocupacao(), tributos()]);
    fireEvent.change(screen.getByLabelText("Tributos, todos os meses"), { target: { value: "7,5" } });
    const linha = (p.onMudarGastos.mock.calls[0][0] as PlanejamentoLinhaDeGasto[])[1];
    expect(linha.valores.every((v) => v === 0.075)).toBe(true);
  });

  it("valor inválido ou percentual acima de 100% não chega ao pai", () => {
    const p = montar([ocupacao(), tributos()]);
    fireEvent.change(screen.getByLabelText("Ocupação em Jan"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Tributos em Jan"), { target: { value: "150" } });
    expect(p.onMudarGastos).not.toHaveBeenCalled();
  });

  it("serviço aceita vazio (volta a null) e recusa mais de 100%", () => {
    const p = montar([], { servicoPercentual: 0.09 });
    const campo = screen.getByLabelText("Serviço sobre as vendas, em %");
    expect(campo).toHaveValue("9");
    fireEvent.change(campo, { target: { value: "" } });
    expect(p.onMudarServico).toHaveBeenCalledWith(null);
    p.onMudarServico.mockClear();
    fireEvent.change(campo, { target: { value: "120" } });
    expect(p.onMudarServico).not.toHaveBeenCalled();
  });

  it("adiciona linha nova, mas não com nome repetido", () => {
    const p = montar([ocupacao()]);
    const nome = screen.getByLabelText("Nome da nova linha de gasto");
    fireEvent.change(nome, { target: { value: "ocupação" } });
    expect(screen.getByRole("button", { name: /Adicionar linha/ })).toBeDisabled();
    fireEvent.change(nome, { target: { value: "Marketing" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar linha/ }));
    const novas = p.onMudarGastos.mock.calls[0][0] as PlanejamentoLinhaDeGasto[];
    expect(novas.map((g) => g.nome)).toEqual(["Ocupação", "Marketing"]);
    expect(novas[1].valores).toHaveLength(12);
  });

  it("remove linha e oferece as linhas padrão quando está vazio", () => {
    const p = montar([ocupacao(), tributos()]);
    fireEvent.click(screen.getByRole("button", { name: "Remover Ocupação" }));
    expect((p.onMudarGastos.mock.calls[0][0] as PlanejamentoLinhaDeGasto[]).map((g) => g.nome)).toEqual(["Tributos"]);
  });

  it("sem gastos mostra o botão de linhas padrão; sem permissão não edita nem remove", () => {
    const vazio = montar([]);
    fireEvent.click(screen.getByRole("button", { name: "Usar as linhas padrão" }));
    expect((vazio.onMudarGastos.mock.calls[0][0] as PlanejamentoLinhaDeGasto[])).toHaveLength(9);
  });

  it("somente leitura: campos desabilitados e sem controles de edição", () => {
    montar([ocupacao()], { desabilitado: true });
    expect(screen.getByLabelText("Ocupação em Jan")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Remover/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Adicionar linha/ })).toBeNull();
  });

  it("as linhas padrão têm tributos em % e nomes únicos", () => {
    const linhas = linhasPadraoDeGasto();
    expect(linhas.find((l) => l.grupo === "TRIBUTOS")?.modo).toBe("PERCENTUAL");
    expect(new Set(linhas.map((l) => l.nome)).size).toBe(linhas.length);
  });
});
