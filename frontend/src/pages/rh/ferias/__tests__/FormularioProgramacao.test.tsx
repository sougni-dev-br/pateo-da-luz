import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { PeriodoFerias } from "../../../../api/client";
import { FormularioProgramacao } from "../FormularioProgramacao";

const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 107, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], ...o,
});
const regras = { hoje: "2026-10-15", feriados: {}, repousos: [0], repousoPelaEscala: false };

const abrir = (p: PeriodoFerias, extra: Record<string, unknown> = {}) => {
  const onSalvar = vi.fn();
  const onSalvarParcelado = vi.fn();
  render(<FormularioProgramacao nome="Ana Exemplo" periodo={p} regras={regras} salvando={false} erro={null}
    onSalvar={onSalvar} onSalvarParcelado={onSalvarParcelado} onCancelar={() => undefined} {...extra} />);
  return { onSalvar, onSalvarParcelado };
};

describe("FormularioProgramacao", () => {
  test("pergunta integral ou parcelada quando o período está inteiro", () => {
    abrir(periodo());
    expect(screen.getByRole("radio", { name: /Integrais/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Parceladas/ })).not.toBeChecked();
  });

  test("não pergunta quando já há parte programada, nem quando o saldo é pequeno", () => {
    const programada = { id: "g", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", gozoFim: "2026-12-14", dias: 14, diasAbono: 0, status: "PROGRAMADA" as const, observacao: null, passouDaData: false };
    const { unmount } = render(<FormularioProgramacao nome="Ana" periodo={periodo({ diasPendentes: 16, programacoes: [programada] })} regras={regras} salvando={false} erro={null}
      onSalvar={() => undefined} onSalvarParcelado={() => undefined} onCancelar={() => undefined} />);
    expect(screen.queryByRole("radio")).toBeNull();
    unmount();
    abrir(periodo({ diasPendentes: 12 }));
    expect(screen.queryByRole("radio")).toBeNull();
  });

  test("alternar o modo não apaga o que foi digitado em nenhum dos dois", () => {
    abrir(periodo());
    fireEvent.change(screen.getAllByLabelText(/Observação/, { selector: "input" })[0], { target: { value: "combinado" } });
    fireEvent.click(screen.getByRole("radio", { name: /Parceladas/ }));
    fireEvent.change(screen.getByLabelText("Início da 1ª parte"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("radio", { name: /Integrais/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Parceladas/ }));
    expect(screen.getByLabelText("Início da 1ª parte")).toHaveValue("2026-12-01");
    fireEvent.click(screen.getByRole("radio", { name: /Integrais/ }));
    expect(screen.getAllByLabelText(/Observação/, { selector: "input" })[0]).toHaveValue("combinado");
  });

  test("salva as partes digitadas pelo formulário parcelado", () => {
    const { onSalvarParcelado, onSalvar } = abrir(periodo());
    fireEvent.click(screen.getByRole("radio", { name: /Parceladas/ }));
    fireEvent.change(screen.getByLabelText("Início da 1ª parte"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Início da 2ª parte"), { target: { value: "2027-01-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Programar em 2 partes" }));
    expect(onSalvar).not.toHaveBeenCalled();
    expect(onSalvarParcelado).toHaveBeenCalledWith({
      partes: [{ gozoInicio: "2026-12-01", dias: 14 }, { gozoInicio: "2027-01-12", dias: 16 }], diasAbono: 0, observacao: undefined,
    });
  });

  test("erro geral (sobreposição) não salva e é anunciado como alerta", () => {
    const { onSalvarParcelado } = abrir(periodo());
    fireEvent.click(screen.getByRole("radio", { name: /Parceladas/ }));
    fireEvent.change(screen.getByLabelText("Início da 1ª parte"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Início da 2ª parte"), { target: { value: "2026-12-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Programar em 2 partes" }));
    expect(onSalvarParcelado).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("As partes 1 e 2 se sobrepõem.");
  });

  test("marcar o abono mantém as datas e passa a somar 20 dias", () => {
    abrir(periodo());
    fireEvent.click(screen.getByRole("radio", { name: /Parceladas/ }));
    fireEvent.change(screen.getByLabelText("Início da 1ª parte"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Vender 10 dias/ }));
    expect(screen.getByLabelText("Início da 1ª parte")).toHaveValue("2026-12-01");
    expect(screen.getByLabelText("Dias da 2ª parte")).toHaveValue(6);
  });

  test("parcelado avisa quem já estará fora em cada parte (colegas do mesmo setor e de outros)", () => {
    const conflitos = vi.fn(() => ({ mesmoSetor: ["Bia"], outros: ["Caio"], setor: "Cozinha" }));
    abrir(periodo(), { conflitos });
    fireEvent.click(screen.getByRole("radio", { name: /Parceladas/ }));
    fireEvent.change(screen.getByLabelText("Início da 1ª parte"), { target: { value: "2026-12-01" } });
    expect(conflitos).toHaveBeenCalledWith("2026-12-01", 14);
    expect(screen.getByText(/Do mesmo setor \(Cozinha\)/)).toHaveTextContent("Bia");
    expect(screen.getByText(/\(outros setores\)/)).toHaveTextContent("Caio");
  });
});
