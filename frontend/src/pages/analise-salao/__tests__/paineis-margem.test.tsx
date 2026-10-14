import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import type { AnaliseMargem, AnaliseMargemAFazer, AnaliseMargemLinha } from "../../../api/client";
import { SessionContext } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { MargemPanel } from "../MargemPanel";
import { sessao } from "./fixtures";

// Dados 100% fictícios (repositório público).
const linha = (over: Partial<AnaliseMargemLinha> = {}): AnaliseMargemLinha => ({
  pratoId: "p1", prato: "Prato Alfa", produtosPdv: [{ codigo: "A1", nome: "PRATO ALFA" }], quantidade: 100, quantidadeSemCobranca: 0, receita: 6000, precoMedio: 60, precoFicha: 60,
  custoPorcao: 20, margemUnitaria: 40, margemPct: 0.6667, cmvPct: 0.3333, margemTotal: 4000, ...over
});
const faltante = (over: Partial<AnaliseMargemAFazer> = {}): AnaliseMargemAFazer => ({
  codigo: "G1", nome: "PRATO GAMA COM ARROZ", categoria: "PRATOS", quantidade: 80, receita: 4000, pctReceita: 0.2963, situacao: "sem-vinculo", pratoId: null, prato: null,
  sugestoes: [{ pratoId: "p-gama", nome: "Prato Gama", similaridade: 0.75 }], ...over
});

function margem(over: Partial<AnaliseMargem> = {}): AnaliseMargem {
  return {
    periodo: { inicio: "2026-09-14", fim: "2026-10-13" }, hojeFicouDeFora: false,
    cobertura: {
      receitaTotal: 93500, receitaBuffet: 60000, receitaBebidas: 20000, receitaPratos: 13500, receitaComMargem: 8000, receitaSemFicha: 1500, receitaCustoIncompleto: 0, receitaSemVinculo: 4000, receitaPratoIndisponivel: 0,
      pctComMargem: 0.5926, pctVinculadoSemCusto: 0.1111, pctSemVinculo: 0.2963, pctDaReceitaTotalComMargem: 0.0856, pratosComMargem: 2
    },
    linhas: [
      linha(),
      linha({ pratoId: "p2", prato: "Prato Beta", produtosPdv: [{ codigo: "B1", nome: "PRATO BETA" }], quantidade: 50, receita: 2000, precoMedio: 40, custoPorcao: 45, margemUnitaria: -5, margemPct: -0.125, cmvPct: 1.125, margemTotal: -250 })
    ],
    aFazer: [faltante(), faltante({ codigo: "D1", nome: "PRATO DELTA", receita: 1500, pctReceita: 0.1111, situacao: "sem-ficha", pratoId: "p-delta", prato: "Prato Delta", sugestoes: [] })],
    pratosParaVincular: [{ id: "p-delta", nome: "Prato Delta" }, { id: "p-gama", nome: "Prato Gama" }, { id: "p-eps", nome: "Prato Épsilon" }],
    insights: [{ id: "margem-negativa", tom: "alerta", secao: "margem", hipotese: false, impactoMes: null, titulo: "Prato Beta vende abaixo do custo", detalhe: "Preço médio de R$ 40 contra custo de R$ 45.", acao: "Confira a ficha." }],
    ...over
  };
}

const abrir = (dados: AnaliseMargem = margem(), extra: Partial<React.ComponentProps<typeof MargemPanel>> = {}, ocultar = false) => {
  const props = { dados, podeEditar: true, onVincular: vi.fn().mockResolvedValue(undefined), ...extra };
  render(
    <MemoryRouter>
      <SessionContext.Provider value={sessao(ocultar)}>
        <HideValuesProvider>
          <MargemPanel {...props} />
        </HideValuesProvider>
      </SessionContext.Provider>
    </MemoryRouter>
  );
  return props;
};
const linhaDe = (texto: string) => within(screen.getByRole("region", { name: "Tabela de margem por prato" })).getByText(texto).closest("tr") as HTMLElement;

