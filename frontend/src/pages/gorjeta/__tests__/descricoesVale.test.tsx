import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipValeDescricao } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  criarTipValeDescricao: vi.fn(),
  ativarTipValeDescricao: vi.fn(),
}));

import { ativarTipValeDescricao, criarTipValeDescricao } from "../../../api/client";
import { DescricoesVale } from "../DescricoesVale";

const DESCRICOES: TipValeDescricao[] = [
  { id: "d1", texto: "Adiantamento para transporte", tipo: "ADIANTAMENTO", ativo: true },
  { id: "d2", texto: "Texto antigo", tipo: "ADIANTAMENTO", ativo: false },
  { id: "d3", texto: "Ajuste geral", tipo: null, ativo: true },
];

function montar() {
  const props = { descricoes: DESCRICOES, tipoAtual: "REFEICAO" as const, onMudou: vi.fn(), onFechar: vi.fn(), onErro: vi.fn() };
  render(<DescricoesVale {...props} />);
  return props;
}
const cadastrar = () => screen.getByRole("button", { name: /Cadastrar/ }) as HTMLButtonElement;
const digitar = (campo: HTMLElement, v: string) => fireEvent.change(campo, { target: { value: v } });

beforeEach(() => {
  vi.mocked(criarTipValeDescricao).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(ativarTipValeDescricao).mockReset().mockResolvedValue({ ok: true });
});

describe("Descrições prontas dos vales", () => {
  test("agrupa por tipo, deixa as de todos os tipos à parte e não mostra grupos vazios", () => {
    montar();
    expect(screen.getByText("Adiantamento", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Todos os tipos", { selector: "span" })).toBeTruthy();
    expect(screen.queryByText("Crédito (soma)", { selector: "span" })).toBeNull();
    expect(screen.getByText("Texto antigo").closest("li")!.className).toContain("inativa");
  });

  test("o tipo da nova descrição começa no tipo atual do formulário", () => {
    montar();
    expect((screen.getByLabelText("Tipo da descrição") as HTMLSelectElement).value).toBe("REFEICAO");
  });

  test("cadastrar fica desabilitado com menos de 3 letras", () => {
    montar();
    expect(cadastrar().disabled).toBe(true);
    digitar(screen.getByLabelText("Nova descrição"), "ab ");
    expect(cadastrar().disabled).toBe(true);
    digitar(screen.getByLabelText("Nova descrição"), "abc");
    expect(cadastrar().disabled).toBe(false);
  });

  test("cadastra com o texto sem espaços, o tipo escolhido, avisa e limpa o campo", async () => {
    const props = montar();
    digitar(screen.getByLabelText("Nova descrição"), "  Vale pizza  ");
    fireEvent.click(cadastrar());
    await waitFor(() => expect(props.onMudou).toHaveBeenCalledTimes(1));
    expect(criarTipValeDescricao).toHaveBeenCalledWith("Vale pizza", "REFEICAO");
    await waitFor(() => expect((screen.getByLabelText("Nova descrição") as HTMLInputElement).value).toBe(""));
  });

  test("Todos os tipos envia tipo nulo", async () => {
    montar();
    fireEvent.change(screen.getByLabelText("Tipo da descrição"), { target: { value: "" } });
    digitar(screen.getByLabelText("Nova descrição"), "Geral nova");
    fireEvent.click(cadastrar());
    await waitFor(() => expect(criarTipValeDescricao).toHaveBeenCalledWith("Geral nova", null));
  });

  test("erro da API vai para onErro e não avisa mudança", async () => {
    vi.mocked(criarTipValeDescricao).mockRejectedValue(new Error("Descrição repetida"));
    const props = montar();
    digitar(screen.getByLabelText("Nova descrição"), "Repetida");
    fireEvent.click(cadastrar());
    await waitFor(() => expect(props.onErro).toHaveBeenCalled());
    expect((props.onErro.mock.calls[0][0] as Error).message).toBe("Descrição repetida");
    expect(props.onMudou).not.toHaveBeenCalled();
  });

  test("desativar chama a API com ativo=false; reativar, com ativo=true", async () => {
    const props = montar();
    fireEvent.click(screen.getByRole("button", { name: "Desativar Adiantamento para transporte" }));
    await waitFor(() => expect(ativarTipValeDescricao).toHaveBeenCalledWith("d1", false));
    await waitFor(() => expect(props.onMudou).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Reativar Texto antigo" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Reativar Texto antigo" }));
    await waitFor(() => expect(ativarTipValeDescricao).toHaveBeenCalledWith("d2", true));
  });

  test("fechar chama onFechar", () => {
    const props = montar();
    fireEvent.click(within(screen.getByRole("region")).getByRole("button", { name: "Fechar descrições prontas" }));
    expect(props.onFechar).toHaveBeenCalled();
  });
});
