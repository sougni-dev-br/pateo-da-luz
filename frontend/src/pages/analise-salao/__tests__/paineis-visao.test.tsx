import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { DemandaPanel } from "../DemandaPanel";
import { agruparSerie, mediaDasBarras } from "../agruparSerie";
import { GraficoDiario } from "../GraficoDiario";
import { InsightCard } from "../InsightCard";
import { PerdasPanel } from "../PerdasPanel";
import { ResumoPanel } from "../ResumoPanel";
import { demanda, indicadores, perdas, renderComSessao, resumo } from "./fixtures";

describe("ResumoPanel", () => {
  test("mostra os quatro indicadores com valor por dia e a comparacao com o periodo anterior", () => {
    renderComSessao(<ResumoPanel dados={resumo()} onAbrir={vi.fn()} />);
    expect(screen.getByText("Faturamento por dia")).toBeTruthy();
    expect(screen.getByText("Pessoas por dia")).toBeTruthy();
    expect(screen.getByText("Ticket por pessoa")).toBeTruthy();
    expect(screen.getByText("Perda potencial")).toBeTruthy();
    expect(screen.getAllByText(/−16,7% vs\. anterior/).length).toBeGreaterThanOrEqual(2); // faturamento e pessoas por dia
    expect(screen.getByText(/comparado a 15\/08 a 13\/09/)).toBeTruthy();
  });

  test("o contexto diz o periodo, os dias com movimento e a base de comparacao", () => {
    const { container } = renderComSessao(<ResumoPanel dados={resumo()} onAbrir={vi.fn()} />);
    const contexto = container.querySelector(".analise-contexto")?.textContent ?? "";
    expect(contexto).toMatch(/14\/09 a 13\/10/);
    expect(contexto).toMatch(/30 de 30 dias com movimento/);
  });

  test("a perda e rotulada como estimativa e mostra o teto sem abater a refacao", () => {
    renderComSessao(<ResumoPanel dados={resumo()} onAbrir={vi.fn()} />);
    expect(screen.getByText(/É uma estimativa: nem todo valor aqui é dinheiro perdido/)).toBeTruthy();
    expect(screen.getByText(/até R\$ 12,5 mil se nenhuma refação for real/)).toBeTruthy();
  });

  test("hoje fora da conta: a tela avisa, em vez de deixar o periodo parecer mais curto", () => {
    renderComSessao(<ResumoPanel dados={resumo({ hojeFicouDeFora: true })} onAbrir={vi.fn()} />);
    expect(screen.getByText(/Hoje fica de fora: o dia ainda não fechou/)).toBeTruthy();
  });

  test("sem esse corte, nao ha aviso de hoje", () => {
    renderComSessao(<ResumoPanel dados={resumo({ hojeFicouDeFora: false })} onAbrir={vi.fn()} />);
    expect(screen.queryByText(/Hoje fica de fora/)).toBeNull();
  });

  test("base anterior zerada: sem selo de variacao em vez de 'sem base ... vs. anterior'", () => {
    const base = resumo();
    renderComSessao(
      <ResumoPanel dados={resumo({ comparacao: { ...base.comparacao!, faturamentoPorDia: { atual: 5000, anterior: 0, diferenca: 5000, pct: null } } })} onAbrir={vi.fn()} />
    );
    expect(screen.queryByText(/sem base de comparação/)).toBeNull();
  });

  test("perda de 3% ou mais fica em tom de perigo; abaixo de 1,5% fica neutra", () => {
    const alta = renderComSessao(<ResumoPanel dados={resumo()} onAbrir={vi.fn()} />);
    expect(alta.container.querySelector(".ds-kpi-card-danger")).not.toBeNull();
    alta.unmount();
    const baixa = renderComSessao(<ResumoPanel dados={resumo({ atual: indicadores({ perdaPct: 0.01, perdaValor: 1500 }) })} onAbrir={vi.fn()} />);
    expect(baixa.container.querySelector(".ds-kpi-card-danger")).toBeNull();
    expect(baixa.container.querySelector(".ds-kpi-card-warning")).toBeNull();
  });

  test("sem base de comparacao: avisa e nao mostra variacao nenhuma", () => {
    renderComSessao(<ResumoPanel dados={resumo({ anterior: null, anteriorConfiavel: false, comparacao: null })} onAbrir={vi.fn()} />);
    expect(screen.getByText(/período anterior tem poucos dias com movimento/)).toBeTruthy();
    expect(screen.getByText(/sem período anterior para comparar/)).toBeTruthy();
    expect(screen.queryByText(/vs\. anterior/)).toBeNull();
  });

  test("perda subindo e mostrada como ruim (vermelho), mesmo sendo 'alta'", () => {
    const { container } = renderComSessao(<ResumoPanel dados={resumo()} onAbrir={vi.fn()} />);
    expect(container.querySelector(".variacao-ruim")).not.toBeNull();
    expect(container.querySelector(".variacao-bom")).toBeNull();
  });

  test("lista os avisos de decisao com impacto e abre a secao certa pelo link", () => {
    const onAbrir = vi.fn();
    renderComSessao(<ResumoPanel dados={resumo()} onAbrir={onAbrir} />);
    expect(screen.getByText("Movimento caiu 17% contra o período anterior")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Abrir Quando vendemos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir Perdas/ }));
    expect(onAbrir.mock.calls.map((c) => c[0])).toEqual(["demanda", "perdas"]);
  });

  test("sem avisos: diz que esta tudo dentro do esperado", () => {
    renderComSessao(<ResumoPanel dados={resumo({ insights: [] })} onAbrir={vi.fn()} />);
    expect(screen.getByText(/Nada fora do normal neste período/)).toBeTruthy();
  });

  test("periodo sem nenhuma venda detalhada: orienta a atualizar o agente, sem zeros", () => {
    renderComSessao(
      <ResumoPanel dados={resumo({ cobertura: { diasNoPeriodo: 30, diasComMovimento: 0, primeiroDia: null, ultimoDia: null, vendasComDetalhe: 0 } })} onAbrir={vi.fn()} />
    );
    expect(screen.getByText(/Ainda não há venda detalhada neste período/)).toBeTruthy();
    expect(screen.queryByText("Faturamento por dia")).toBeNull();
  });

  test("ocultar valores esconde os reais dos cartoes E das frases dos avisos", () => {
    const { container } = renderComSessao(<ResumoPanel dados={resumo()} onAbrir={vi.fn()} />, { ocultar: true });
    expect(screen.queryByText(/R\$ 30,0 mil/)).toBeNull();
    expect(screen.getAllByText(/R\$ ••••/).length).toBeGreaterThan(0);
    // "R$ 11.000 no periodo" vem pronto do servidor dentro do texto do aviso
    expect(container.querySelector(".insights")?.textContent ?? "").not.toMatch(/R\$ \d/);
  });
});