describe("MargemPanel: resumo", () => {
  test("explica a conta: so ingredientes, e que buffet e bebida ficam de fora, com a participacao de cada um", () => {
    abrir();
    const contexto = document.querySelector(".analise-contexto")?.textContent ?? "";
    expect(contexto).toMatch(/só ingredientes/);
    expect(contexto).toMatch(/buffet \(64% da receita\)/);
    expect(contexto).toMatch(/Cada unidade vendida conta como uma porção/);
    expect(contexto).toMatch(/antes dos descontos da comanda/);
    expect(contexto).toMatch(/bebidas \(21%\)/);
  });

  test("quatro indicadores: cobertura, pratos, margem ponderada e o que falta", () => {
    abrir();
    const cartoes = [...document.querySelectorAll("article")].map((a) => a.textContent ?? "");
    expect(cartoes[0]).toMatch(/Pratos com margem.*59%.*R\$ 8\.000 de R\$ 13\.500.*8,6% da receita total/);
    expect(cartoes[1]).toMatch(/Quantos pratos.*2/);
    // (4.000 + -250) / 8.000 = 46,9%
    expect(cartoes[2]).toMatch(/Margem dos pratos com ficha.*47%.*R\$ 3\.750/);
    expect(cartoes[3]).toMatch(/Sem margem ainda.*41%/); // 29,6% sem vinculo + 11,1% sem ficha
  });

  test("cobertura baixa pinta o indicador de atencao", () => {
    abrir(margem({ cobertura: { ...margem().cobertura, pctComMargem: 0.3 } }));
    expect(document.querySelectorAll("article")[0].className).toMatch(/warning/);
  });

  test("cobertura boa nao pinta de atencao", () => {
    abrir(margem({ cobertura: { ...margem().cobertura, pctComMargem: 0.8, pctSemVinculo: 0.1, pctVinculadoSemCusto: 0.1 } }));
    expect(document.querySelectorAll("article")[0].className).not.toMatch(/warning/);
  });

  test("so buffet e bebida no periodo: mensagem propria, sem tabela vazia nem lista contraditoria", () => {
    abrir(margem({ cobertura: { ...margem().cobertura, receitaPratos: 0 }, linhas: [], aFazer: [] }));
    expect(screen.getByText(/só houve venda de buffet e de bebida/)).toBeTruthy();
    expect(screen.queryByText(/Todo prato vendido/)).toBeNull();
  });

  test("todos os pratos com margem negativa: nao diz que algum deixa dinheiro", () => {
    abrir(margem({ linhas: [margem().linhas[1]] }));
    expect(screen.queryByText(/O prato que mais deixa/)).toBeNull();
  });

  test("sem nenhuma venda: avisa que nao ha item vendido", () => {
    abrir(margem({ cobertura: { ...margem().cobertura, receitaTotal: 0, receitaPratos: 0 }, linhas: [], aFazer: [] }));
    expect(screen.getByText(/Ainda não há item vendido neste período/)).toBeTruthy();
  });

  test("hoje fora do periodo: aviso", () => {
    abrir(margem({ hojeFicouDeFora: true }));
    expect(screen.getByText(/Hoje fica de fora/)).toBeTruthy();
  });

  test("prioridades: mostra o aviso de margem negativa", () => {
    abrir();
    expect(screen.getByText("Prato Beta vende abaixo do custo")).toBeTruthy();
  });

  test("ocultar valores mascara os reais da tabela", () => {
    abrir(margem(), {}, true);
    const alfa = linhaDe("Prato Alfa").textContent ?? "";
    expect(alfa).toContain("R$ ••••");
    expect(alfa).not.toMatch(/R\$ 60,00|R\$ 4\.000/);
  });
});

