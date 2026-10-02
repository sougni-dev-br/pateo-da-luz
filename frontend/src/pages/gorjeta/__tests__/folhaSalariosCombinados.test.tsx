import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipFolhaLiquidos } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

// Botão da Folha de líquidos: leva o valor integral do salário combinado ao Contas a Pagar
// e mostra o que mudou.
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipFolhaLiquidos: vi.fn(),
  sincronizarSalariosCombinados: vi.fn(),
}));
import { getTipFolhaLiquidos, sincronizarSalariosCombinados } from "../../../api/client";
import { FolhaLiquidos } from "../FolhaLiquidos";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);
const etapa = { marcada: false, em: null, por: null, obs: null };
const folha: TipFolhaLiquidos = {
  code: "GOR-2026-0009", label: "Gorjeta", total: 5954.74, extratos: ["PATEO"],
  etapas: { estado: { ENVIADO_CONTABILIDADE: etapa, OK_CONTABILIDADE: etapa, FOLHA_PAGA: etapa }, historico: [] } as never,
  linhas: [{ employeeId: "e1", nome: "Teodoro Fictício", grupo: "PATEO", origem: "SALARIO_COMBINADO", valor: 5954.74, composicao: "x", pix: null, aviso: null }],
  salariosCombinados: [{ employeeId: "e1", nome: "Teodoro Fictício", apelido: null, valor: 5200, motivo: "acordo" }],
};
const abrir = (canEdit = true) => render(
  <FolhaLiquidos year={2026} month={9} canEdit={canEdit} liberada={false} versao="v1" onNotice={vi.fn()} />,
);
const BOTAO = { name: "Atualizar salários combinados no Contas a Pagar" };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(getTipFolhaLiquidos).mockResolvedValue(folha);
  vi.mocked(sincronizarSalariosCombinados).mockResolvedValue({
    competencia: "09/2026", semMudanca: 0, pagosIgnorados: 1, avisos: ["Salário combinado de Fulano: gorjeta do mês ainda não apurada; mantido o líquido do extrato."],
    alterados: [{ payrollItemId: "p1", employeeId: "e1", nome: "Teodoro Fictício", antes: 3030, depois: 5954.74, pendenteGorjeta: false }],
  });
});

describe("Folha de líquidos — atualizar salários combinados", () => {
  test("clicar atualiza e mostra quem mudou, os pagos ignorados e os avisos", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", BOTAO));
    expect(sincronizarSalariosCombinados).toHaveBeenCalledWith(2026, 9);
    const texto = async () => (await screen.findByText(/1 salário atualizado/)).closest("div")!.textContent!.replace(/\s+/g, " ");
    await waitFor(async () => expect(await texto()).toMatch(/Teodoro Fictício: R\$ ?3\.030,00 → R\$ ?5\.954,74/));
    expect(await texto()).toContain("1 já pago, não alterado");
    expect(await texto()).toContain("gorjeta do mês ainda não apurada");
  });

  test("sem permissão de editar: sem botão", async () => {
    abrir(false);
    await screen.findByText(/Folha salarial líquidos/);
    expect(screen.queryByRole("button", BOTAO)).not.toBeInTheDocument();
  });
});
