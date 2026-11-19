import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { TipComputation } from "../../../api/client";
import { AjusteServico } from "../AjusteServico";

beforeAll(() => {
  // jsdom não implementa scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

const limpo = (t: string | null) => (t ?? "").replace(/\s/g, "");
const comp = (over: Partial<TipComputation> = {}) =>
  ({ servicoFaturamento: 1000, ajusteServico: 0, ajusteServicoMotivo: null, ...over }) as TipComputation;

function abrir(c = comp(), over: Partial<Parameters<typeof AjusteServico>[0]> = {}) {
  const props = {
    comp: c,
    onSalvar: vi.fn().mockResolvedValue(undefined),
    onAtualizarFaturamento: vi.fn().mockResolvedValue(undefined),
    onFechar: vi.fn(),
    onErro: vi.fn(),
    ...over,
  };
  render(<AjusteServico {...props} />);
  return {
    props,
    ajuste: screen.getByLabelText("Valor do ajuste (negativo para tirar)") as HTMLInputElement,
    motivo: screen.getByLabelText("Motivo do ajuste") as HTMLInputElement,
    salvar: () => screen.getByText("Salvar ajuste").closest("button") as HTMLButtonElement,
  };
}

describe("Ajuste do serviço arrecadado", () => {
  test("mostra o valor do faturamento e o total igual a ele quando não há ajuste", () => {
    const { salvar } = abrir();
    const txt = limpo(document.body.textContent);
    expect(txt).toContain("Dofaturamento:R$1.000,00");
    expect(txt).toContain("Serviçoarrecadado:R$1.000,00");
    expect(salvar().disabled).toBe(false);
  });

  test("abre preenchido com o ajuste e o motivo já gravados", () => {
    const { ajuste, motivo } = abrir(comp({ ajusteServico: 150.5, ajusteServicoMotivo: "evento fora do PDV" }));
    expect(ajuste.value).toBe("150.5");
    expect(motivo.value).toBe("evento fora do PDV");
    expect(limpo(document.body.textContent)).toContain("Serviçoarrecadado:R$1.150,50");
  });

  test("o total acompanha o ajuste digitado (aceita valor negativo)", () => {
    const { ajuste } = abrir();
    fireEvent.change(ajuste, { target: { value: "200" } });
    expect(limpo(document.body.textContent)).toContain("Serviçoarrecadado:R$1.200,00");
    fireEvent.change(ajuste, { target: { value: "-250" } });
    expect(limpo(document.body.textContent)).toContain("Serviçoarrecadado:R$750,00");
  });

  test("ajuste sem motivo: avisa e bloqueia o salvar", () => {
    const { ajuste, salvar, props } = abrir();
    fireEvent.change(ajuste, { target: { value: "50" } });
    expect(screen.getByText("Informe o motivo do ajuste.")).toBeTruthy();
    expect(salvar().disabled).toBe(true);
    fireEvent.click(salvar());
    expect(props.onSalvar).not.toHaveBeenCalled();
  });

  test("motivo só com espaços continua sem valer", () => {
    const { ajuste, motivo, salvar } = abrir();
    fireEvent.change(ajuste, { target: { value: "50" } });
    fireEvent.change(motivo, { target: { value: "   " } });
    expect(salvar().disabled).toBe(true);
  });

  test("ajuste que deixaria o serviço negativo bloqueia o salvar", () => {
    const { ajuste, motivo, salvar } = abrir();
    fireEvent.change(ajuste, { target: { value: "-1500" } });
    fireEvent.change(motivo, { target: { value: "erro de lançamento" } });
    expect(salvar().disabled).toBe(true);
  });

  test("salvar envia o ajuste numérico e o motivo sem espaços nas pontas", async () => {
    const { ajuste, motivo, salvar, props } = abrir();
    fireEvent.change(ajuste, { target: { value: "12.5" } });
    fireEvent.change(motivo, { target: { value: "  evento recebido fora do PDV  " } });
    fireEvent.click(salvar());
    await waitFor(() => expect(props.onSalvar).toHaveBeenCalledWith(12.5, "evento recebido fora do PDV"));
  });

  test("ajuste zero sem motivo salva com motivo null (limpar o ajuste)", async () => {
    const { salvar, props } = abrir(comp({ ajusteServico: 0 }));
    fireEvent.click(salvar());
    await waitFor(() => expect(props.onSalvar).toHaveBeenCalledWith(0, null));
  });

  test("erro ao salvar vai para onErro e o botão volta a habilitar", async () => {
    const erro = new Error("Período fechado");
    const { salvar, props } = abrir(comp(), { onSalvar: vi.fn().mockRejectedValue(erro) });
    fireEvent.click(salvar());
    await waitFor(() => expect(props.onErro).toHaveBeenCalledWith(erro));
    await waitFor(() => expect(salvar().disabled).toBe(false));
  });

  test("atualizar do faturamento chama a função própria e não salva", async () => {
    const { props } = abrir();
    fireEvent.click(screen.getByText("Atualizar do faturamento"));
    await waitFor(() => expect(props.onAtualizarFaturamento).toHaveBeenCalledTimes(1));
    expect(props.onSalvar).not.toHaveBeenCalled();
  });

  test("enquanto executa, os dois botões ficam desabilitados", async () => {
    let liberar: () => void = () => undefined;
    const onSalvar = vi.fn(() => new Promise<void>((ok) => { liberar = ok; }));
    const { salvar } = abrir(comp(), { onSalvar });
    fireEvent.click(salvar());
    await waitFor(() => expect(salvar().disabled).toBe(true));
    expect((screen.getByText("Atualizar do faturamento").closest("button") as HTMLButtonElement).disabled).toBe(true);
    liberar();
    await waitFor(() => expect(salvar().disabled).toBe(false));
  });

  test("fechar chama onFechar sem salvar", () => {
    const { props } = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(props.onFechar).toHaveBeenCalledTimes(1);
    expect(props.onSalvar).not.toHaveBeenCalled();
  });
});