describe("ResumoPanel — sparklines", () => {
  // pessoas SOBEM (10..39) e faturamento DESCE: cada cartao tem que desenhar a sua serie.
  const dados = () =>
    resumo({
      serie: Array.from({ length: 30 }, (_, i) => ({
        data: new Date(Date.UTC(2026, 8, 14 + i)).toISOString().slice(0, 10), faturamento: (30 - i) * 100, pessoas: 10 + i, comandas: 5, temMovimento: true
      }))
    });
  const caminho = (container: HTMLElement, rotulo: string) =>
    ([...container.querySelectorAll("article")].find((a) => a.textContent?.includes(rotulo))?.querySelector(".ds-sparkline-line")?.getAttribute("d") ?? "");

  test("pessoas por dia desenha a serie de pessoas (sobe); faturamento desenha a dele (desce)", () => {
    const { container } = renderComSessao(<ResumoPanel dados={dados()} onAbrir={vi.fn()} />);
    expect(caminho(container, "Pessoas por dia")).toMatch(/^M0\.00,30\.00/); // comeca embaixo
    expect(caminho(container, "Faturamento por dia")).toMatch(/^M0\.00,0\.00/); // comeca em cima
  });
});

describe("InsightCard", () => {
  const base = { id: "x", tom: "oportunidade" as const, titulo: "Titulo", detalhe: "Detalhe", acao: "Acao sugerida", impactoMes: 12000, hipotese: true, secao: "demanda" as const };

  test("impacto de hipotese e rotulado como tal", () => {
    renderComSessao(<ul><InsightCard insight={base} onAbrir={vi.fn()} /></ul>);
    expect(screen.getByText("R$ 12,0 mil")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Impacto estimado por mês" })).toBeTruthy();
    expect(screen.getByText("hipótese, não previsão")).toBeTruthy();
    expect(screen.getByText("Oportunidade")).toBeTruthy();
  });

  test("impacto medido diz que e estimativa ao ritmo atual", () => {
    renderComSessao(<ul><InsightCard insight={{ ...base, hipotese: false, tom: "alerta" }} onAbrir={vi.fn()} /></ul>);
    expect(screen.getByText("estimativa ao ritmo atual")).toBeTruthy();
    expect(screen.getByText("Atenção")).toBeTruthy();
  });

  test("sem impacto estimavel: nao inventa numero", () => {
    renderComSessao(<ul><InsightCard insight={{ ...base, impactoMes: null, tom: "info" }} onAbrir={vi.fn()} /></ul>);
    expect(screen.queryByLabelText("Impacto estimado por mês")).toBeNull();
    expect(screen.getByText("Para conferir")).toBeTruthy();
  });

  test("ocultar valores mascara reais no titulo, no detalhe E na acao sugerida", () => {
    const insight = { ...base, titulo: "Somam R$ 6.697", detalhe: "Perda de R$ 11.000 no periodo", acao: "Recupere ate R$ 26,4 mil por mes" };
    const { container } = renderComSessao(<ul><InsightCard insight={insight} onAbrir={vi.fn()} /></ul>, { ocultar: true });
    const texto = container.querySelector(".insight-corpo")?.textContent ?? "";
    expect(texto).not.toMatch(/R\$ \d/);
    expect(texto).toContain("Somam R$ ••••");
    expect(texto).toContain("Recupere ate R$ •••• por mes");
  });

  test("aviso da propria tela de resumo nao tem link", () => {
    renderComSessao(<ul><InsightCard insight={{ ...base, secao: "resumo" }} onAbrir={vi.fn()} /></ul>);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("GraficoDiario", () => {
  const dia = (i: number, f: number, mov = true, inicio = Date.UTC(2026, 9, 5)) => ({
    data: new Date(inicio + i * 86_400_000).toISOString().slice(0, 10), faturamento: f, pessoas: f / 100, comandas: 1, temMovimento: mov
  });

  test("periodo curto: uma barra por dia, com fim de semana marcado e dia parado a parte", () => {
    const serie = [dia(0, 1000), dia(1, 0, false), dia(5, 2000), dia(6, 3000)]; // seg, ter(parada), sab, dom
    const { barras, semanal } = agruparSerie(serie);
    expect(semanal).toBe(false);
    expect(barras).toHaveLength(4);
    expect(barras.map((b) => b.fimDeSemana)).toEqual([false, false, true, true]);
    expect(barras[1].parado).toBe(true);
  });

  test("periodo longo (mais de 45 dias) vira barras SEMANAIS, de segunda a domingo, somadas", () => {
    const serie = Array.from({ length: 70 }, (_, i) => dia(i, 100)); // comeca numa segunda, 10 semanas certas
    const { barras, semanal } = agruparSerie(serie);
    expect(semanal).toBe(true);
    expect(barras).toHaveLength(10);
    expect(barras[0].faturamento).toBe(700);
    expect(barras[0].rotulo).toBe("Semana de 05/10");
    expect(barras.every((b) => !b.parcial)).toBe(true);
  });

  test("periodo que nao comeca na segunda: a primeira e a ultima semanas sao PARCIAIS e saem da media", () => {
    // 05/10/2026 e segunda: comecar na quarta (07/10) e terminar na terca deixa as pontas incompletas
    const serie = Array.from({ length: 70 }, (_, i) => dia(i, 100, true, Date.UTC(2026, 9, 7)));
    const { barras } = agruparSerie(serie);
    expect(barras[0].rotulo).toBe("Semana de 05/10 (parcial)"); // a barra e rotulada pela SEGUNDA, nao pelo primeiro dia
    expect(barras[0].parcial).toBe(true);
    expect(barras[0].faturamento).toBe(500); // so quarta a domingo
    expect(barras[barras.length - 1].parcial).toBe(true);
    expect(mediaDasBarras(barras)).toBe(700); // so as semanas completas
  });

  test("semana toda parada fica marcada como parada", () => {
    const serie = Array.from({ length: 70 }, (_, i) => dia(i, i < 7 ? 0 : 100, i >= 7));
    expect(agruparSerie(serie).barras[0].parado).toBe(true);
  });

  test("a media do modo diario ignora dia parado", () => {
    expect(mediaDasBarras(agruparSerie([dia(0, 1000), dia(1, 0, false), dia(2, 3000)]).barras)).toBe(2000);
  });

  test("renderiza a legenda, a media dos dias com movimento e o intervalo", () => {
    const serie = [dia(0, 1000), dia(1, 0, false), dia(2, 3000)];
    renderComSessao(<GraficoDiario serie={serie} />);
    expect(screen.getByText(/média dos dias com movimento \(R\$ 2\.000\)/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Faturamento de 05/10 a 07/10, 3 dias" })).toBeTruthy();
  });

  test("modo semanal: a legenda fala de semanas completas e nao de 'dia util' nem de fim de semana", () => {
    const serie = Array.from({ length: 70 }, (_, i) => dia(i, 100, true, Date.UTC(2026, 9, 7)));
    renderComSessao(<GraficoDiario serie={serie} />);
    expect(screen.getByText(/média das semanas completas \(R\$ 700\)/)).toBeTruthy();
    expect(screen.getByText(/semana parcial \(fora da média\)/)).toBeTruthy();
    expect(screen.queryByText("dia útil")).toBeNull();
    expect(screen.queryByText("sábado e domingo")).toBeNull();
  });

  test("leitor de tela recebe um resumo em texto: periodo, media, maior e menor dia", () => {
    const serie = [dia(0, 1000), dia(1, 0, false), dia(2, 3000)];
    const { container } = renderComSessao(<GraficoDiario serie={serie} />);
    const resumo = container.querySelector("p.sr-only")?.textContent ?? "";
    expect(resumo).toMatch(/^Média R\$ 2\.000\./);
    expect(resumo).not.toMatch(/Faturamento de/); // o intervalo ja e anunciado pelo rotulo do grafico
    expect(resumo).toMatch(/Maior: Qua 07\/10, R\$ 3\.000\. Menor com movimento: Seg 05\/10, R\$ 1\.000\./);
  });

  test("maior e menor ignoram semana parcial (so tem parte dos dias)", () => {
    // 70 dias comecando na quarta: a primeira semana (parcial) e a menor de todas, mas nao conta
    const serie = Array.from({ length: 70 }, (_, i) => dia(i, 100, true, Date.UTC(2026, 9, 7)));
    const { container } = renderComSessao(<GraficoDiario serie={serie} />);
    const resumo = container.querySelector("p.sr-only")?.textContent ?? "";
    expect(resumo).not.toMatch(/parcial/);
    expect(resumo).toMatch(/Menor com movimento: Semana de \d\d\/\d\d, R\$ 700/);
  });

  test("periodo que atravessa o ano mostra o ano no eixo e no rotulo", () => {
    const serie = [dia(0, 100, true, Date.UTC(2025, 11, 30)), dia(5, 100, true, Date.UTC(2025, 11, 30))];
    const { container } = renderComSessao(<GraficoDiario serie={serie} />);
    expect(container.querySelector(".grafico-eixo")?.textContent).toBe("30/12/20254/01/2026".replace("4/01", "04/01"));
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/30\/12\/2025 a 04\/01\/2026/);
  });

  test("ocultar valores esconde os reais do resumo, da legenda e dos titulos das barras", () => {
    const serie = [dia(0, 1000), dia(1, 3000)];
    const { container } = renderComSessao(<GraficoDiario serie={serie} />, { ocultar: true });
    expect(container.textContent).not.toMatch(/R\$ \d/);
    expect([...container.querySelectorAll(".grafico-barra")].every((b) => !/R\$ \d/.test(b.getAttribute("title") ?? ""))).toBe(true);
  });

  test("cada barra tem um texto com dia, valor e pessoas; dia parado diz 'sem vendas'", () => {
    const serie = [dia(0, 1000), dia(1, 0, false)];
    const { container } = renderComSessao(<GraficoDiario serie={serie} />);
    const titulos = [...container.querySelectorAll(".grafico-barra")].map((b) => b.getAttribute("title"));
    expect(titulos[0]).toMatch(/Seg 05\/10: R\$ 1\.000 · 10 pessoas/);
    expect(titulos[1]).toMatch(/Ter 06\/10: sem vendas/);
  });

  test("serie vazia nao renderiza nada", () => {
    const { container } = renderComSessao(<GraficoDiario serie={[]} />);
    expect(container.querySelector(".grafico-diario")).toBeNull();
  });
});

describe("DemandaPanel", () => {
  test("o mapa lista os dias a partir da segunda e termina no domingo", () => {
    renderComSessao(<DemandaPanel dados={demanda()} />);
    const mapa = screen.getByRole("table", { name: /Pessoas por dia, por dia da semana e hora/ });
    const linhas = within(mapa).getAllByRole("row").slice(1);
    const dias = linhas.map((l) => within(l).getAllByRole("rowheader")[0].textContent ?? "");
    expect(dias[0]).toMatch(/^Segunda/);
    expect(dias[6]).toMatch(/^Domingo/);
  });

  test("a celula do mapa traz a media de pessoas por dia no texto", () => {
    renderComSessao(<DemandaPanel dados={demanda()} />);
    const celula = screen.getAllByTitle(/Quinta, 12h: 50,0 pessoas por dia \(8 comandas\)/);
    expect(celula.length).toBe(1);
    expect(celula[0].textContent).toBe("50");
  });

  test("a celula arredonda para o inteiro mais proximo e mostra '<1' para fracao pequena", () => {
    const base = demanda();
    const celulas = [
      { dow: 4, hora: "12", pessoasPorDia: 40.4, faturamentoPorDia: 0, vendas: 1 },
      { dow: 4, hora: "13", pessoasPorDia: 0.3, faturamentoPorDia: 0, vendas: 1 },
      { dow: 4, hora: "19", pessoasPorDia: 0.5, faturamentoPorDia: 0, vendas: 1 }
    ];
    renderComSessao(<DemandaPanel dados={demanda({ mapa: { horas: base.mapa.horas, celulas } })} />);
    expect(screen.getByTitle(/Quinta, 12h/).textContent).toBe("40"); // 40,4 nao vira 41
    expect(screen.getByTitle(/Quinta, 13h/).textContent).toBe("<1");
    expect(screen.getByTitle(/Quinta, 19h/).textContent).toBe("1");
  });

  test("dia da semana sem nenhum dia observado aparece com '—' no total, nao como zero", () => {
    const base = demanda();
    const dias = base.diasDaSemana.map((d) => (d.dow === 3 ? { ...d, diasObservados: 0, pessoasPorDia: 0, faturamentoPorDia: 0, ticketPessoa: 0 } : d));
    renderComSessao(<DemandaPanel dados={demanda({ diasDaSemana: dias })} />);
    const mapa = screen.getByRole("table", { name: /Pessoas por dia, por dia da semana e hora/ });
    const quarta = within(mapa).getAllByRole("row").find((r) => r.textContent?.startsWith("Quarta")) as HTMLElement;
    expect(within(quarta).getAllByRole("cell").slice(-1)[0].textContent).toBe("—");
  });

  test("mostra a participacao de cada turno e o ticket", () => {
    renderComSessao(<DemandaPanel dados={demanda()} />);
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText(/1\.620 pessoas · R\$ 100 por pessoa/)).toBeTruthy();
  });

  test("a folga de capacidade traz a conta e diz que e hipotese, nao previsao", () => {
    renderComSessao(<DemandaPanel dados={demanda()} />);
    expect(screen.getByText(/não uma previsão/)).toBeTruthy();
    expect(screen.getByText("R$ 22,0 mil")).toBeTruthy();
    expect(screen.getByText(/25,0 pessoas por dia, 25% do melhor · faltam 45 para a meta/)).toBeTruthy();
    expect(screen.getByText(/por mês, se chegasse à meta/)).toBeTruthy();
  });

  test("turno sem referencia (amostra pequena) nao aparece na capacidade", () => {
    renderComSessao(<DemandaPanel dados={demanda()} />);
    expect(screen.queryByLabelText("Capacidade no jantar")).toBeNull();
    expect(screen.getByLabelText("Capacidade no almoço")).toBeTruthy();
  });

  test("nenhum turno comparavel: explica o minimo de dias em vez de ficar vazio", () => {
    const base = demanda();
    renderComSessao(<DemandaPanel dados={demanda({ capacidade: { ...base.capacidade, turnos: base.capacidade.turnos.map((t) => ({ ...t, referencia: null, folgas: [] })) } })} />);
    expect(screen.getByText(/pelo menos 3 de cada dia da semana/)).toBeTruthy();
  });

  test("periodo curto (menos de 21 dias com movimento): avisa que a media oscila", () => {
    renderComSessao(<DemandaPanel dados={demanda({ cobertura: { vendas: 100, vendasSemHora: 0, diasComMovimento: 9 } })} />);
    expect(screen.getByText(/poucos dias \(9\)/)).toBeTruthy();
  });

  test("vendas sem horario ficam fora do mapa e sao avisadas", () => {
    renderComSessao(<DemandaPanel dados={demanda({ cobertura: { vendas: 800, vendasSemHora: 12, diasComMovimento: 28 } })} />);
    expect(screen.getByText(/12 comandas sem horário ficam fora do mapa de calor/)).toBeTruthy();
  });

  test("hoje fora da conta: aviso", () => {
    renderComSessao(<DemandaPanel dados={demanda({ hojeFicouDeFora: true })} />);
    expect(screen.getByText(/Hoje fica de fora/)).toBeTruthy();
  });

  test("o mapa de calor e uma regiao rolavel e navegavel por teclado", () => {
    renderComSessao(<DemandaPanel dados={demanda()} />);
    const regiao = screen.getByRole("region", { name: /Mapa de calor/ });
    expect(regiao.getAttribute("tabindex")).toBe("0");
  });

  test("sem venda detalhada: orienta a atualizar o agente", () => {
    renderComSessao(<DemandaPanel dados={demanda({ cobertura: { vendas: 0, vendasSemHora: 0, diasComMovimento: 0 } })} />);
    expect(screen.getByText(/Ainda não há venda detalhada neste período/)).toBeTruthy();
  });

  test("sem nenhuma hora no mapa: mensagem simples", () => {
    renderComSessao(<DemandaPanel dados={demanda({ mapa: { horas: [], celulas: [] } })} />);
    expect(screen.getByText(/Nenhuma venda com horário neste período/)).toBeTruthy();
  });

  test("a tabela de dias da semana fica num quadro com rolagem navegavel por teclado", () => {
    const { container } = renderComSessao(<DemandaPanel dados={demanda()} />);
    const quadro = container.querySelector(".dias-rolagem") as HTMLElement;
    expect(quadro.querySelector("table.dias-semana")).not.toBeNull();
    expect(quadro.getAttribute("tabindex")).toBe("0");
    expect(quadro.getAttribute("role")).toBe("region");
    expect(quadro.getAttribute("aria-label")).toMatch(/Pessoas por dia/);
  });

  test("a tabela de dias da semana mostra almoco e jantar de cada dia", () => {
    renderComSessao(<DemandaPanel dados={demanda()} />);
    expect(screen.getAllByText(/almoço 100,0 · jantar 30,0/).length).toBe(1); // quinta
  });
});

describe("PerdasPanel", () => {
  test("o funil mostra do cancelado ate a perda potencial", () => {
    renderComSessao(<PerdasPanel dados={perdas()} />);
    for (const t of ["Cancelado em vendas", "Cancelamento sem refação", "Itens cancelados em vendas pagas", "Descontos", "Perda potencial"]) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("R$ 11.000", { selector: ".funil-total .funil-valor" })).toBeTruthy();
    expect(screen.getAllByText(/7,3% do faturamento/).length).toBeGreaterThan(0);
  });

  test("a refacao entra com sinal de menos (abate o cancelado), os demais com mais", () => {
    const { container } = renderComSessao(<PerdasPanel dados={perdas()} />);
    expect(container.querySelector(".funil-alivio .funil-sinal")?.textContent).toBe("−");
    expect([...container.querySelectorAll(".funil-perda .funil-sinal")].map((e) => e.textContent)).toEqual(["=", "+", "+"]);
  });

  test("explica a regra da refacao (janela e tolerancia) e admite coincidencia", () => {
    renderComSessao(<PerdasPanel dados={perdas()} />);
    expect(screen.getByText(/10 cancelamentos com venda paga quase igual: mesmo dia, mesmas pessoas, valor ±2% e até 10 min de diferença\. Pode haver coincidência\./)).toBeTruthy();
    expect(screen.getByText("Provável refação (comanda aberta de novo)")).toBeTruthy();
  });

  test("o cabecalho chama de estimativa e traz o teto sem abater a refacao", () => {
    const { container } = renderComSessao(<PerdasPanel dados={perdas()} />);
    const contexto = container.querySelector(".analise-contexto")?.textContent ?? "";
    expect(contexto).toMatch(/perda potencial estimada em R\$ 11\.000/);
    expect(contexto).toMatch(/até R\$ 12\.500 se nenhuma refação for real/);
    expect(contexto).toMatch(/nem todo cancelamento ou desconto é dinheiro que deixou de entrar/);
  });

  test("o total do funil mostra tambem o valor sem abater a refacao", () => {
    renderComSessao(<PerdasPanel dados={perdas()} />);
    expect(screen.getByText(/Sem abater a refação: R\$ 12\.500/)).toBeTruthy();
  });

  test("hoje fora da conta: aviso", () => {
    renderComSessao(<PerdasPanel dados={perdas({ hojeFicouDeFora: true })} />);
    expect(screen.getByText(/Hoje fica de fora/)).toBeTruthy();
  });

  test("so as maiores sao listadas: a tela diz quantas existem no total", () => {
    renderComSessao(<PerdasPanel dados={perdas({ funil: { ...perdas().funil, grandesVendas: 15 } })} />);
    expect(screen.getByText(/Mostrando as 2 maiores de 15/)).toBeTruthy();
    expect(screen.getByText(/inclui R\$ 6\.000 em 15 vendas de valor muito alto/)).toBeTruthy();
  });

  test("a pessoa que registrou o desconto vem de um campo a confirmar: a tela avisa", () => {
    renderComSessao(<PerdasPanel dados={perdas()} />);
    expect(screen.getByText(/a confirmar com a equipe/)).toBeTruthy();
  });

  test("as tabelas novas tem legenda e cabecalhos com escopo", () => {
    const { container } = renderComSessao(<PerdasPanel dados={perdas()} />);
    const captions = [...container.querySelectorAll("caption.sr-only")].map((c) => c.textContent);
    expect(captions).toEqual(expect.arrayContaining(["Cancelamentos de valor muito alto", "Perda potencial por funcionário"]));
    expect(container.querySelectorAll("th[scope='col']").length).toBeGreaterThanOrEqual(12);
  });

  test("lista os cancelamentos grandes com quem cancelou, motivo e se parece refeito", () => {
    renderComSessao(<PerdasPanel dados={perdas()} />);
    expect(screen.getByText(/Cancelamentos de valor muito alto \(a partir de R\$ 1\.000\)/)).toBeTruthy();
    const secao = screen.getByText(/Cancelamentos de valor muito alto \(a partir/).closest("section") as HTMLElement;
    expect(within(secao).getAllByRole("row")).toHaveLength(3); // cabecalho + 2 vendas
    expect(within(secao).getByText("Bruno Fictício")).toBeTruthy();
    expect(screen.getByText("evento adiado")).toBeTruthy();
    expect(screen.getByText("Provável")).toBeTruthy();
    expect(screen.getByText("Não")).toBeTruthy();
  });

  test("sem cancelamento grande: a secao nao aparece", () => {
    renderComSessao(<PerdasPanel dados={perdas({ grandes: [], funil: { ...perdas().funil, grandes: 0 } })} />);
    expect(screen.queryByText(/Cancelamentos de valor muito alto/)).toBeNull();
    expect(screen.queryByText(/inclui R\$/)).toBeNull();
  });

  test("por pessoa: cancelamento ja sem a refacao e '(nao informado)' por ultimo", () => {
    renderComSessao(<PerdasPanel dados={perdas()} />);
    const tabela = screen.getByText("Quem concentra a perda potencial").closest("section") as HTMLElement;
    const nomes = within(tabela).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(nomes).toEqual(["Ana Fictícia", "(não informado)"]);
    expect(within(tabela).getByText("24 · R$ 3.600")).toBeTruthy(); // 4.500 cancelado - 900 refeito
  });

  test("os tres relatorios detalhados ficam em secoes recolhiveis", () => {
    const { container } = renderComSessao(<PerdasPanel dados={perdas()} />);
    const sumarios = [...container.querySelectorAll("details > summary")].map((s) => s.textContent);
    expect(sumarios).toHaveLength(3);
    expect(sumarios[0]).toMatch(/Cancelamentos de venda/);
    expect(container.querySelector("details[open]")).toBeNull();
  });

  test("avisa quando nenhum cancelamento tem motivo", () => {
    renderComSessao(<PerdasPanel dados={perdas()} />);
    expect(screen.getAllByText(/Nenhum dos 40 cancelamentos tem motivo registrado/).length).toBeGreaterThan(0);
  });

  test("sem venda detalhada: orienta a atualizar o agente", () => {
    renderComSessao(<PerdasPanel dados={perdas({ cobertura: { vendasComDetalhe: 0 } })} />);
    expect(screen.getByText(/Ainda não há venda detalhada neste período/)).toBeTruthy();
    expect(screen.queryByText("Do cancelado à perda potencial")).toBeNull();
  });

  test("ocultar valores esconde os reais do funil", () => {
    renderComSessao(<PerdasPanel dados={perdas()} />, { ocultar: true });
    expect(screen.queryByText("R$ 11.000")).toBeNull();
    expect(screen.getAllByText("R$ ••••").length).toBeGreaterThan(3);
  });
});
