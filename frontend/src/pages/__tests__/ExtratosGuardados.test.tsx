import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RhExtratoDetalhe, RhExtratoResumo } from "../../api/client";

vi.mock("../../api/client", () => ({
  listarRhExtratos: vi.fn(),
  getRhExtrato: vi.fn(),
  getRhExtratoPdf: vi.fn(),
}));

import { getRhExtrato, getRhExtratoPdf, listarRhExtratos } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { ExtratosGuardados, abrirPdf } from "../ExtratosGuardados";

const SESSAO = {
  user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined,
  canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

// Money lê o contexto de ocultar valores, que por sua vez lê a sessão.
const renderizar = (onErro = vi.fn()) => render(
  <SessionContext.Provider value={SESSAO}>
    <HideValuesProvider><ExtratosGuardados onErro={onErro} /></HideValuesProvider>
  </SessionContext.Provider>,
);

// Dados fictícios.
const RESUMO: RhExtratoResumo = {
  id: "x1", competenceYear: 2026, competenceMonth: 8, calculo: "MENSAL", empresa: "RESTAURANTE FICTICIO LTDA", cnpj: null,
  emissao: "2026-08-28", fileName: "Extrato.pdf", headcount: 2, totalLiquido: 3940, totalProventos: 11450.25, totalDescontos: 7510.25,
  pessoas: 2, naoConferidas: 1, detalhado: true, todasConferidas: false, temArquivo: true, importadoEm: "2026-08-29T10:00:00Z", atualizadoEm: null,
};
const DETALHE: RhExtratoDetalhe = {
  id: "x1", competenceYear: 2026, competenceMonth: 8, calculo: "MENSAL", empresa: "RESTAURANTE FICTICIO LTDA", cnpj: null,
  emissao: "2026-08-28", fileName: "Extrato.pdf", totalLiquido: 3940, totalProventos: null, totalDescontos: null,
  pessoas: [{
    id: "p1", employeeId: "e1", employeeName: "Cicrana da Silva", matricula: "48", nome: "CICRANA DA SILVA", situacao: "Trabalhando",
    vinculo: "Celetista", horasMes: 220, cargoCodigo: "7", cargo: "BARMAN", cbo: "513420", salarioBase: 2450, admissao: "2026-07-21",
    demissao: null, demissaoMotivo: null, proventos: 2450.25, descontos: 2070.25, liquido: 380, baseInss: 1470, baseFgts: 1470,
    baseIrrf: -117.2, valorFgts: 117.6, liquidoRescisao: null, conferido: false,
    rubricas: [{ codigo: "1", descricao: "HORAS NORMAIS", tipo: "P", referencia: 220, valor: 2450 }],
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listarRhExtratos).mockResolvedValue([RESUMO]);
  vi.mocked(getRhExtrato).mockResolvedValue(DETALHE);
});

describe("ExtratosGuardados", () => {
  test("lista o extrato e marca quantas pessoas faltam conferir", async () => {
    renderizar();
    expect(await screen.findByText("RESTAURANTE FICTICIO LTDA")).toBeInTheDocument();
    expect(screen.getByText(/1 de 2 a conferir/)).toBeInTheDocument();
  });

  test("abre as pessoas, marca quem não foi conferido e mostra as rubricas ao expandir", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: /Pessoas/ }));
    expect(await screen.findByText("CICRANA DA SILVA")).toBeInTheDocument();
    expect(screen.getByText("Não conferido")).toBeInTheDocument();
    fireEvent.click(screen.getByText("CICRANA DA SILVA"));
    expect(screen.getByText("HORAS NORMAIS")).toBeInTheDocument();
  });

  test("o holerite da pessoa abre por um botão de verdade (teclado), com aria-expanded no botão e não na linha", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: /Pessoas/ }));
    const botao = await screen.findByRole("button", { name: /CICRANA DA SILVA/ });
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(botao.closest("tr")!.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("HORAS NORMAIS")).toBeInTheDocument();
    fireEvent.click(botao);
    expect(screen.queryByText("HORAS NORMAIS")).toBeNull();
  });

  test("alternar rápido entre extratos: a resposta atrasada do primeiro não aparece no segundo", async () => {
    const OUTRO: RhExtratoResumo = { ...RESUMO, id: "x2", empresa: "OUTRA FICTICIA LTDA" };
    vi.mocked(listarRhExtratos).mockResolvedValue([RESUMO, OUTRO]);
    let soltarPrimeiro: (d: RhExtratoDetalhe) => void = () => undefined;
    vi.mocked(getRhExtrato)
      .mockImplementationOnce(() => new Promise((r) => { soltarPrimeiro = r; }))
      .mockResolvedValueOnce({ ...DETALHE, id: "x2", pessoas: [{ ...DETALHE.pessoas[0], id: "p2", nome: "BELTRANO SEGUNDO" }] });
    renderizar();
    await screen.findByText("OUTRA FICTICIA LTDA");
    const [b1, b2] = screen.getAllByRole("button", { name: /Pessoas/ });
    fireEvent.click(b1);
    fireEvent.click(b2);
    expect(await screen.findByText("BELTRANO SEGUNDO")).toBeInTheDocument();
    await act(async () => { soltarPrimeiro(DETALHE); });
    expect(screen.queryByText("CICRANA DA SILVA")).toBeNull();
    expect(screen.getByText("BELTRANO SEGUNDO")).toBeInTheDocument();
  });

  test("sem permissão explica em vez de mostrar erro", async () => {
    vi.mocked(listarRhExtratos).mockRejectedValue(new Error("Os extratos do RH têm salário e descontos de cada pessoa: só quem pode ver Funcionários tem acesso."));
    const onErro = vi.fn();
    renderizar(onErro);
    expect(await screen.findByText(/só quem pode ver Funcionários/)).toBeInTheDocument();
    expect(onErro).not.toHaveBeenCalled();
  });
});

