import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RhExtratoDetalhe, RhExtratoResumo } from "../../api/client";

vi.mock("../../api/client", () => ({
  listarRhExtratos: vi.fn(),
  getRhExtrato: vi.fn(),
  getRhExtratoPdf: vi.fn(),
}));

import { getRhExtrato, listarRhExtratos } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { ExtratosGuardados } from "../ExtratosGuardados";

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

  test("sem permissão explica em vez de mostrar erro", async () => {
    vi.mocked(listarRhExtratos).mockRejectedValue(new Error("Os extratos do RH têm salário e descontos de cada pessoa: só quem pode ver Funcionários tem acesso."));
    const onErro = vi.fn();
    renderizar(onErro);
    expect(await screen.findByText(/só quem pode ver Funcionários/)).toBeInTheDocument();
    expect(onErro).not.toHaveBeenCalled();
  });
});
