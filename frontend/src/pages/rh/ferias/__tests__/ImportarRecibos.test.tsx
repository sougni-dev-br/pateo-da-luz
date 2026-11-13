import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, type ReciboFeriasPrevia } from "../../../../api/client";

vi.mock("../../../../api/client", async (original) => ({ ...(await original<typeof import("../../../../api/client")>()), importarReciboFerias: vi.fn() }));
import { importarReciboFerias } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { ImportarRecibos } from "../ImportarRecibos";

const previa = (o: Partial<ReciboFeriasPrevia> = {}): ReciboFeriasPrevia => ({
  employeeId: "e1", nome: "Ana Paula Exemplo Souza", nomeNoRecibo: "ANA PAULA EXEMPLO SOUZA", arquivo: "recibo-ana.pdf", hash: "0".repeat(64),
  aquisitivoInicio: "2025-02-01", aquisitivoFim: "2026-01-31", gozoInicio: "2026-12-02", gozoFim: "2026-12-31", dias: 30,
  vencimento: "2026-11-30", proventos: 5333.68, descontos: 700, liquido: 4633.68, programacaoId: "fp1", avisos: [], ...o,
});
const SESSAO = { hideSensitiveValues: false, toggleSensitiveValues: () => undefined } as unknown as SessionContextValue;
const pdf = (nome: string) => new File(["%PDF-1.4"], nome, { type: "application/pdf" });
const enviar = (...arquivos: File[]) => fireEvent.change(screen.getByLabelText("PDFs dos recibos de férias"), { target: { files: arquivos } });
const abrir = () => {
  const onClose = vi.fn();
  const onLancou = vi.fn();
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider><ImportarRecibos onClose={onClose} onLancou={onLancou} /></HideValuesProvider>
    </SessionContext.Provider>,
  );
  return { onClose, onLancou };
};

beforeEach(() => { vi.mocked(importarReciboFerias).mockReset(); });

describe("ImportarRecibos", () => {
  test("lê o PDF, mostra a pessoa, as datas e o vencimento, e ainda não lança nada", async () => {
    vi.mocked(importarReciboFerias).mockResolvedValue({ previa: previa(), aplicado: false });
    abrir();
    enviar(pdf("recibo-ana.pdf"));
    expect(await screen.findByText("Ana Paula Exemplo Souza")).toBeInTheDocument();
    expect(screen.getByText(/02\/12\/2026 a 31\/12\/2026/)).toBeInTheDocument();
    expect(screen.getByText("30/11/2026")).toBeInTheDocument();
    expect(screen.getByText("Pronto para lançar")).toBeInTheDocument();
    expect(vi.mocked(importarReciboFerias)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(importarReciboFerias).mock.calls[0][2]).toBe(false);
  });

  test("lança os recibos marcados e avisa a tela ao fechar", async () => {
    vi.mocked(importarReciboFerias).mockResolvedValueOnce({ previa: previa(), aplicado: false }).mockResolvedValueOnce({ previa: previa(), aplicado: true, id: "pi1" });
    const { onClose, onLancou } = abrir();
    enviar(pdf("recibo-ana.pdf"));
    await screen.findByText("Pronto para lançar");
    fireEvent.click(screen.getByRole("button", { name: "Lançar 1 no Contas a Pagar" }));
    expect(await screen.findByText("Lançado no Contas a Pagar")).toBeInTheDocument();
    expect(vi.mocked(importarReciboFerias).mock.calls[1]).toEqual([expect.any(String), "recibo-ana.pdf", true, "e1"]);
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(onLancou).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("desmarcar um recibo o deixa de fora do lançamento", async () => {
    vi.mocked(importarReciboFerias).mockResolvedValue({ previa: previa(), aplicado: false });
    abrir();
    enviar(pdf("recibo-ana.pdf"));
    await screen.findByText("Pronto para lançar");
    fireEvent.click(screen.getByRole("checkbox", { name: "Lançar o recibo recibo-ana.pdf" }));
    expect(screen.getByRole("button", { name: "Lançar no Contas a Pagar" })).toHaveAttribute("aria-disabled", "true");
  });

  test("recibo recusado mostra o motivo e não entra no lançamento", async () => {
    vi.mocked(importarReciboFerias).mockRejectedValue(new ApiError("Este recibo já foi importado.", 409, { code: "JA_IMPORTADO" }));
    abrir();
    enviar(pdf("repetido.pdf"));
    expect(await screen.findByText("Este recibo já foi importado.")).toBeInTheDocument();
    expect(screen.getByText("Não dá para lançar")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Lançar o recibo repetido.pdf" })).toBeDisabled();
  });

  test("mais de uma pessoa com o nome: pede para escolher e relê com a escolhida", async () => {
    vi.mocked(importarReciboFerias)
      .mockRejectedValueOnce(new ApiError("Há mais de um funcionário com esse nome", 409, { code: "AMBIGUO", candidatos: [{ id: "e1", nome: "Ana Souza (Salão)" }, { id: "e9", nome: "Ana Souza (Cozinha)" }] }))
      .mockResolvedValueOnce({ previa: previa({ employeeId: "e9" }), aplicado: false });
    abrir();
    enviar(pdf("recibo-ana.pdf"));
    const escolha = await screen.findByLabelText("Quem é?");
    fireEvent.change(within(escolha.closest("td") as HTMLElement).getByRole("combobox"), { target: { value: "e9" } });
    await waitFor(() => expect(screen.getByText("Pronto para lançar")).toBeInTheDocument());
    expect(vi.mocked(importarReciboFerias).mock.calls[1][3]).toBe("e9");
  });

  test("os avisos do recibo aparecem na linha", async () => {
    vi.mocked(importarReciboFerias).mockResolvedValue({ previa: previa({ avisos: ["No ERP as férias têm 20 dias; o recibo traz 30."] }), aplicado: false });
    abrir();
    enviar(pdf("recibo-ana.pdf"));
    expect(await screen.findByText(/No ERP as férias têm 20 dias/)).toBeInTheDocument();
  });

  test("falha ao lançar deixa o recibo como recusado, com a mensagem", async () => {
    vi.mocked(importarReciboFerias).mockResolvedValueOnce({ previa: previa(), aplicado: false }).mockRejectedValueOnce(new Error("Dezembro/2026 está fechado."));
    abrir();
    enviar(pdf("recibo-ana.pdf"));
    await screen.findByText("Pronto para lançar");
    fireEvent.click(screen.getByRole("button", { name: "Lançar 1 no Contas a Pagar" }));
    expect(await screen.findByText("Dezembro/2026 está fechado.")).toBeInTheDocument();
  });
});