describe("abrirPdf", () => {
  test("download falhou: fecha a aba em branco aberta antes e repassa o erro", async () => {
    const aba = { close: vi.fn(), location: { href: "" } };
    const open = vi.spyOn(window, "open").mockReturnValue(aba as unknown as Window);
    vi.mocked(getRhExtratoPdf).mockRejectedValue(new Error("PDF não encontrado"));
    await expect(abrirPdf("x1", "Extrato.pdf")).rejects.toThrow("PDF não encontrado");
    expect(aba.close).toHaveBeenCalled();
    open.mockRestore();
  });

  test("pop-up bloqueado (sem aba) e download falhou: só repassa o erro", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(getRhExtratoPdf).mockRejectedValue(new Error("falhou"));
    await expect(abrirPdf("x1", "Extrato.pdf")).rejects.toThrow("falhou");
    open.mockRestore();
  });
});

describe("ExtratosGuardados — lista recarregada (troca de ano ou nova importação)", () => {
  test("resposta atrasada da busca anterior não sobrescreve a lista mais nova", async () => {
    const ANTIGO: RhExtratoResumo = { ...RESUMO, id: "velho", empresa: "LISTA ATRASADA LTDA" };
    let soltarPrimeira: (l: RhExtratoResumo[]) => void = () => undefined;
    vi.mocked(listarRhExtratos)
      .mockImplementationOnce(() => new Promise((r) => { soltarPrimeira = r; }))
      .mockResolvedValue([RESUMO]);
    const { rerender } = renderizar();
    // Recarregar (nova importação) dispara a segunda busca enquanto a primeira não voltou.
    rerender(
      <SessionContext.Provider value={SESSAO}>
        <HideValuesProvider><ExtratosGuardados onErro={vi.fn()} recarregar={1} /></HideValuesProvider>
      </SessionContext.Provider>,
    );
    expect(await screen.findByText("RESTAURANTE FICTICIO LTDA")).toBeInTheDocument();
    await act(async () => { soltarPrimeira([ANTIGO]); });
    await waitFor(() => expect(screen.queryByText("LISTA ATRASADA LTDA")).toBeNull());
    expect(screen.getByText("RESTAURANTE FICTICIO LTDA")).toBeInTheDocument();
  });
});