describe("MargemPanel: tabela de margem", () => {
  test("preco medio, custo da porcao, margem por prato e total", () => {
    abrir();
    const alfa = linhaDe("Prato Alfa");
    const celulas = [...alfa.querySelectorAll("td")].map((c) => c.textContent);
    expect(celulas[0]).toBe("100");
    expect(celulas[1]).toBe("R$ 60,00");
    expect(celulas[2]).toBe("R$ 20,00");
    expect(celulas[3]).toMatch(/R\$ 40,00.*66,7% do preço · custo 33,3%/);
    expect(celulas[4]).toBe("R$ 4.000");
  });

  test("prato abaixo do custo: diz em texto e fica marcado (sinal de menos, nao so cor)", () => {
    abrir();
    const beta = linhaDe("Prato Beta");
    expect(beta.textContent).toMatch(/abaixo do custo/);
    expect(beta.textContent).toMatch(/−R\$ 5,00/);
    expect(beta.querySelector(".variacao-ruim")).not.toBeNull();
    expect(linhaDe("Prato Alfa").querySelector(".variacao-ruim")).toBeNull();
  });

  test("a ordem e a que veio do servidor (o que mais deixa primeiro)", () => {
    abrir();
    const pratos = [...document.querySelectorAll("table")[0].querySelectorAll("tbody th")].map((th) => th.childNodes[0].textContent);
    expect(pratos).toEqual(["Prato Alfa", "Prato Beta"]);
  });

  test("unidades sem cobranca aparecem junto das vendidas", () => {
    abrir(margem({ linhas: [linha({ quantidade: 100, quantidadeSemCobranca: 20 })] }));
    expect(linhaDe("Prato Alfa").querySelectorAll("td")[0].textContent).toMatch(/100.*20 sem cobrança/);
  });

  test("mostrando N de M: so aparece quando ha mais pendencias do que a lista traz", () => {
    abrir(margem({ totalAFazer: 57 }));
    expect(screen.getByText(/Mostrando os 2 que mais vendem, de 57 pendentes/)).toBeTruthy();
  });

  test("lista completa (total igual ao mostrado) ou total ausente: sem o aviso", () => {
    abrir(margem({ totalAFazer: 2 }));
    expect(screen.queryByText(/Mostrando os/)).toBeNull();
  });

  test("o custo da porcao e o da ficha de HOJE: a tela diz", () => {
    abrir();
    expect(document.querySelector(".analise-contexto")?.textContent).toMatch(/custo da porção é o da ficha de HOJE/);
  });

  test("periodo que e so o dia em andamento: sem culpar o agente (so o aviso do dia)", () => {
    abrir(margem({ hojeFicouDeFora: true, periodo: { inicio: "2026-10-14", fim: "2026-10-14" }, cobertura: { ...margem().cobertura, receitaTotal: 0, receitaPratos: 0 }, linhas: [], aFazer: [] }));
    expect(screen.queryByText(/agente do PDV precisa estar atualizado/)).toBeNull();
  });

  test("periodo LONGO sem venda em que hoje tambem ficou de fora: o alerta do agente continua (so o dia unico o dispensa)", () => {
    abrir(margem({ hojeFicouDeFora: true, cobertura: { ...margem().cobertura, receitaTotal: 0, receitaPratos: 0 }, linhas: [], aFazer: [] }));
    expect(screen.getByText(/agente do PDV precisa estar atualizado/)).toBeTruthy();
    expect(screen.getByText(/Hoje fica de fora/)).toBeTruthy();
  });

  test("periodo antigo sem venda: continua explicando o agente do PDV", () => {
    abrir(margem({ hojeFicouDeFora: false, cobertura: { ...margem().cobertura, receitaTotal: 0, receitaPratos: 0 }, linhas: [], aFazer: [] }));
    expect(screen.getByText(/agente do PDV precisa estar atualizado/)).toBeTruthy();
  });

  test("a tabela rola por teclado em tela estreita", () => {
    abrir();
    expect(screen.getByRole("region", { name: "Tabela de margem por prato" }).getAttribute("tabindex")).toBe("0");
  });

  test("sem linhas: convida a vincular os produtos", () => {
    abrir(margem({ linhas: [] }));
    expect(screen.getByText(/Nenhum prato com margem calculada/)).toBeTruthy();
  });

  test("desfazer vinculo chama onVincular com pratoId null; sem permissao nao aparece", async () => {
    const p = abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Desfazer vínculo de PRATO ALFA" })[0]);
    await waitFor(() => expect(p.onVincular).toHaveBeenCalledWith("A1", "PRATO ALFA", null));
  });

  test("falha ao desfazer: a mensagem diz de qual produto", async () => {
    abrir(margem(), { onVincular: vi.fn().mockRejectedValue(new Error("falhou")) });
    fireEvent.click(screen.getAllByRole("button", { name: "Desfazer vínculo de PRATO ALFA" })[0]);
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível desfazer o vínculo de PRATO ALFA: falhou");
  });

  test("sem permissao de editar: nenhum botao de desfazer nem de vincular", () => {
    abrir(margem(), { podeEditar: false });
    expect(screen.queryByRole("button", { name: /Desfazer vínculo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Vincular/ })).toBeNull();
    expect(screen.getByText(/Falta ligar este produto a um prato/)).toBeTruthy();
  });

  test("falha ao desfazer: o erro e anunciado", async () => {
    abrir(margem(), { onVincular: vi.fn().mockRejectedValue(new Error("Usuário sem permissão para editar vínculos da margem.")) });
    fireEvent.click(screen.getAllByRole("button", { name: "Desfazer vínculo de PRATO ALFA" })[0]);
    expect((await screen.findByRole("alert")).textContent).toMatch(/sem permissão/);
  });
});

