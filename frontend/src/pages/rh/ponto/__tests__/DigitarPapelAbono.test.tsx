import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  getPontoDias: vi.fn(),
  salvarPontoDia: vi.fn(async () => ({})),
  folgaBancoPonto: vi.fn(async () => ({})),
  abonarPontoDia: vi.fn(async () => ({})),
}));

import { abonarPontoDia, getPontoDias } from "../../../../api/client";
import { DigitarPapel } from "../DigitarPapel";

const pessoas = [{ employeeId: "e1", nome: "Cida" }];
const montar = (fechado = false, onSalvou = vi.fn()) =>
  render(
    <MemoryRouter>
      <DigitarPapel year={2026} month={10} pessoas={pessoas} employeeId="e1" onEscolher={vi.fn()} fechado={fechado} resumo={null} onSalvou={onSalvou} onIrParaFechamento={vi.fn()} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPontoDias).mockResolvedValue({
    // 13/10: entrada 08:00, intervalo 12:19 (só duas batidas: foi ao médico do trabalho). Jornada de 7:20.
    dias: [{ date: "2026-10-13", origem: "PAPEL", marcacoes: ["08:00", "12:19"], editadoManual: true, abonoMin: 0, abonoMotivo: null }],
    escala: [],
    turno: "08:00–16:20",
    jornadaMin: 440,
    mesMontado: true,
  });
});

describe("DigitarPapel — abono de horas", () => {
  test("oferece 'Abonar horas' no dia com batidas e já sugere o que faltou para a jornada", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Abonar horas em .*13/i }));
    const form = await screen.findByRole("form", { name: /Abonar horas de/i });
    expect(within(form).getByLabelText(/Horas abonadas/i)).toHaveValue("3:01");
  });

  test("salva o abono com o motivo escolhido e avisa a tela", async () => {
    const onSalvou = vi.fn();
    montar(false, onSalvou);
    fireEvent.click(await screen.findByRole("button", { name: /Abonar horas em .*13/i }));
    const form = await screen.findByRole("form", { name: /Abonar horas de/i });
    fireEvent.change(within(form).getByLabelText(/Motivo/i), { target: { value: "MEDICO_TRABALHO" } });
    fireEvent.click(within(form).getByRole("button", { name: /Salvar abono/i }));
    await waitFor(() => expect(abonarPontoDia).toHaveBeenCalledWith("e1", "2026-10-13", 181, "MEDICO_TRABALHO", undefined));
    await waitFor(() => expect(onSalvou).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /Abono de 3:01/i })).toBeInTheDocument();
  });

  test("não salva sem escolher o motivo", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Abonar horas em .*13/i }));
    const form = await screen.findByRole("form", { name: /Abonar horas de/i });
    fireEvent.click(within(form).getByRole("button", { name: /Salvar abono/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/motivo/i);
    expect(abonarPontoDia).not.toHaveBeenCalled();
  });

  test("mês fechado não oferece abonar", async () => {
    montar(true);
    await screen.findByText("13/10", { exact: false }).catch(() => null);
    await waitFor(() => expect(getPontoDias).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Abonar horas/i })).not.toBeInTheDocument();
  });
});
