import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";

vi.mock("../../../api/client", async (original) => ({
  ...(await original<typeof import("../../../api/client")>()),
  getConversoesAutomaticas: vi.fn(),
  aplicarConversoesAutomaticas: vi.fn()
}));
import { aplicarConversoesAutomaticas, getConversoesAutomaticas } from "../../../api/client";
import { ConversoesAutomaticas } from "../ConversoesAutomaticas";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

const produtos = [
  {
    productId: "saco", codigo: "1196", nome: "SACO AMOSTRA C800", unidadeDeContagem: "UN",
    propostas: [{ fromUnit: "CX", toUnit: "UN", factor: 800, confianca: "alta" as const, origem: "C800", motivo: "\"C800\" no nome: 1 CX = 800 UN. O preço das compras confirma.", precoConfirma: true, linhas: 3, valor: 339.48 }]
  },
  {
    productId: "guard", codigo: null, nome: "GUARDANAPO C/1000", unidadeDeContagem: "UN",
    propostas: [{ fromUnit: "PCT", toUnit: "UN", factor: 1000, confianca: "baixa" as const, origem: "C/1000", motivo: "O preço das compras não bate com esse fator: confira.", precoConfirma: false, linhas: 1, valor: 3 }]
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConversoesAutomaticas).mockResolvedValue({ produtos });
  vi.mocked(aplicarConversoesAutomaticas).mockResolvedValue({ conversoesCriadas: 1, comprasConvertidas: 3, comprasEmPeriodoFechado: 1, produtos: [] });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("ConversoesAutomaticas", () => {
  test("lista as propostas com a confianca de cada uma", async () => {
    render(<ConversoesAutomaticas onFechar={() => undefined} />);
    expect(await screen.findByText("1 CX = 800 UN")).toBeTruthy();
    expect(screen.getByText("1 PCT = 1.000 UN")).toBeTruthy();
    expect(screen.getByText("alta confiança")).toBeTruthy();
    expect(screen.getByText("conferir")).toBeTruthy();
  });

  test("aplicar as de alta confianca nao manda fator do cliente e avisa periodo fechado", async () => {
    const onAplicado = vi.fn();
    render(<ConversoesAutomaticas onFechar={() => undefined} onAplicado={onAplicado} />);
    fireEvent.click(await screen.findByRole("button", { name: /Aplicar as 1 de alta confiança/ }));
    await waitFor(() => expect(aplicarConversoesAutomaticas).toHaveBeenCalledWith({ todasDeAltaConfianca: true }));
    expect(await screen.findByText(/3 compra\(s\) convertida\(s\).*1 compra\(s\) em mês travado/)).toBeTruthy();
    expect(onAplicado).toHaveBeenCalled();
  });

  test("a de conferir so entra marcada", async () => {
    render(<ConversoesAutomaticas onFechar={() => undefined} />);
    const marcar = await screen.findByRole("checkbox", { name: /1 PCT = 1\.000 UN em GUARDANAPO/ });
    expect(screen.getByRole("button", { name: /Aplicar 0 marcada/ })).toHaveProperty("disabled", true);
    fireEvent.click(marcar);
    fireEvent.click(screen.getByRole("button", { name: /Aplicar 1 marcada/ }));
    await waitFor(() => expect(aplicarConversoesAutomaticas).toHaveBeenCalledWith({ escolhas: [{ productId: "guard", fromUnit: "PCT" }] }));
  });
});
