import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AnaliseMetaIndicador, AnaliseMetas } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { MetasPanel } from "../MetasPanel";
import { MetasView } from "../MetasView";
import { lerNumeroBr, nomeDoMes } from "../formato";
import { renderComSessao } from "./fixtures";

const api = vi.hoisted(() => ({ getAnaliseMetas: vi.fn(), salvarAnaliseMeta: vi.fn() }));
vi.mock("../../../api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../api/client")>()), ...api }));

// Dados 100% fictícios (repositório público).
const ind = (over: Partial<AnaliseMetaIndicador> & Pick<AnaliseMetaIndicador, "indicador" | "rotulo">): AnaliseMetaIndicador => ({
  menorEMelhor: false, meta: null, realizado: null, projecao: null, progresso: null, faltam: null, porDiaAtual: null, porDiaNecessario: null,
  situacao: "sem-meta", referencia: null, ...over
});

function metas(over: Partial<AnaliseMetas> = {}, indicadores?: AnaliseMetaIndicador[]): AnaliseMetas {
  return {
    mes: { ano: 2026, mes: 10, inicio: "2026-10-01", fim: "2026-10-31", diasNoMes: 31, encerrado: false, futuro: false },
    cobertura: { diasComMovimento: 14, diasRestantes: 15, diasNoRitmo: 48, podeProjetar: true },
    indicadores: indicadores ?? [
      ind({ indicador: "faturamento", rotulo: "Faturamento do mês", meta: 300000, realizado: 150000, projecao: 280000, progresso: 0.5, faltam: 150000, porDiaAtual: 10000, porDiaNecessario: 10000, situacao: "abaixo", referencia: { media3: 260000, mesesNaMedia: 3, melhor: 310000 } }),
      ind({ indicador: "pessoas", rotulo: "Pessoas atendidas", meta: 2500, realizado: 1500, projecao: 2800, progresso: 0.6, faltam: 1000, porDiaAtual: 100, porDiaNecessario: 66.67, situacao: "no-ritmo" }),
      ind({ indicador: "ticketPessoa", rotulo: "Ticket por pessoa", meta: 110, realizado: 100, situacao: "abaixo", referencia: { media3: 98, mesesNaMedia: 3, melhor: 104 } }),
      ind({ indicador: "perdaPct", rotulo: "Perda sobre o faturamento", menorEMelhor: true, meta: 0.02, realizado: 0.012, situacao: "no-ritmo" })
    ],
    ...over
  };
}

const cartao = (nome: string) => screen.getByRole("heading", { name: nome }).closest("li") as HTMLElement;
const vista = (dados = metas(), extra: Partial<React.ComponentProps<typeof MetasView>> = {}) => {
  const props = {
    mes: { ano: dados.mes.ano, mes: dados.mes.mes }, dados, carregando: false, erro: null, podeEditar: true, navegacaoBloqueada: false,
    onSalvar: vi.fn().mockResolvedValue(undefined), onMesAnterior: vi.fn(), onProximoMes: vi.fn(), onTentarDeNovo: vi.fn(), ...extra
  };
  renderComSessao(<MetasView {...props} />);
  return props;
};

