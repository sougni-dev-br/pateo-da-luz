import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// A tela de inventario dizia "238 divergentes" e nao mostrava quais nem por que.
// O painel de conferencia mostra cada item contra a contagem anterior + compras.
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getConferenciaDoInventario: vi.fn(),
  marcarItemConferido: vi.fn(),
  pedirRecontagem: vi.fn(),
  aplicarRecontagem: vi.fn()
}));

import {
  type ConferenciaDoInventario, type ItemDaConferencia,
  aplicarRecontagem, getConferenciaDoInventario, marcarItemConferido, pedirRecontagem
} from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { ConferenciaInventario } from "../ConferenciaInventario";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

function item(parcial: Partial<ItemDaConferencia>): ItemDaConferencia {
  return {
    itemId: "i", productId: "p", productCode: "100", productName: "PRODUTO", sectorName: "ESTOQUE", unit: "UN",
    contado: 1, contadoPor: null, contadoEm: null, anterior: 1, anteriorData: "2026-06-29T00:00:00.000Z", anteriorCodigo: "INV-2026-0020",
    compras: 0, disponivel: 1, consumo: 0, custoUnitario: 1, impacto: 0, classe: "COERENTE", motivo: "Consumo de 0 UN no período.", conferido: null, recontagemId: null,
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
  return { inventoryId: "inv", code: "INV-2026-0021", resumo, itens, limiteDeConferencia: 50, pendentesParaAprovar: 0, recontagens: [] };
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

  test("corrige a quantidade no proprio cartao, sem trocar de aba", async () => {
    const onCorrigir = vi.fn().mockResolvedValue(true);
    vi.mocked(marcarItemConferido).mockResolvedValue({ ok: true });
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={onCorrigir} />);

    const campo = await screen.findByLabelText(/quantidade certa de mexedor/i);
    fireEvent.change(campo, { target: { value: "0,84" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(onCorrigir).toHaveBeenCalledWith(expect.objectContaining({ itemId: "mexedor" }), "0,84"));
    await waitFor(() => expect(marcarItemConferido).toHaveBeenCalledWith("inv", "mexedor", "CORRIGIDO"));
  });

  test("corrigido que nao conseguiu marcar avisa", async () => {
    vi.mocked(marcarItemConferido).mockRejectedValue(new Error("falhou"));
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={vi.fn().mockResolvedValue(true)} />);

    fireEvent.change(await screen.findByLabelText(/quantidade certa de mexedor/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/salva, mas não foi possível marcar/i)).toBeInTheDocument();
  });

  test("o campo acompanha o valor salvo e compara numero, nao texto", async () => {
    const um = item({ itemId: "x", productName: "BATATA", unit: "KG", contado: 12.5, classe: "FORA_DO_HISTORICO", impacto: 100 });
    vi.mocked(getConferenciaDoInventario).mockResolvedValueOnce(conferencia([um]));
    const { rerender } = render(<ConferenciaInventario inventoryId="inv" versao={1} onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={vi.fn()} />);

    const campo = await screen.findByLabelText(/quantidade certa de batata/i);
    fireEvent.change(campo, { target: { value: "12,50" } });
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();

    fireEvent.change(campo, { target: { value: "12,5" } });
    vi.mocked(getConferenciaDoInventario).mockResolvedValueOnce(conferencia([{ ...um, contado: 14 }]));
    rerender(<SessionContext.Provider value={SESSAO}><HideValuesProvider><ConferenciaInventario inventoryId="inv" versao={2} onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={vi.fn()} /></HideValuesProvider></SessionContext.Provider>);
    await waitFor(() => expect(screen.getByLabelText(/quantidade certa de batata/i)).toHaveValue("14"));
  });

  test("sem permissao de corrigir, o cartao nao mostra o campo", async () => {
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} />);
    await screen.findByText("MEXEDOR CAFÉ GOLDEN C/ 500");
    expect(screen.queryByLabelText(/quantidade certa/i)).not.toBeInTheDocument();
  });

  test("sugestao de embalagem preenche o campo com um clique", async () => {
    const palito = item({
      itemId: "palito", productName: "SACHE DE PALITO C/ 2000", unit: "UN", anterior: 1.4, compras: 0, disponivel: 1.4,
      contado: 1100, classe: "IMPOSSIVEL", impacto: 100, sugestao: { quantidade: 0.55, embalagem: 2000 }
    });
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([palito]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /usar 0,55 un/i }));
    expect(screen.getByLabelText(/quantidade certa de sache/i)).toHaveValue("0,55");
  });

  test("zerado mostra o produto parecido que foi contado", async () => {
    const coca2lz = item({ itemId: "z", productName: "COCA COLA 2 L ZERO", contado: 0, classe: "ZERADO_SUSPEITO", impacto: 30 });
    const coca2l = item({ itemId: "c", productName: "COCA COLA 2 L", contado: 1, classe: "COERENTE" });
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([coca2lz, coca2l]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} />);

    expect(await screen.findByText(/contado em produto parecido/i)).toBeInTheDocument();
    expect(screen.getByText(/COCA COLA 2 L — 1 UN/)).toBeInTheDocument();
  });

  test("recorte por setor muda os totais das classes", async () => {
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([
      { ...mexedor, sectorName: "CORREDORES" },
      { ...salmao, sectorName: "CAMARA FRIA" }
    ]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("Setor"), { target: { value: "CAMARA FRIA" } });
    expect(screen.getByRole("button", { name: /impossíveis/i })).toBeDisabled();
    expect(screen.getByText(/mostrando 1 de 2/i)).toBeInTheDocument();
  });

  test("marcar 'esta certo' grava o motivo e recarrega", async () => {
    vi.mocked(marcarItemConferido).mockResolvedValue({ ok: true });
    vi.mocked(getConferenciaDoInventario)
      .mockResolvedValueOnce(conferencia([mexedor]))
      .mockResolvedValueOnce(conferencia([{ ...mexedor, conferido: { motivo: "CORRETO", observacao: null, em: null, por: "Eli" } }]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={vi.fn()} />);

    const grupo = await screen.findByRole("group", { name: /conferir mexedor/i });
    fireEvent.click(within(grupo).getByRole("button", { name: "Está certo" }));
    await waitFor(() => expect(marcarItemConferido).toHaveBeenCalledWith("inv", "mexedor", "CORRETO", undefined));
    // Conferido sai de "faltam conferir": a lista fica sem pendencia.
    expect(await screen.findByText(/nada falta conferir/i)).toBeInTheDocument();
  });

  test("no rascunho corrige mas nao marca conferido", async () => {
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} podeCorrigir onCorrigir={vi.fn()} />);

    expect(await screen.findByLabelText(/quantidade certa de mexedor/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /conferir mexedor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pedir recontagem/i })).not.toBeInTheDocument();
  });

  test("progresso conta so o que exige conferencia", async () => {
    const pequeno = item({ itemId: "p", productName: "TOMATE", classe: "ZERADO_SUSPEITO", impacto: 10 });
    const conferidoOk = { ...salmao, conferido: { motivo: "CORRETO" as const, observacao: null, em: null, por: null } };
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor, conferidoOk, pequeno]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={vi.fn()} />);

    expect(await screen.findByText("1 de 2 conferidos")).toBeInTheDocument();
  });

  test("outro exige descrever o motivo", async () => {
    vi.mocked(marcarItemConferido).mockResolvedValue({ ok: true });
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([mexedor]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Outro…" }));
    const ok = screen.getByRole("button", { name: "Ok" });
    expect(ok).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/motivo da conferência de mexedor/i), { target: { value: "vencido, descartado" } });
    fireEvent.click(ok);
    await waitFor(() => expect(marcarItemConferido).toHaveBeenCalledWith("inv", "mexedor", "OUTRO", "vencido, descartado"));
  });

  test("itens marcados para recontar viram pedido de recontagem", async () => {
    vi.mocked(pedirRecontagem).mockResolvedValue({} as never);
    const marcado = { ...mexedor, conferido: { motivo: "RECONTAR" as const, observacao: null, em: null, por: null } };
    vi.mocked(getConferenciaDoInventario).mockResolvedValue(conferencia([marcado]));
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={vi.fn()} />);

    expect(await screen.findByText(/1 item marcado para recontar/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pedir recontagem/i }));
    await waitFor(() => expect(pedirRecontagem).toHaveBeenCalledWith("inv"));
  });

  test("recontagem concluida pode ser aplicada", async () => {
    vi.mocked(aplicarRecontagem).mockResolvedValue({ aplicados: 1, alterados: 1 });
    const onRecontagemAplicada = vi.fn();
    vi.mocked(getConferenciaDoInventario).mockResolvedValue({
      ...conferencia([mexedor]),
      recontagens: [{ id: "s1", code: "CNT-2026-0200", status: "CONCLUIDA", aplicada: false, itens: 1, contados: 1, createdAt: "2026-10-08T12:00:00Z" }]
    });
    render(<ConferenciaInventario inventoryId="inv" onLocalizar={vi.fn()} podeCorrigir podeConferir onCorrigir={vi.fn()} onRecontagemAplicada={onRecontagemAplicada} />);

    fireEvent.click(await screen.findByRole("button", { name: /aplicar recontagem/i }));
    await waitFor(() => expect(aplicarRecontagem).toHaveBeenCalledWith("inv", "s1"));
    await waitFor(() => expect(onRecontagemAplicada).toHaveBeenCalled());
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
