import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Verbas opcionais da rescisão de sem registro (decisão do Eli, 01/10/2026): férias + 1/3,
// 13º, aviso prévio e valor livre aparecem DESMARCADAS; marcar soma no bruto e no líquido
// na hora; o valor livre exige descrição. O servidor recalcula (a tela só manda a escolha).
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTerminationInfo: vi.fn(),
  releaseTermination: vi.fn(),
  adjustTermination: vi.fn(),
}));

import {
  type ApuracaoRescisao, type DetalheRescisao, type TerminationInfo, type VerbasOpcionaisApuracao,
  adjustTermination, getTerminationInfo, releaseTermination,
} from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { PassoApuracao } from "../../../pages/rh/rescisoes/PassoApuracao";
import { RescisaoFormulario } from "../RescisaoFormulario";
import {
  ESTADO_VERBAS_VAZIO, erroValorLivre, escolhaParaEnviar, estadoDasLancadas, totalVerbasEscolhidas,
} from "../verbasOpcionais";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>);
const texto = (t: string | null | undefined) => (t ?? "").replace(/\s/g, " ");
const liquidoNaTela = () => (document.querySelector(".resc-rodape-valor strong")?.textContent ?? "").replace(/\s/g, "");

const VERBAS: VerbasOpcionaisApuracao = {
  observacao: null,
  calculo: {
    base: 2200, inicio: "2026-03-10",
    ferias: { avos: 7, inicioAquisitivo: "2026-03-10", ferias: 1283.33, terco: 427.78, valor: 1711.11, memoria: "S 2.200,00 ÷ 12 × 7 avos = 1.283,33 + 1/3 (427,78)" },
    decimoTerceiro: { avos: 7, desde: "2026-03-10", valor: 1283.33, memoria: "S 2.200,00 ÷ 12 × 7 avos" },
    aviso: { dias: 30, anos: 0, valor: 2200, memoria: "S 2.200,00 ÷ 30 × 30 dias" },
    avisoFeriasVencidas: null,
  },
};

