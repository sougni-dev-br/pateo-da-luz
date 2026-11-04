import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  getPontoDias: vi.fn(),
  salvarPontoDia: vi.fn(async () => ({})),
}));

import { getPontoDias, salvarPontoDia } from "../../../../api/client";
import { DigitarPapel } from "../DigitarPapel";

const montar = () =>
  render(
    <MemoryRouter>
      <DigitarPapel year={2026} month={10} pessoas={[{ employeeId: "e1", nome: "Gabi" }]} employeeId="e1" onEscolher={vi.fn()} fechado={false} resumo={null} onSalvou={vi.fn()} onIrParaFechamento={vi.fn()} />
    </MemoryRouter>,
  );

const campo = (nome: string, dia: string) => screen.findByLabelText(new RegExp(`^${nome}, .*${dia}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPontoDias).mockResolvedValue({ dias: [], escala: [], turno: "14:00–22:20", jornadaMin: 440, mesMontado: true });
});

describe("DigitarPapel — dia sem intervalo", () => {
  test("entrada e saída, com Intervalo e Volta vazios, salvam as duas batidas", async () => {
    montar();
    const entrada = await campo("Entrada", "11/10");
    const saida = await campo("Saída", "11/10");
    fireEvent.change(entrada, { target: { value: "1400" } });
    fireEvent.change(saida, { target: { value: "2200" } });
    fireEvent.blur(saida);
    await waitFor(() => expect(salvarPontoDia).toHaveBeenCalledWith("e1", "2026-10-11", ["14:00", "22:00"]));
  });

  test("buraco no meio continua recusado (entrada, volta e saída sem o intervalo)", async () => {
    montar();
    const entrada = await campo("Entrada", "12/10");
    fireEvent.change(entrada, { target: { value: "1400" } });
    fireEvent.change(await campo("Volta", "12/10"), { target: { value: "1800" } });
    const saida = await campo("Saída", "12/10");
    fireEvent.change(saida, { target: { value: "2200" } });
    fireEvent.blur(saida);
    expect(await screen.findByText(/sem deixar campo vazio no meio/i)).toBeInTheDocument();
    expect(salvarPontoDia).not.toHaveBeenCalled();
  });

  test("dia salvo com duas batidas volta com a saída no campo Saída", async () => {
    vi.mocked(getPontoDias).mockResolvedValue({
      dias: [{ date: "2026-10-11", origem: "PAPEL", marcacoes: ["14:00", "22:00"], editadoManual: true }],
      escala: [], turno: "14:00–22:20", jornadaMin: 440, mesMontado: true,
    });
    montar();
    expect(await campo("Entrada", "11/10")).toHaveValue("14:00");
    expect(await campo("Saída", "11/10")).toHaveValue("22:00");
    expect(await campo("Intervalo", "11/10")).toHaveValue("");
  });
});
