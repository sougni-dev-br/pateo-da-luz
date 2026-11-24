import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanejamentoCaixaPremissas, PlanejamentoLinhaDeGasto, PlanejamentoRealizado, PlanejamentoRealizadoDoGrupo } from "../../../api/client";
import { PageHeader } from "../../../components/ui/PageHeader";
import { RealizadoDialog } from "../RealizadoDialog";
import { ReguaDoPrazo } from "../ReguaDoPrazo";
import css from "../planejamento.css?raw";

const realizado = vi.hoisted(() => ({ resposta: null as PlanejamentoRealizado | null }));
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getPlanejamentoRealizado: () => Promise.resolve(realizado.resposta)
}));

afterEach(() => { realizado.resposta = null; });

const grupo = (g: PlanejamentoRealizadoDoGrupo["grupo"], media: number, percentualDaReceita: number): PlanejamentoRealizadoDoGrupo => ({
  grupo: g, origemNoDre: true, valoresPorMes: Array(12).fill(media) as number[], media, mesesConsiderados: [1, 2, 3], mesesSemLancamento: [], percentualDaReceita
});
const linha = (g: PlanejamentoLinhaDeGasto["grupo"], nome: string, valor: number): PlanejamentoLinhaDeGasto => ({ grupo: g, nome, modo: "FIXO", valores: Array(12).fill(valor) as number[], pagoNoMes: 1 });

