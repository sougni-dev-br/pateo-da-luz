import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Decimo13Linha } from "../../../api/client";
import { VariavelInformada } from "../VariavelInformada";

vi.mock("../../../api/client", async (orig) => ({
  ...(await orig<typeof import("../../../api/client")>()),
  informarVariavelDecimo13: vi.fn(async () => ({ ok: true })),
  removerVariavelDecimo13: vi.fn(async () => ({ ok: true })),
}));

const linha = {
  employeeId: "e1", nome: "Pessoa Teste", setor: "Cozinha", calculo: null, motivoSemCalculo: null,
  mesesFaltando: [{ mes: 1, motivo: "SEM_APURACAO" }, { mes: 5, motivo: "SEM_LANCAMENTO" }, { mes: 11, motivo: "EM_ANDAMENTO" }],
  informadas: [{ mes: 8, valor: 638.16, motivo: "gorjeta por fora" }],
} as unknown as Decimo13Linha;

const props = { linha, ano: 2026, aoMudar: async () => undefined, aoErro: () => undefined };

describe("VariavelInformada", () => {
  test("lista os meses que faltam, por motivo, e o informado à mão", () => {
    render(<VariavelInformada {...props} podeEditar />);
    expect(screen.getByText(/Sem apuração de gorjeta no sistema/)).toBeTruthy();
    expect(screen.getByText(/contam como R\$ 0,00/)).toBeTruthy();
    expect(screen.getByLabelText("Informar valor de janeiro")).toBeTruthy();
    expect(screen.getByLabelText("Informar valor de maio")).toBeTruthy();
    expect(screen.getByText(/novembro\): entra na média/)).toBeTruthy();
    expect(screen.getByText(/agosto: .*informado à mão/)).toBeTruthy();
  });

  test("clicar no mês abre o formulário já nesse mês e só salva com valor e motivo", () => {
    render(<VariavelInformada {...props} podeEditar />);
    fireEvent.click(screen.getByLabelText("Informar valor de maio"));
    expect(screen.getByText("Variável de maio")).toBeTruthy();
    const salvar = screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Valor da variável de maio"), { target: { value: "300,00" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "gorjeta por fora" } });
    expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("sem permissão de editar, só mostra os meses, sem botões", () => {
    render(<VariavelInformada {...props} podeEditar={false} />);
    expect(screen.queryByLabelText("Informar valor de janeiro")).toBeNull();
    expect(screen.getByText(/janeiro/)).toBeTruthy();
  });
});