describe("MargemPanel: o que falta", () => {
  test("lista na ordem recebida, com selo da situacao e a participacao na receita dos pratos", () => {
    abrir();
    const tabela = screen.getByRole("region", { name: "Produtos do PDV sem margem calculada" });
    const gama = within(tabela).getByText("PRATO GAMA COM ARROZ").closest("tr") as HTMLElement;
    expect(within(gama).getByText("Sem vínculo")).toBeTruthy();
    expect(gama.textContent).toMatch(/29,6% da receita dos pratos/);
    const delta = within(tabela).getByText("PRATO DELTA").closest("tr") as HTMLElement;
    expect(within(delta).getByText("Ficha sem ingredientes")).toBeTruthy();
  });

  test("sem vinculo: o select traz primeiro os parecidos e depois os demais, sem repetir", () => {
    abrir();
    const select = screen.getByLabelText(/Prato da ficha para PRATO GAMA COM ARROZ/) as HTMLSelectElement;
    const grupos = [...select.querySelectorAll("optgroup")].map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.textContent)]);
    expect(grupos).toEqual([
      ["Parecidos com o nome", ["Prato Gama"]],
      ["Todos os pratos do salão", ["Prato Delta", "Prato Épsilon"]]
    ]);
  });

  test("vincular envia codigo, nome do PDV e o prato escolhido", async () => {
    const p = abrir();
    fireEvent.change(screen.getByLabelText(/Prato da ficha para PRATO GAMA COM ARROZ/), { target: { value: "p-gama" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular PRATO GAMA COM ARROZ" }));
    await waitFor(() => expect(p.onVincular).toHaveBeenCalledWith("G1", "PRATO GAMA COM ARROZ", "p-gama"));
  });

  test("prato desativado: selo proprio e o select para escolher outro prato", () => {
    abrir(margem({ aFazer: [faltante({ situacao: "prato-indisponivel" })] }));
    expect(screen.getByText("Prato desativado")).toBeTruthy();
    expect(screen.getByText(/foi desativado ou saiu do cardápio do salão/)).toBeTruthy();
    expect(screen.getByLabelText(/Prato da ficha para PRATO GAMA COM ARROZ/)).toBeTruthy();
  });

  test("produto sem codigo no PDV: explica que nao da para vincular", () => {
    abrir(margem({ aFazer: [faltante({ codigo: null, sugestoes: [] })] }));
    expect(screen.getByText(/não tem código no PDV e não dá para vincular/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Vincular/ })).toBeNull();
  });

  test("vincular sem escolher prato nao faz nada", () => {
    const p = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Vincular PRATO GAMA COM ARROZ" }));
    expect(p.onVincular).not.toHaveBeenCalled();
  });

  test("falha ao vincular: erro anunciado na linha, e o botao volta", async () => {
    abrir(margem(), { onVincular: vi.fn().mockRejectedValue(new Error("Prato inválido: escolha um prato ativo do cardápio do salão.")) });
    fireEvent.change(screen.getByLabelText(/Prato da ficha para PRATO GAMA COM ARROZ/), { target: { value: "p-gama" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular PRATO GAMA COM ARROZ" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Prato inválido/);
    expect(screen.getByRole("button", { name: "Vincular PRATO GAMA COM ARROZ" })).toBeTruthy();
  });

  test("ficha sem ingredientes e custo incompleto mandam para as fichas tecnicas", () => {
    abrir(margem({ aFazer: [
      faltante({ codigo: "D1", nome: "PRATO DELTA", situacao: "sem-ficha", pratoId: "p-delta", prato: "Prato Delta", sugestoes: [] }),
      faltante({ codigo: "E1", nome: "PRATO EPSILON", situacao: "custo-incompleto", pratoId: "p-eps", prato: "Prato Épsilon", sugestoes: [] })
    ] }));
    expect(screen.getByText("Custo incompleto")).toBeTruthy();
    expect(screen.getByText(/tem ingrediente sem custo ou sem conversão de unidade/)).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /Abrir fichas técnicas para/ });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/cardapio/fichas-tecnicas");
  });

  test("lista vazia: tudo calculado", () => {
    abrir(margem({ aFazer: [] }));
    expect(screen.getByText(/Todo prato vendido neste período já tem margem calculada/)).toBeTruthy();
  });

  test("a lista tambem rola por teclado", () => {
    abrir();
    expect(screen.getByRole("region", { name: "Produtos do PDV sem margem calculada" }).getAttribute("tabindex")).toBe("0");
  });
});
