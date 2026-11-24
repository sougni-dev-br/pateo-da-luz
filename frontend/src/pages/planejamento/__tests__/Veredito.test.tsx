import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanejamentoCaixa, PlanejamentoProjecao, PlanejamentoResultado } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { Veredito } from "../Veredito";

// Números fictícios, só para exercitar a regra do veredito.
const turnos = (v: number) => ({ almoco: v / 2, jantar: v / 2, total: v });
const grandezas = (v: number) => ({ clientes: turnos(100), ticket: turnos(50), vendas: turnos(v) });
const projecao: PlanejamentoProjecao = {
  anoBase: 2030,
  meses: [],
  total: { meses: [1, 2], base: grandezas(1000), projetado: grandezas(1100), variacaoVendas: 0.1, variacaoClientes: 0, variacaoTicket: 0.1, cmvValor: 300, cmvPercentual: 0.3, margemBruta: 800 }
};
const resultado = (lucro: number | null): PlanejamentoResultado => ({ meses: [], total: { gastosPorGrupo: {}, abatimentoDoServico: 0, gastosTotal: 500, lucro } });
const mesDeCaixa = (mes: number, saldo: number) => ({ mes, entradas: 0, saidasCompras: 0, saidasGastos: 0, saidas: 0, resultado: 0, saldo, diferencaParaCompetencia: 0 });
const caixa = (menor: number): PlanejamentoCaixa => ({
  meses: [mesDeCaixa(1, menor), mesDeCaixa(2, 40), ...Array(10).fill(null)],
  mesesCalculados: [1, 2],
  total: { entradas: 100, saidas: 90, resultado: 10, saldoFinal: 40, menorSaldo: { mes: 1, valor: menor }, necessidadeDeCapital: menor < 0 ? -menor : 0 }
});

// Money lê o contexto de ocultar valores, que por sua vez lê a sessão.
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;

const montar = (lucro: number | null, menor: number) =>
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider>
        <Veredito ano={2031} anoBase={2030} nome="Teste" projecao={projecao} resultado={resultado(lucro)} caixa={caixa(menor)} calculando={false} previa={false} />
      </HideValuesProvider>
    </SessionContext.Provider>
  );

describe("Veredito", () => {
  it("lucro e caixa sempre positivo: fecha no azul e o caixa aguenta", () => {
    montar(300, 20);
    expect(screen.getByRole("heading", { name: "Fecha no azul e o caixa aguenta" })).toBeInTheDocument();
  });

  it("lucro com caixa negativo em algum mês: alerta de capital de giro", () => {
    montar(300, -50);
    expect(screen.getByRole("heading", { name: "Dá lucro, mas falta caixa" })).toBeInTheDocument();
    expect(screen.getByText(/capital de giro/)).toBeInTheDocument();
  });

  it("prejuízo: fecha no vermelho", () => {
    montar(-10, 20);
    expect(screen.getByRole("heading", { name: "Fecha no vermelho" })).toBeInTheDocument();
  });

  it("sem CMV não inventa veredito", () => {
    montar(null, 20);
    expect(screen.getByRole("heading", { name: "Ainda sem veredito" })).toBeInTheDocument();
  });

  it("a linha do tempo marca o mês de menor saldo para o leitor de tela", () => {
    montar(300, -50);
    expect(screen.getByText(/menor saldo do ano/)).toBeInTheDocument();
  });
});
