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
  test("mostra o que falta em botões pequenos, o informado recolhido num resumo e o que está em andamento", () => {
    render(<VariavelInformada {...props} podeEditar />);
    expect(screen.getByText("Sem apuração:")).toBeTruthy();
    expect(screen.getByText("Sem valor:")).toBeTruthy();
    expect(screen.getByLabelText("Informar valor de janeiro")).toBeTruthy();
    expect(screen.getByLabelText("Informar valor de maio")).toBeTruthy();
    expect(screen.getByText(/Em andamento: novembro/)).toBeTruthy();
    expect(screen.getByText(/1 mês informado à mão/)).toBeTruthy();
    expect(screen.getByLabelText("Remover agosto")).toBeTruthy();
  });

  test("vários meses informados viram um resumo só, com a soma", () => {
    const varias = { ...linha, informadas: [{ mes: 1, valor: 100, motivo: "por fora" }, { mes: 2, valor: 250.5, motivo: "por fora" }], mesesFaltando: [] } as unknown as Decimo13Linha;
    render(<VariavelInformada {...props} linha={varias} podeEditar />);
    expect(screen.getByText(/2 meses informados à mão/)).toBeTruthy();
    expect(screen.getByText(/350,50/)).toBeTruthy();
    expect(screen.queryByText("Sem apuração:")).toBeNull();
  });

  test("clicar no mês abre o formulário já nesse mês e só salva com valor e motivo", () => {
    render(<VariavelInformada {...props} podeEditar />);
    fireEvent.click(screen.getByLabelText("Informar valor de maio"));
    expect(screen.getByText("Variável de maio")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Valor da variável de maio"), { target: { value: "300,00" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "gorjeta por fora" } });
    expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("sem permissão de editar, só mostra os meses, sem botões", () => {
    render(<VariavelInformada {...props} podeEditar={false} />);
    expect(screen.queryByLabelText("Informar valor de janeiro")).toBeNull();
    expect(screen.queryByLabelText("Remover agosto")).toBeNull();
    expect(screen.getByText("jan")).toBeTruthy();
  });

  test("sem nada faltando nem informado, diz que está tudo na apuração", () => {
    const limpa = { ...linha, informadas: [], mesesFaltando: [] } as unknown as Decimo13Linha;
    render(<VariavelInformada {...props} linha={limpa} podeEditar />);
    expect(screen.getByText(/já estão na apuração/)).toBeTruthy();
  });
});
