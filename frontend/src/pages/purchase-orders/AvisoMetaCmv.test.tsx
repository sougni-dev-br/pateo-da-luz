import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ImpactoPedidoMetaCmv, ProjecaoMetaCmv } from "../../api/client";

const getImpacto = vi.fn();
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getImpactoPedidoMetaCmv: (...a: unknown[]) => getImpacto(...a),
}));

import { HideValuesProvider } from "../../design-system";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { AvisoMetaCmv } from "./AvisoMetaCmv";

// Money lê o contexto de ocultar valores, que por sua vez lê a sessão.
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const montar = (versao = "v1") => render(<SessionContext.Provider value={SESSAO}><HideValuesProvider><AvisoMetaCmv orderId="p1" versao={versao} /></HideValuesProvider></SessionContext.Provider>);

const proj = (o: Partial<ProjecaoMetaCmv> = {}): ProjecaoMetaCmv => ({
  faturamentoProjetado: 300000, comprasComprometidas: 35000, percentualProjetado: 11.67, tetoDeCompras: 90000, margemParaComprar: 55000, ...o,
});
const avaliado = (o: Partial<Extract<ImpactoPedidoMetaCmv, { situacao: "AVALIADO" }>> = {}): ImpactoPedidoMetaCmv => ({
  situacao: "AVALIADO", mes: "2026-11", ateODia: "2026-11-10",
  meta: { alvoPercentual: 30, alertaPercentual: 27 },
  pedido: { total: 10000, totalCmv: 10000, itensSemPreco: 0 },
  antes: proj({ comprasComprometidas: 25000 }), depois: proj(),
  statusAntes: "VERDE", statusDepois: "VERDE", ...o,
});

beforeEach(() => vi.clearAllMocks());

describe("AvisoMetaCmv", () => {
  test("pedido já enviado não mostra nada", async () => {
    getImpacto.mockResolvedValue({ situacao: "SEM_DECISAO", status: "ENVIADO" });
    const { container } = montar();
    await waitFor(() => expect(getImpacto).toHaveBeenCalledWith("p1"));
    expect(container).toBeEmptyDOMElement();
  });

  test("sem meta cadastrada, orienta onde cadastrar", async () => {
    getImpacto.mockResolvedValue({ situacao: "SEM_META", pedido: { total: 1, totalCmv: 1, itensSemPreco: 0 } });
    montar();
    expect(await screen.findByText(/Sem meta de CMV cadastrada para este mês/)).toBeInTheDocument();
  });

  test("pedido que cabe mostra a projeção e quanto ainda dá para comprar", async () => {
    getImpacto.mockResolvedValue(avaliado());
    montar();
    expect(await screen.findByText("Cabe na meta de CMV do mês")).toBeInTheDocument();
    expect(screen.getByTestId("aviso-meta-cmv")).toHaveTextContent(/11,7% do\s+faturamento projetado/);
    expect(screen.getByTestId("aviso-meta-cmv")).toHaveTextContent(/ainda dá para comprar/);
  });

  test("pedido que estoura diz em quanto passa do teto", async () => {
    getImpacto.mockResolvedValue(avaliado({ statusDepois: "VERMELHO", depois: proj({ margemParaComprar: -5000, percentualProjetado: 31.67 }) }));
    montar();
    expect(await screen.findByText("Passa do teto da meta de CMV")).toBeInTheDocument();
    expect(screen.getByTestId("aviso-meta-cmv")).toHaveTextContent(/Passa do teto em/);
  });

  test("mês que já estava estourado é dito, para não culpar só este pedido", async () => {
    getImpacto.mockResolvedValue(avaliado({ statusAntes: "VERMELHO", statusDepois: "VERMELHO", depois: proj({ margemParaComprar: -9000 }) }));
    montar();
    expect(await screen.findByText(/já estava acima do teto antes deste pedido/)).toBeInTheDocument();
  });

  test("itens fora do CMV e sem preço aparecem como observação", async () => {
    getImpacto.mockResolvedValue(avaliado({ pedido: { total: 12000, totalCmv: 10000, itensSemPreco: 2 } }));
    montar();
    expect(await screen.findByText(/deste pedido não entram no CMV/)).toBeInTheDocument();
    expect(screen.getByText(/2 itens sem preço estimado ficaram fora da conta/)).toBeInTheDocument();
  });

  test("falha ao calcular aparece em texto, sem esconder o problema", async () => {
    getImpacto.mockRejectedValue(new Error("rede"));
    montar();
    expect(await screen.findByText(/Não foi possível calcular o efeito deste pedido/)).toBeInTheDocument();
  });

  test("salvar o pedido (nova versão) recalcula o aviso", async () => {
    getImpacto.mockResolvedValue(avaliado());
    const { rerender } = montar("v1");
    await waitFor(() => expect(getImpacto).toHaveBeenCalledTimes(1));
    rerender(<SessionContext.Provider value={SESSAO}><HideValuesProvider><AvisoMetaCmv orderId="p1" versao="v2" /></HideValuesProvider></SessionContext.Provider>);
    await waitFor(() => expect(getImpacto).toHaveBeenCalledTimes(2));
  });

  test("trocar de pedido zera o aviso enquanto o novo calcula", async () => {
    getImpacto.mockResolvedValueOnce(avaliado());
    const { rerender } = montar("v1");
    expect(await screen.findByText("Cabe na meta de CMV do mês")).toBeInTheDocument();
    getImpacto.mockReturnValueOnce(new Promise(() => undefined));
    rerender(<SessionContext.Provider value={SESSAO}><HideValuesProvider><AvisoMetaCmv orderId="p2" versao="v1" /></HideValuesProvider></SessionContext.Provider>);
    await waitFor(() => expect(screen.queryByText("Cabe na meta de CMV do mês")).not.toBeInTheDocument());
  });
});