describe("MetasView", () => {
  test("mostra o mes, a cobertura e os quatro indicadores", () => {
    vista();
    expect(screen.getByRole("heading", { name: "outubro de 2026" })).toBeTruthy();
    expect(document.querySelector(".analise-contexto")?.textContent).toMatch(/14 dias fechados com venda e 15 dias ainda por abrir, hoje incluído\./);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Faturamento do mês", "Pessoas atendidas", "Ticket por pessoa", "Perda sobre o faturamento"
    ]);
  });

  test("o selo diz a situacao em texto (nao so em cor)", () => {
    vista();
    expect(within(cartao("Faturamento do mês")).getByText("Abaixo do ritmo")).toBeTruthy();
    expect(within(cartao("Pessoas atendidas")).getByText("No ritmo")).toBeTruthy();
    expect(within(cartao("Ticket por pessoa")).getByText("Fora do alvo")).toBeTruthy();
    expect(within(cartao("Perda sobre o faturamento")).getByText("No alvo")).toBeTruthy();
  });

  test("faturamento: realizado, meta, projecao em % da meta e o que falta por dia", () => {
    vista();
    const c = cartao("Faturamento do mês");
    expect(within(c).getByText("R$ 150.000")).toBeTruthy();
    expect(c.textContent).toMatch(/meta: R\$ 300\.000/);
    expect(c.textContent).toMatch(/Estimativa: no ritmo atual o mês fecha em R\$ 280\.000, 93% da meta\./);
    expect(c.textContent).toMatch(/Faltam R\$ 150\.000: precisa de R\$ 10\.000 por dia nos 15 dias que ainda abrem; até aqui a média é R\$ 10\.000 por dia\./);
  });

  test("a barra de quem esta abaixo do ritmo fica em perigo; a de quem esta no ritmo nao", () => {
    vista();
    expect(cartao("Faturamento do mês").querySelector(".analise-barra-perigo")).not.toBeNull();
    expect(cartao("Pessoas atendidas").querySelector(".analise-barra-perigo")).toBeNull();
    expect(cartao("Pessoas atendidas").querySelector(".analise-barra-neutro")).not.toBeNull();
  });

  test("taxa dentro da meta no mes encerrado diz 'Dentro da meta'; soma diz 'Meta batida'", () => {
    const fechado = metas({ mes: { ano: 2026, mes: 9, inicio: "2026-09-01", fim: "2026-09-30", diasNoMes: 30, encerrado: true, futuro: false } },
      [ind({ indicador: "perdaPct", rotulo: "Perda sobre o faturamento", menorEMelhor: true, meta: 0.02, realizado: 0.01, situacao: "atingida" }),
       ind({ indicador: "pessoas", rotulo: "Pessoas atendidas", meta: 1000, realizado: 1200, progresso: 1.2, faltam: 0, situacao: "atingida" })]);
    vista(fechado);
    expect(within(cartao("Perda sobre o faturamento")).getByText("Dentro da meta")).toBeTruthy();
    expect(within(cartao("Pessoas atendidas")).getByText("Meta batida")).toBeTruthy();
  });

  test("com metas definidas nao aparece o convite de 'nenhuma meta'", () => {
    vista();
    expect(screen.queryByText(/Nenhuma meta definida/)).toBeNull();
  });

  test("meta batida nao pede ritmo: so projeta quando falta", () => {
    const batida = metas({}, [ind({ indicador: "faturamento", rotulo: "Faturamento do mês", meta: 100000, realizado: 150000, projecao: 280000, progresso: 1.5, faltam: 0, situacao: "atingida" })]);
    vista(batida);
    const c = cartao("Faturamento do mês");
    expect(within(c).getByText("Meta batida")).toBeTruthy();
    expect(c.textContent).not.toMatch(/Faltam/);
  });

  test("pessoas usa a unidade 'pessoas' e perda e em porcentagem (menor e melhor)", () => {
    vista();
    expect(cartao("Pessoas atendidas").textContent).toMatch(/1\.500 pessoas.*meta: 2\.500 pessoas/);
    const perda = cartao("Perda sobre o faturamento").textContent ?? "";
    expect(perda).toMatch(/1,2%.*meta: até 2,0%/);
    expect(perda).toMatch(/a meta é ficar em até 2,0%/);
  });

  test("ticket: meta de chegar ao valor", () => {
    expect(cartao_ticket()).toMatch(/O mês está em R\$ 100; a meta é chegar a R\$ 110\./);
  });

  test("mes encerrado: diz em quanto fechou e nao fala de dias restantes", () => {
    const fechado = metas({ mes: { ano: 2026, mes: 9, inicio: "2026-09-01", fim: "2026-09-30", diasNoMes: 30, encerrado: true, futuro: false }, cobertura: { diasComMovimento: 26, diasRestantes: 0, diasNoRitmo: 48, podeProjetar: true } },
      [ind({ indicador: "faturamento", rotulo: "Faturamento do mês", meta: 300000, realizado: 270000, projecao: 270000, progresso: 0.9, faltam: 30000, situacao: "abaixo" })]);
    vista(fechado);
    const c = cartao("Faturamento do mês");
    expect(c.textContent).toMatch(/Mês encerrado em R\$ 270\.000, 90% da meta\./);
    expect(within(c).getByText("Meta não batida")).toBeTruthy(); // mês fechado não tem "ritmo" a recuperar
    expect(c.textContent).not.toMatch(/Faltam/);
    expect(screen.queryByText(/ainda por abrir/)).toBeNull();
  });

  test("mes futuro avisa que ainda nao comecou", () => {
    const futuro = metas({ mes: { ano: 2026, mes: 12, inicio: "2026-12-01", fim: "2026-12-31", diasNoMes: 31, encerrado: false, futuro: true } },
      [ind({ indicador: "faturamento", rotulo: "Faturamento do mês", meta: 300000, realizado: 0, situacao: "sem-dado" })]);
    vista(futuro);
    expect(screen.getByText(/Mês ainda por vir/)).toBeTruthy();
  });

  test("sem projecao possivel: diz que falta historico, sem inventar numero", () => {
    const sem = metas({}, [ind({ indicador: "faturamento", rotulo: "Faturamento do mês", meta: 300000, realizado: 5000, projecao: null, progresso: 0.017, faltam: 295000, situacao: "sem-dado" })]);
    vista(sem);
    expect(cartao("Faturamento do mês").textContent).toMatch(/Ainda sem histórico suficiente para projetar/);
  });

  test("sem nenhuma meta: convite para definir, com a sugestao de partida", () => {
    vista(metas({}, metas().indicadores.map((i) => ({ ...i, meta: null, situacao: "sem-meta" as const, faltam: null, progresso: null, porDiaNecessario: null }))));
    expect(screen.getByText(/Nenhuma meta definida para outubro de 2026/)).toBeTruthy();
    expect(screen.getAllByText("Sem meta").length).toBe(4);
    expect(screen.getAllByRole("button", { name: "Definir meta" }).length).toBe(4);
  });

  test("referencia mostra media dos ultimos meses e melhor mes", () => {
    vista();
    expect(cartao("Faturamento do mês").textContent).toMatch(/média dos últimos 3 meses R\$ 260\.000 · melhor mês R\$ 310\.000/);
  });

  test("navegacao de mes chama os dois lados", () => {
    const p = vista();
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(p.onMesAnterior).toHaveBeenCalledTimes(1);
    expect(p.onProximoMes).toHaveBeenCalledTimes(1);
  });

  test("ocultar valores mascara os reais e deixa pessoas e porcentagem", () => {
    renderComSessao(
      <MetasView mes={{ ano: 2026, mes: 10 }} dados={metas()} carregando={false} erro={null} podeEditar={false} navegacaoBloqueada={false}
        onSalvar={vi.fn()} onMesAnterior={vi.fn()} onProximoMes={vi.fn()} onTentarDeNovo={vi.fn()} />, { ocultar: true });
    const fat = cartao("Faturamento do mês").textContent ?? "";
    expect(fat).toContain("R$ ••••");
    expect(fat).not.toMatch(/150\.000/);
    expect(cartao("Pessoas atendidas").textContent).toMatch(/1\.500 pessoas/);
  });
});