function apuracao(verbas: VerbasOpcionaisApuracao | null = VERBAS): ApuracaoRescisao {
  return {
    saida: "2026-09-24", semRegistro: true,
    vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
    gorjeta: { periodo: "x", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 24, salarioProporcional: 1760 },
    gorjetaObservacao: null,
    sugestao: { salario: 1760, gorjeta: 186.8, creditos: 0, vales: 0, valesRotulo: null, vtDesconto: 0, bruto: 1946.8 },
    verbasOpcionais: verbas,
  } as ApuracaoRescisao;
}
const info = (over: Partial<TerminationInfo> = {}): TerminationInfo => ({
  employee: { id: "e1", name: "Ana Silva", terminationDate: "2026-09-24", terminationReason: null },
  vtItems: [], alreadyReleased: false, rescisaoId: null, apuracao: apuracao(), lancada: null, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("funções puras das verbas opcionais", () => {
  const numero = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  test("nada marcado: total zero", () => {
    expect(totalVerbasEscolhidas(VERBAS.calculo, ESTADO_VERBAS_VAZIO, numero)).toEqual({ total: 0, oculto: false });
  });
  test("soma só o marcado; valor livre pelo digitado", () => {
    const e = { ...ESTADO_VERBAS_VAZIO, ferias: true, aviso: true, livre: true, livreValor: "100,50", livreDescricao: "Acordo" };
    expect(totalVerbasEscolhidas(VERBAS.calculo, e, numero)).toEqual({ total: 4011.61, oculto: false });
  });
  test("valor oculto (sem ver Funcionários): não soma e avisa", () => {
    const oculto = { ...VERBAS.calculo!, aviso: { ...VERBAS.calculo!.aviso, valor: null } };
    expect(totalVerbasEscolhidas(oculto, { ...ESTADO_VERBAS_VAZIO, aviso: true }, numero)).toEqual({ total: 0, oculto: true });
  });
  test("valor livre exige valor > 0 e descrição de 3 letras", () => {
    expect(erroValorLivre({ ...ESTADO_VERBAS_VAZIO }, numero)).toBeNull();
    expect(erroValorLivre({ ...ESTADO_VERBAS_VAZIO, livre: true, livreValor: "", livreDescricao: "Acordo" }, numero)).toMatch(/valor/);
    expect(erroValorLivre({ ...ESTADO_VERBAS_VAZIO, livre: true, livreValor: "10,00", livreDescricao: "ab" }, numero)).toMatch(/descrição/);
    expect(erroValorLivre({ ...ESTADO_VERBAS_VAZIO, livre: true, livreValor: "10,00", livreDescricao: "Acordo" }, numero)).toBeNull();
  });
  test("escolha enviada e a volta a partir do lançado", () => {
    const e = { ...ESTADO_VERBAS_VAZIO, decimoTerceiro: true, livre: true, livreValor: "300,00", livreDescricao: " Gratificação " };
    expect(escolhaParaEnviar(e, numero)).toEqual({ ferias: false, decimoTerceiro: true, aviso: false, livre: { valor: 300, descricao: "Gratificação" } });
    const volta = estadoDasLancadas({
      itens: [{ tipo: "DECIMO_TERCEIRO", rotulo: "13º proporcional", valor: 1283.33, memoria: "x" }, { tipo: "LIVRE", rotulo: "Gratificação", valor: 300, memoria: null, descricao: "Gratificação" }],
      total: 1583.33, por: null,
    });
    expect(volta).toMatchObject({ ferias: false, decimoTerceiro: true, aviso: false, livre: true, livreDescricao: "Gratificação" });
    expect(volta.livreValor).toMatch(/300,00/);
  });
});

describe("RescisaoFormulario — verbas opcionais", () => {
  test("abre com as 4 caixas desmarcadas e o líquido sem as verbas", async () => {
    vi.mocked(getTerminationInfo).mockResolvedValue(info());
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={vi.fn()} mostrarApuracao={false} />);
    const secao = await screen.findByRole("group", { name: /Verbas opcionais \(decisão da empresa\)/ });
    const caixas = within(secao).getAllByRole("checkbox");
    expect(caixas).toHaveLength(4);
    caixas.forEach((c) => expect(c).not.toBeChecked());
    expect(texto(within(secao).getByText(/S 2\.200,00 ÷ 12 × 7 avos =/).textContent)).toContain("1/3");
    expect(liquidoNaTela()).toBe("R$1.946,80");
  });

  test("marcar soma no líquido na hora; desmarcar tira", async () => {
    vi.mocked(getTerminationInfo).mockResolvedValue(info());
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={vi.fn()} mostrarApuracao={false} />);
    const ferias = await screen.findByRole("checkbox", { name: /Férias proporcionais \+ 1\/3/ });
    fireEvent.click(ferias);
    expect(liquidoNaTela()).toBe("R$3.657,91");
    fireEvent.click(screen.getByRole("checkbox", { name: /Aviso prévio indenizado/ }));
    expect(liquidoNaTela()).toBe("R$5.857,91");
    fireEvent.click(ferias);
    expect(liquidoNaTela()).toBe("R$4.146,80");
  });

  test("valor livre exige descrição: não lança e explica", async () => {
    vi.mocked(getTerminationInfo).mockResolvedValue(info());
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={vi.fn()} mostrarApuracao={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Valor livre/ }));
    fireEvent.change(screen.getByLabelText("Valor livre (R$)"), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: "Liberar para Contas a Pagar" }));
    expect(await screen.findByText(/Descreva o valor livre/)).toBeInTheDocument();
    expect(releaseTermination).not.toHaveBeenCalled();
  });

  test("lança mandando só a escolha (o servidor recalcula)", async () => {
    vi.mocked(getTerminationInfo).mockResolvedValue(info());
    vi.mocked(releaseTermination).mockResolvedValue({ id: "r1", amount: 3230.13, installments: 1, items: [] });
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={vi.fn()} mostrarApuracao={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /13º proporcional/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Valor livre/ }));
    fireEvent.change(screen.getByLabelText("Valor livre (R$)"), { target: { value: "15000" } });
    fireEvent.change(screen.getByLabelText("Descrição do valor livre"), { target: { value: "Gratificação" } });
    fireEvent.click(screen.getByRole("button", { name: "Liberar para Contas a Pagar" }));
    await waitFor(() => expect(releaseTermination).toHaveBeenCalled());
    const corpo = vi.mocked(releaseTermination).mock.calls[0][1];
    expect(corpo.verbasOpcionais).toEqual({ ferias: false, decimoTerceiro: true, aviso: false, livre: { valor: 150, descricao: "Gratificação" } });
    expect(corpo.grossAmount).toBe(3380.13);
    // Verbas não pedem justificativa.
    expect(corpo.ajusteJustificativa).toBeUndefined();
  });

  test("CLT: a seção não aparece", async () => {
    vi.mocked(getTerminationInfo).mockResolvedValue(info({ apuracao: { ...apuracao(null), semRegistro: false } }));
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: false }} onGravou={vi.fn()} mostrarApuracao={false} />);
    await screen.findByRole("button", { name: /Lançar como quitada|Liberar para Contas a Pagar/ });
    expect(screen.queryByRole("group", { name: /Verbas opcionais/ })).toBeNull();
  });

  test("ajuste: abre com as verbas lançadas marcadas e manda a escolha", async () => {
    const lancada = {
      bruto: 4146.8, salario: 1760, gorjeta: 186.8, vales: 0, vtDesconto: 0, outroDesconto: 0, liquido: 4146.8,
      outroDescontoRotulo: null, valesRotulo: null, parcelas: [{ id: "r1", rotulo: "Rescisão", valor: 4146.8, vencimento: "2026-09-30", paga: false }],
      algumaPaga: false, notes: null, ajusteManual: null, historicoAjustes: [],
      verbasOpcionais: { itens: [{ tipo: "AVISO" as const, rotulo: "Aviso prévio indenizado", valor: 2200, memoria: "S 2.200,00 ÷ 30 × 30 dias", dias: 30 }], total: 2200, por: { userId: "u1", nome: "Eli", em: "2026-09-30T10:00:00Z" } },
    };
    vi.mocked(getTerminationInfo).mockResolvedValue(info({ alreadyReleased: true, lancada }));
    vi.mocked(adjustTermination).mockResolvedValue({ ok: true, lancada: { ...lancada, verbasOpcionais: null, bruto: 1946.8, liquido: 1946.8 } });
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={vi.fn()} mostrarApuracao={false} />);
    expect(await screen.findByText(/marcadas por Eli/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ajustar rescisão" }));
    const aviso = screen.getByRole("checkbox", { name: /Aviso prévio indenizado/ });
    expect(aviso).toBeChecked();
    fireEvent.click(aviso);
    fireEvent.change(screen.getByPlaceholderText(/gorjeta de 26 a 31\/08/), { target: { value: "Aviso não será pago afinal" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ajuste" }));
    await waitFor(() => expect(adjustTermination).toHaveBeenCalled());
    expect(vi.mocked(adjustTermination).mock.calls[0][1].verbasOpcionais).toEqual({ ferias: false, decimoTerceiro: false, aviso: false, livre: null });
  });
});

describe("PassoApuracao — verbas opcionais só para leitura", () => {
  const detalhe = {
    pessoa: { employeeId: "e1", nome: "Ana Silva", apelido: null, empresa: null, semRegistro: true, saida: "2026-09-24", motivo: null, rescisao: null, termo: null },
    itensAposSaida: [], periodoGorjeta: null, extratoDoMes: null,
  } as unknown as DetalheRescisao;

  test("mostra o cálculo com as caixas desmarcadas e travadas", () => {
    render(<PassoApuracao detalhe={detalhe} info={info()} carregando={false} onMudou={vi.fn()} onLancarNormal={vi.fn()} />);
    const secao = screen.getByRole("group", { name: /Verbas opcionais \(decisão da empresa\)/ });
    const caixas = within(secao).getAllByRole("checkbox");
    expect(caixas).toHaveLength(4);
    caixas.forEach((c) => { expect(c).not.toBeChecked(); expect(c).toBeDisabled(); });
    expect(within(secao).getByText(/sem projeção/i)).toBeInTheDocument();
  });

  test("aviso de férias vencidas e observação sem cálculo", () => {
    const vencidas = { ...VERBAS, calculo: { ...VERBAS.calculo!, avisoFeriasVencidas: "Há período de férias completo sem registro de férias: não calculado automaticamente; se for o caso, use o valor livre" } };
    const { unmount } = render(<PassoApuracao detalhe={detalhe} info={info({ apuracao: apuracao(vencidas) })} carregando={false} onMudou={vi.fn()} onLancarNormal={vi.fn()} />);
    expect(screen.getByText(/Há período de férias completo sem registro/)).toBeInTheDocument();
    unmount();
    render(<PassoApuracao detalhe={detalhe} info={info({ apuracao: apuracao({ calculo: null, observacao: "Sem salário base vigente na saída no cadastro." }) })} carregando={false} onMudou={vi.fn()} onLancarNormal={vi.fn()} />);
    expect(screen.getByText(/Sem salário base vigente/)).toBeInTheDocument();
  });
});

describe("RescisaoFormulario — sem permissão de ver Funcionários (valores ocultos)", () => {
  const OCULTAS: VerbasOpcionaisApuracao = {
    observacao: null,
    calculo: {
      ...VERBAS.calculo!,
      ferias: { ...VERBAS.calculo!.ferias, valor: null },
      decimoTerceiro: { ...VERBAS.calculo!.decimoTerceiro, valor: null },
      aviso: { ...VERBAS.calculo!.aviso, valor: null },
    },
  } as unknown as VerbasOpcionaisApuracao;

  test("férias, 13º e aviso travados com explicação; só o valor livre habilitado", async () => {
    vi.mocked(getTerminationInfo).mockResolvedValue(info({ apuracao: apuracao(OCULTAS) }));
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={vi.fn()} mostrarApuracao={false} />);
    const secao = await screen.findByRole("group", { name: /Verbas opcionais/ });
    expect(within(secao).getByRole("checkbox", { name: /Férias proporcionais/ })).toBeDisabled();
    expect(within(secao).getByRole("checkbox", { name: /13º proporcional/ })).toBeDisabled();
    expect(within(secao).getByRole("checkbox", { name: /Aviso prévio/ })).toBeDisabled();
    expect(within(secao).getByRole("checkbox", { name: /Valor livre/ })).toBeEnabled();
    expect(within(secao).getByText(/Sem permissão de ver Funcionários/)).toBeInTheDocument();
  });

  test("ajuste com verba lançada de valor oculto: líquido 'calculado ao lançar', sem decidir quitação", async () => {
    const lancada = {
      bruto: 4146.8, salario: 1760, gorjeta: 186.8, vales: 0, vtDesconto: 0, outroDesconto: 0, liquido: 4146.8,
      outroDescontoRotulo: null, valesRotulo: null, parcelas: [{ id: "r1", rotulo: "Rescisão", valor: 4146.8, vencimento: "2026-09-30", paga: false }],
      algumaPaga: false, notes: null, ajusteManual: null, historicoAjustes: [],
      verbasOpcionais: { itens: [{ tipo: "AVISO" as const, rotulo: "Aviso prévio indenizado", valor: null, memoria: null, dias: 30 }], total: null, por: { userId: "u1", nome: "Eli", em: "2026-09-30T10:00:00Z" } },
    };
    vi.mocked(getTerminationInfo).mockResolvedValue(info({ alreadyReleased: true, lancada, apuracao: apuracao(OCULTAS) }));
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={vi.fn()} mostrarApuracao={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar rescisão" }));
    // Desconto maior que o visível: sem a verba oculta, o cliente acharia "zero ou negativo".
    fireEvent.change(screen.getByLabelText("Outro desconto (opcional)"), { target: { value: "300000" } });
    expect(texto(document.querySelector(".resc-rodape-valor strong")?.textContent)).toBe("calculado ao lançar");
    expect(screen.queryByText(/líquido fica zero ou negativo/)).toBeNull();
    // A já marcada pode ser desmarcada.
    const aviso = screen.getByRole("checkbox", { name: /Aviso prévio indenizado/ });
    expect(aviso).toBeChecked();
    expect(aviso).toBeEnabled();
  });
});