describe("Diálogo de gastos: sugestão suspeita não vem marcada", () => {
  async function abrir(grupos: PlanejamentoRealizadoDoGrupo[], gastos: PlanejamentoLinhaDeGasto[]) {
    realizado.resposta = { ano: 2026, mesesEncerrados: [1, 2, 3], grupos };
    render(<RealizadoDialog aberto anoBase={2026} gastos={gastos} onFechar={vi.fn()} onAplicar={vi.fn()} />);
    await screen.findByRole("list", { name: "Realizado por grupo de gasto" });
  }

  it("receita incompleta: aviso único no topo, grupos desmarcados e o percentual só na etiqueta do cartão", async () => {
    await abrir(
      [grupo("OCUPACAO", 52000, 5.2), grupo("TARIFAS_PUBLICAS", 10550, 1.055), grupo("OUTROS", 39200, 3.92)],
      [linha("OCUPACAO", "Ocupação", 52000), linha("TARIFAS_PUBLICAS", "Tarifas públicas", 9800), linha("OUTROS", "Outros", 2000)]
    );
    for (const nome of ["Ocupação", "Tarifas públicas", "Outros"]) expect(screen.getByRole("checkbox", { name: `Usar ${nome}` })).not.toBeChecked();
    expect(screen.getAllByText(/o valor em R\$ continua valendo/)).toHaveLength(1);
    expect(screen.getByText("392% da receita")).toBeInTheDocument();
    expect(screen.getByText(/19,6 vezes o valor de hoje/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aplicar a 0 grupos/ })).toBeDisabled();
  });

  it("salto de mais de 3 vezes vem desmarcado; variação normal vem marcada e diz qual linha sobrescreve", async () => {
    await abrir(
      [grupo("OUTROS", 39200, 0.2), grupo("TARIFAS_PUBLICAS", 10550, 0.05)],
      [linha("OUTROS", "Outros", 2000), linha("TARIFAS_PUBLICAS", "Luz e água", 9800), linha("TARIFAS_PUBLICAS", "Gás", 900)]
    );
    expect(screen.getByRole("checkbox", { name: "Usar Outros" })).not.toBeChecked();
    expect(screen.getByText(/Confira antes de usar: 19,6 vezes o valor de hoje/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Usar Tarifas públicas" })).toBeChecked();
    expect(screen.getByText(/Substitui os 12 meses de “Luz e água”\. A outra linha do grupo fica como está\./)).toBeInTheDocument();
    expect(screen.getByText("Sobrescreve 1 linha do cenário")).toBeInTheDocument();
  });
});

const caixa = (credito: number, compras = 30): PlanejamentoCaixaPremissas => ({
  saldoInicial: 0,
  formas: [
    { forma: "PIX", mix: 0.2, prazoDias: 0, taxa: 0 },
    { forma: "CREDITO", mix: 0.8, prazoDias: credito, taxa: 0.025 }
  ],
  comprasPrazoDias: compras,
  herdado: { entradas: [0, 0, 0], saidas: [0, 0, 0] }
});

describe("Régua: prazos acima de 30 dias e saídas", () => {
  it("com Crédito em 45 dias, diz que parte só entra dois meses depois (sem a frase do mês seguinte)", () => {
    render(<ReguaDoPrazo caixa={caixa(45)} />);
    expect(screen.getByText("Fica para os meses seguintes").nextSibling).toHaveTextContent("80%");
    const frase = screen.getByText(/só entram nos meses seguintes/);
    expect(frase).toHaveTextContent(/cerca de R\$ 80 só entram nos meses seguintes: R\$ 40 no mês seguinte e R\$ 40 dois meses depois\./);
    expect(frase).not.toHaveTextContent(/caixa do mês seguinte/);
  });

  it("até 30 dias continua dizendo mês seguinte", () => {
    render(<ReguaDoPrazo caixa={caixa(30)} />);
    expect(screen.getByText("Fica para o mês seguinte")).toBeInTheDocument();
    expect(screen.getByText(/só entram no caixa do mês seguinte/)).toHaveTextContent(/cerca de R\$ 80/);
  });

  it("mostra as saídas na mesma régua: compras e o quanto dos gastos sai no mês", () => {
    render(<ReguaDoPrazo caixa={caixa(30, 15)} gastos={[linha("OCUPACAO", "Ocupação", 3000), { ...linha("OUTROS", "Outros", 1000), pagoNoMes: 0 }]} />);
    const saidas = screen.getByRole("list", { name: "Saídas: compras e gastos" });
    expect(saidas).toHaveTextContent(/Compras.*15 dias/);
    expect(saidas).toHaveTextContent("75% no mês");
    expect(screen.getByText(/Na saída, as compras são pagas em 15 dias e 75% dos gastos fixos saem no próprio mês: as compras vencem, em média, antes de o dinheiro das vendas chegar\./)).toBeInTheDocument();
  });

  it("o erro do mix vem antes das faixas, no topo da régua", () => {
    render(<ReguaDoPrazo caixa={{ ...caixa(30), formas: caixa(30).formas.map((f, i) => (i === 0 ? { ...f, mix: 0.1 } : f)) }} />);
    const erro = screen.getByRole("alert");
    const entradas = screen.getByRole("list", { name: "Entradas: vendas por forma de pagamento" });
    expect(erro.compareDocumentPosition(entradas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(erro).toHaveTextContent(/O mix soma 90%: faltam 10 pontos/);
  });
});

describe("Regra CSS que troca a descrição do shell na aba Cenários", () => {
  // planejamento.css alcança a linha de descrição do PageHeader do shell (App.tsx). Se o shell mudar a marcação, a
  // descrição do comparativo volta em silêncio na aba Cenários: este teste quebra antes.
  const seletor = /(\.page-header:has\(~ \.plan-raiz\[data-visao="cenarios"\]\)[^{]*)\{\s*display:\s*none/.exec(css)?.[1]?.trim();

  function montar(visao: "cenarios" | "comparativo") {
    return render(
      <div>
        <PageHeader title="Planejamento" description="Comparativo ano a ano do Salão" />
        <div className="plan plan-raiz" data-visao={visao} />
      </div>
    );
  }

  it("a regra existe em planejamento.css", () => {
    expect(seletor).toBeDefined();
  });

  it("na aba Cenários alcança só a descrição do shell, nunca o título", () => {
    const { container } = montar("cenarios");
    const alvos = [...container.querySelectorAll(seletor ?? "nada")];
    expect(alvos).toHaveLength(1);
    expect(alvos[0]).toHaveTextContent("Comparativo ano a ano do Salão");
    expect(alvos[0].tagName).not.toBe("H1");
  });

  it("no Comparativo não alcança nada (a descrição do shell é a certa ali)", () => {
    const { container } = montar("comparativo");
    expect(container.querySelectorAll(seletor ?? "nada")).toHaveLength(0);
  });
});
