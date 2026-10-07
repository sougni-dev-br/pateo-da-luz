import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// A tela de inventario dizia "238 divergentes" e nao mostrava quais nem por que.
// O painel de conferencia mostra cada item contra a contagem anterior + compras.
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getConferenciaDoInventario: vi.fn()
}));

import { type ConferenciaDoInventario, type ItemDaConferencia, getConferenciaDoInventario } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { ConferenciaInventario } from "../ConferenciaInventario";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

function item(parcial: Partial<ItemDaConferencia>): ItemDaConferencia {
  return {
    itemId: "i", productId: "p", productCode: "100", productName: "PRODUTO", sectorName: "ESTOQUE", unit: "UN",
    contado: 1, anterior: 1, anteriorData: "2026-06-29T00:00:00.000Z", anteriorCodigo: "INV-2026-0020",
    compras: 0, disponivel: 1, consumo: 0, custoUnitario: 1, impacto: 0, classe: "COERENTE", motivo: "Consumo de 0 UN no período.",
    ...parcial
  };
}

const vazio = { itens: 0, impacto: 0 };

function conferencia(itens: ItemDaConferencia[]): ConferenciaDoInventario {
  const resumo = {
    IMPOSSIVEL: { ...vazio }, ZERADO_SUSPEITO: { ...vazio }, FORA_DO_HISTORICO: { ...vazio },
    SEM_REFERENCIA: { ...vazio }, PENDENTE: { ...vazio }, COERENTE: { ...vazio }
  };
  for (const i of itens) {
    resumo[i.classe] = { itens: resumo[i.classe].itens + 1, impacto: resumo[i.classe].impacto + (i.impacto ?? 0) };
  }
  return { inventoryId: "inv", code: "INV-2026-0021", resumo, itens };
}

const mexedor = item({
  itemId: "mexedor", productName: "MEXEDOR CAFÉ GOLDEN C/ 500", unit: "PCTE", anterior: 2, compras: 0, disponivel: 2, contado: 420,
  consumo: -418, impacto: 5162.3, classe: "IMPOSSIVEL",
  motivo: "Contou 420 PCTE, mas havia 2 PCTE e entraram 0 PCTE no período: 418 PCTE sem origem."
});
const salmao = item({
  itemId: "salmao", productName: "SALMAO", unit: "KG", anterior: 49.06, compras: 1879.22, disponivel: 1928.28, contado: 0,
  consumo: 1928.28, impacto: 77830.52, classe: "ZERADO_SUSPEITO",
  motivo: "Zerado, mas havia 49,06 KG e entraram 1.879,22 KG no período."
});
const mignon = item({ itemId: "mignon", productName: "FILE MIGNON", classe: "COERENTE", impacto: 7873.84 });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConferenciaInventario", () => {
  test("abre nos impossiveis, com o motivo de cada item", async () => {
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor, salmao, mignon]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} />);

    const veredito = await screen.findByText((_, el) => el?.classList.contains("conf-veredito") ?? false);
    expect(veredito).toHaveTextContent(/1 impossível \(R\$\s?5\.162 sem origem\) e 1 zerado suspeito \(R\$\s?77\.831 havia\)/);
    expect(screen.getByRole("button", { name: /impossíveis/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("MEXEDOR CAFÉ GOLDEN C/ 500")).toBeInTheDocument();
    expect(screen.getByText(/418 PCTE sem origem/)).toBeInTheDocument();
    expect(screen.queryByText("SALMAO")).not.toBeInTheDocument();
  });

  test("trocar de classe mostra os itens dela", async () => {
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor, salmao, mignon]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /zerados suspeitos/i }));
    expect(screen.getByText("SALMAO")).toBeInTheDocument();
    expect(screen.getByText(/Zerado, mas havia 49,06 KG e entraram 1\.879,22 KG/)).toBeInTheDocument();
    expect(screen.queryByText("MEXEDOR CAFÉ GOLDEN C/ 500")).not.toBeInTheDocument();
  });

  test("mostra de onde veio o numero: anterior, compras, disponivel e contado", async () => {
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} />);

    const linha = (await screen.findByText("MEXEDOR CAFÉ GOLDEN C/ 500")).closest("li")!;
    expect(within(linha).getByText(/29\/06\/2026/)).toBeInTheDocument();
    expect(within(linha).getByText("Contado").nextElementSibling).toHaveTextContent("420 PCTE");
    expect(within(linha).getByText("Disponível").nextElementSibling).toHaveTextContent("2 PCTE");
  });

  test("localizar leva o item para a lista de edicao", async () => {
    const onLocalizar = vi.fn();
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={onLocalizar} />);

    fireEvent.click(await screen.findByRole("button", { name: /localizar mexedor/i }));
    expect(onLocalizar).toHaveBeenCalledWith(expect.objectContaining({ itemId: "mexedor" }));
  });

  test("sem alerta diz isso e abre nos coerentes", async () => {
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mignon]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} />);

    expect(await screen.findByText(/nenhum item impossível ou zerado suspeito/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /coerentes/i })).toHaveAttribute("aria-pressed", "true");
  });

  test("entrega o resultado para a tabela e para quem aprova", async () => {
    const onCarregar = vi.fn();
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor, salmao]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} onCarregar={onCarregar} />);

    await waitFor(() => expect(onCarregar).toHaveBeenCalledWith(expect.objectContaining({
      resumo: expect.objectContaining({ IMPOSSIVEL: expect.objectContaining({ itens: 1 }) })
    })));
  });

  test("trocar de inventario no meio da carga nao mostra o resultado do anterior", async () => {
    let soltarA: (c: ConferenciaDoInventario) => void = () => undefined;
    vi.mocked(getConferenciaDoInventario)
      .mockImplementationOnce(() => new Promise((resolve) => { soltarA = resolve; }))
      .mockResolvedValueOnce(conferencia([salmao]));
    const { rerender } = render(<ConferenciaInventario inventoryId="a" onLocalizar={vi.fn()} />);
    rerender(<SessionContext.Provider value={SESSAO}><HideValuesProvider><ConferenciaInventario inventoryId="b" onLocalizar={vi.fn()} /></HideValuesProvider></SessionContext.Provider>);

    expect(await screen.findByText("SALMAO")).toBeInTheDocument();
    soltarA(conferencia([mexedor]));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("MEXEDOR CAFÉ GOLDEN C/ 500")).not.toBeInTheDocument();
  });

  test("falha na consulta mostra o erro e deixa tentar de novo", async () => {
    vi.mocked(getConferenciaDoInventario)
      .mockRejectedValueOnce(new Error("Falhou"))
      .mockResolvedValueOnce(conferencia([mexedor]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /tentar de novo/i }));
    expect(await screen.findByText("MEXEDOR CAFÉ GOLDEN C/ 500")).toBeInTheDocument();
  });
});