function cartao_ticket() {
  vista();
  return cartao("Ticket por pessoa").textContent ?? "";
}

describe("edicao de metas", () => {
  test("sem permissao de editar: nenhum botao e nenhum texto mandando definir", () => {
    vista(metas({}, metas().indicadores.map((i) => ({ ...i, meta: null, situacao: "sem-meta" as const }))), { podeEditar: false });
    expect(screen.queryByRole("button", { name: /Definir meta|Editar meta/ })).toBeNull();
    expect(screen.queryByText(/Defina uma meta/)).toBeNull();
    expect(screen.getAllByText("Nenhuma meta definida para este mês.").length).toBe(4);
    expect(screen.getByText(/^Nenhuma meta definida para outubro de 2026\.$/)).toBeTruthy();
  });

  test("ao abrir o editor o foco vai para o campo; ao cancelar volta para o botao que o abriu", async () => {
    vista();
    const abrir = within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" });
    fireEvent.click(abrir);
    expect(document.activeElement).toBe(screen.getByLabelText(/^Meta de faturamento do mês/));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" })));
  });

  test("o erro e anunciado (role alert) e o campo fica marcado como invalido", () => {
    vista();
    fireEvent.click(within(cartao("Pessoas atendidas")).getByRole("button", { name: "Editar meta" }));
    fireEvent.change(screen.getByLabelText(/^Meta de pessoas atendidas/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Digite um valor maior que zero/);
    expect(screen.getByLabelText(/^Meta de pessoas atendidas/).getAttribute("aria-invalid")).toBe("true");
  });

  test("pessoas exige inteiro; valores acima do teto do servidor sao recusados no cliente", () => {
    const p = vista();
    fireEvent.click(within(cartao("Pessoas atendidas")).getByRole("button", { name: "Editar meta" }));
    const campo = screen.getByLabelText(/^Meta de pessoas atendidas/);
    fireEvent.change(campo, { target: { value: "2500,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    expect(screen.getByRole("alert").textContent).toMatch(/número inteiro/);
    fireEvent.change(campo, { target: { value: "2.000.000" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    expect(screen.getByRole("alert").textContent).toMatch(/acima do limite de 1 milhão de pessoas/);
    expect(p.onSalvar).not.toHaveBeenCalled();
  });

  test("durante a gravacao o campo fica so leitura (sem disabled, que derruba o foco) e o clique repetido e ignorado", async () => {
    let concluir: () => void = () => undefined;
    const onSalvar = vi.fn().mockReturnValue(new Promise<void>((resolve) => { concluir = resolve; }));
    vista(metas(), { onSalvar });
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    const campo = screen.getByLabelText(/^Meta de faturamento do mês/) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvando…" }));
    expect(campo.readOnly).toBe(true);
    expect(campo.disabled).toBe(false);
    expect(onSalvar).toHaveBeenCalledTimes(1);
    concluir();
    await waitFor(() => expect(screen.queryByLabelText(/^Meta de faturamento do mês/)).toBeNull());
  });

  test("com valores ocultos o campo nao mostra o numero (tipo password)", () => {
    renderComSessao(
      <MetasView mes={{ ano: 2026, mes: 10 }} dados={metas()} carregando={false} erro={null} podeEditar navegacaoBloqueada={false}
        onSalvar={vi.fn()} onMesAnterior={vi.fn()} onProximoMes={vi.fn()} onTentarDeNovo={vi.fn()} />, { ocultar: true });
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    const campo = screen.getByLabelText(/^Meta de faturamento do mês/) as HTMLInputElement;
    expect(campo.type).toBe("password");
    expect(campo.value).toBe("");
  });

  test("digitar em reais com ponto de milhar grava o numero e fecha o editor", async () => {
    const p = vista();
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    const campo = screen.getByLabelText(/^Meta de faturamento do mês/) as HTMLInputElement;
    expect(campo.value).toBe("300000");
    fireEvent.change(campo, { target: { value: "320.000" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    await waitFor(() => expect(p.onSalvar).toHaveBeenCalledWith("faturamento", 320000));
    await waitFor(() => expect(screen.queryByLabelText(/^Meta de faturamento do mês/)).toBeNull());
  });

  test("perda e digitada em % e gravada como fracao", async () => {
    const p = vista();
    fireEvent.click(within(cartao("Perda sobre o faturamento")).getByRole("button", { name: "Editar meta" }));
    const campo = screen.getByLabelText(/^Meta de perda sobre o faturamento/) as HTMLInputElement;
    expect(campo.value).toBe("2");
    fireEvent.change(campo, { target: { value: "1,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    await waitFor(() => expect(p.onSalvar).toHaveBeenCalledWith("perdaPct", 0.015));
  });

  test.each([["texto", "abc"], ["vazio", ""], ["zero", "0"]])("valor invalido (%s) mostra erro e nao grava", (_n, digitado) => {
    const p = vista();
    fireEvent.click(within(cartao("Pessoas atendidas")).getByRole("button", { name: "Editar meta" }));
    fireEvent.change(screen.getByLabelText(/^Meta de pessoas atendidas/), { target: { value: digitado } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Digite um valor maior que zero/);
    expect(p.onSalvar).not.toHaveBeenCalled();
  });

  test("perda acima de 100% e recusada", () => {
    const p = vista();
    fireEvent.click(within(cartao("Perda sobre o faturamento")).getByRole("button", { name: "Editar meta" }));
    fireEvent.change(screen.getByLabelText(/^Meta de perda sobre o faturamento/), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    expect(screen.getByRole("alert").textContent).toMatch(/acima do limite de 100%/);
    expect(p.onSalvar).not.toHaveBeenCalled();
  });

  test("sugestoes preenchem o campo com a media e com o melhor mes", () => {
    vista();
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    const campo = screen.getByLabelText(/^Meta de faturamento do mês/) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: /média dos últimos 3 meses/ }));
    expect(campo.value).toBe("260000");
    fireEvent.click(screen.getByRole("button", { name: /melhor mês/ }));
    expect(campo.value).toBe("310000");
  });

  test("remover meta grava null; sem meta o botao nem aparece", async () => {
    const p = vista();
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover meta" }));
    await waitFor(() => expect(p.onSalvar).toHaveBeenCalledWith("faturamento", null));
    const semMeta = metas({}, metas().indicadores.map((i) => ({ ...i, meta: null, situacao: "sem-meta" as const })));
    vista(semMeta);
    fireEvent.click(screen.getAllByRole("button", { name: "Definir meta" })[0]);
    expect(screen.queryByRole("button", { name: "Remover meta" })).toBeNull();
  });

  test("erro do servidor aparece no editor e o editor continua aberto", async () => {
    const p = vista(metas(), { onSalvar: vi.fn().mockRejectedValue(new Error("Usuário sem permissão para editar as metas do salão.")) });
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    expect(await screen.findByText("Usuário sem permissão para editar as metas do salão.")).toBeTruthy();
    expect(p.onSalvar).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Meta de faturamento do mês/)).toBeTruthy();
  });

  test("cancelar fecha sem gravar", () => {
    const p = vista();
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText(/^Meta de faturamento do mês/)).toBeNull();
    expect(p.onSalvar).not.toHaveBeenCalled();
  });
});

describe("leitura de numeros e nomes de mes", () => {
  test.each([
    ["300000", 300000], ["300.000", 300000], ["1.234.567", 1234567], ["300.000,50", 300000.5], ["98,5", 98.5], ["R$ 98,50", 98.5], ["2%", 2], ["98.5", 98.5], ["1.234,5", 1234.5]
  ])("lerNumeroBr(%s) = %s", (texto, esperado) => expect(lerNumeroBr(texto)).toBe(esperado));

  test.each(["", "abc", "1,2,3", "-5", "1e5", "12a", "1,234.56", "12.34,5"])("lerNumeroBr(%j) nao e numero", (texto) => expect(lerNumeroBr(texto)).toBeNull());

  test("nome do mes", () => {
    expect(nomeDoMes(1, 2026)).toBe("janeiro de 2026");
    expect(nomeDoMes(12, 2027)).toBe("dezembro de 2027");
    expect(Array.from({ length: 12 }, (_, i) => nomeDoMes(i + 1, 2026).split(" ")[0])).toEqual([
      "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ]);
  });
});

describe("MetasPanel (busca, mes e gravacao)", () => {
  const sessaoCom = (role: string, modulePermissions?: Record<string, unknown>) =>
    ({ user: { id: "u", role, modulePermissions }, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true }) as unknown as SessionContextValue;
  const abrir = (sessao: SessionContextValue) =>
    render(<SessionContext.Provider value={sessao}><HideValuesProvider><MetasPanel /></HideValuesProvider></SessionContext.Provider>);

  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T15:00:00"));
    api.getAnaliseMetas.mockReset().mockResolvedValue(metas());
    api.salvarAnaliseMeta.mockReset().mockResolvedValue(metas());
  });

  test("abre no mes corrente e busca as metas dele", async () => {
    abrir(sessaoCom("ADMIN"));
    expect(await screen.findByRole("heading", { name: "outubro de 2026" })).toBeTruthy();
    expect(api.getAnaliseMetas).toHaveBeenCalledWith(2026, 10, expect.any(AbortSignal));
  });

  test("navegar para o mes anterior busca o mes anterior, inclusive na virada do ano", async () => {
    vi.setSystemTime(new Date("2026-01-10T12:00:00"));
    api.getAnaliseMetas.mockImplementation(async (ano: number, mes: number) => metas({ mes: { ...metas().mes, ano, mes } }));
    abrir(sessaoCom("ADMIN"));
    await screen.findByRole("heading", { name: "janeiro de 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(await screen.findByRole("heading", { name: "dezembro de 2025" })).toBeTruthy();
    expect(api.getAnaliseMetas).toHaveBeenLastCalledWith(2025, 12, expect.any(AbortSignal));
  });

  test("grava pelo mes na tela e troca os dados pela resposta", async () => {
    api.salvarAnaliseMeta.mockResolvedValue(metas({}, [ind({ indicador: "faturamento", rotulo: "Faturamento do mês", meta: 320000, realizado: 150000, situacao: "abaixo", progresso: 0.47, faltam: 170000, projecao: 280000 })]));
    abrir(sessaoCom("ADMIN"));
    await screen.findByRole("heading", { name: "outubro de 2026" });
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    fireEvent.change(screen.getByLabelText(/^Meta de faturamento do mês/), { target: { value: "320000" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    await waitFor(() => expect(api.salvarAnaliseMeta).toHaveBeenCalledWith({ ano: 2026, mes: 10, indicador: "faturamento", valor: 320000 }));
    expect(await screen.findByText(/meta: R\$ 320\.000/)).toBeTruthy();
  });

  test("durante a gravacao a navegacao de mes fica travada: a resposta cai no mes certo", async () => {
    let responder: (m: AnaliseMetas) => void = () => undefined;
    api.salvarAnaliseMeta.mockReturnValue(new Promise<AnaliseMetas>((resolve) => { responder = resolve; }));
    abrir(sessaoCom("ADMIN"));
    await screen.findByRole("heading", { name: "outubro de 2026" });
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    expect((screen.getByRole("button", { name: "Mês anterior" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Próximo mês" }) as HTMLButtonElement).disabled).toBe(true);
    responder(metas());
    await waitFor(() => expect((screen.getByRole("button", { name: "Mês anterior" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("heading", { name: "outubro de 2026" })).toBeTruthy();
  });

  test("ao trocar de mes a navegacao continua na tela e o titulo ja mostra o mes novo enquanto carrega", async () => {
    abrir(sessaoCom("ADMIN"));
    await screen.findByRole("heading", { name: "outubro de 2026" });
    api.getAnaliseMetas.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(screen.getByRole("heading", { name: "setembro de 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mês anterior" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Carregando…");
  });

  test("falha ao gravar mostra o erro no editor, que continua aberto", async () => {
    api.salvarAnaliseMeta.mockRejectedValue(new Error("Usuário sem permissão para editar as metas do salão."));
    abrir(sessaoCom("ADMIN"));
    await screen.findByRole("heading", { name: "outubro de 2026" });
    fireEvent.click(within(cartao("Faturamento do mês")).getByRole("button", { name: "Editar meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar meta" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/sem permissão para editar/);
    expect((screen.getByRole("button", { name: "Mês anterior" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("quem so ve (sem editar) nao recebe botoes de meta", async () => {
    abrir(sessaoCom("GESTAO", { "analise-salao": { view: true, create: false, edit: false, delete: false, admin: false } }));
    await screen.findByRole("heading", { name: "outubro de 2026" });
    expect(screen.queryByRole("button", { name: /Editar meta|Definir meta/ })).toBeNull();
  });

  test("erro ao carregar mostra aviso e tentar de novo busca outra vez", async () => {
    api.getAnaliseMetas.mockRejectedValueOnce(new Error("Falha de rede")).mockResolvedValue(metas());
    abrir(sessaoCom("ADMIN"));
    expect(await screen.findByText(/Falha de rede/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("heading", { name: "outubro de 2026" })).toBeTruthy();
    expect(api.getAnaliseMetas).toHaveBeenCalledTimes(2);
  });
});
