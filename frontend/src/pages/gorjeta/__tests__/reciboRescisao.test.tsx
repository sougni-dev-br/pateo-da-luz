import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipComputation, TipReciboPrevia } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  lerReciboRescisao: vi.fn(),
}));

import { lerReciboRescisao } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { ReciboRescisao, SeloRecibo } from "../ReciboRescisao";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);
const limpo = (t: string | null) => (t ?? "").replace(/\s/g, "");

const previa = (over: Partial<TipReciboPrevia> = {}): TipReciboPrevia => ({
  employeeId: "emp-1", nome: "Pessoa Ficticia", arquivo: "termo-ficticio.pdf", hash: "abc123", gorjeta: 450.75, liquido: 3200,
  admissao: "2025-02-10T00:00:00.000Z", afastamento: "2026-09-12T00:00:00.000Z", pagamento: "2026-09-20T00:00:00.000Z", divergencias: [], ...over,
});

const PDF = () => new File(["%PDF-1.4 ficticio"], "termo-ficticio.pdf", { type: "application/pdf" });

function abrir(over: Partial<Parameters<typeof ReciboRescisao>[0]> = {}) {
  const props = {
    year: 2026, month: 9, readonly: false,
    antesDeGravar: vi.fn().mockResolvedValue(undefined), onAplicado: vi.fn(), onErro: vi.fn(), ...over,
  };
  const { container } = render(<ReciboRescisao {...props} />);
  return { props, entrada: container.querySelector('input[type="file"]') as HTMLInputElement };
}
const escolher = (entrada: HTMLInputElement) => fireEvent.change(entrada, { target: { files: [PDF()] } });

beforeEach(() => { vi.mocked(lerReciboRescisao).mockReset(); });

describe("Ler termo de rescisão", () => {
  test("somente leitura: não oferece o botão nem o campo de arquivo", () => {
    const { entrada } = abrir({ readonly: true });
    expect(entrada).toBeNull();
    expect(screen.queryByText("Ler termo de rescisão (PDF)")).toBeNull();
  });

  test("o campo aceita só PDF", () => {
    const { entrada } = abrir();
    expect(entrada.getAttribute("accept")).toBe("application/pdf");
  });

  test("escolher o PDF lê em modo prévia (aplicar=false) com o período e mostra o que achou", async () => {
    vi.mocked(lerReciboRescisao).mockResolvedValue({ previa: previa(), aplicado: false });
    const { entrada } = abrir();
    escolher(entrada);
    expect(await screen.findByRole("region", { name: "Termo de rescisão lido" })).toBeTruthy();
    expect(lerReciboRescisao).toHaveBeenCalledWith(2026, 9, expect.stringContaining("base64"), "termo-ficticio.pdf", false);
    const txt = limpo(document.body.textContent);
    expect(txt).toContain("termo-ficticio.pdf");
    expect(txt).toContain("GorjetanotermoR$450,75");
    expect(txt).toContain("Saída12/09/2026");
    expect(txt).toContain("Admissão10/02/2025");
    expect(txt).toContain("Pagamentodarescisão20/09/2026");
    expect(txt).toContain("LíquidodarescisãoR$3.200,00");
    expect(screen.getByText("Usar R$ 450,75 como gorjeta quitada", { exact: false })).toBeTruthy();
  });

  test("datas ausentes viram traço e gorjeta não encontrada trava o botão de usar", async () => {
    vi.mocked(lerReciboRescisao).mockResolvedValue({ previa: previa({ gorjeta: null, afastamento: null, admissao: null, pagamento: null, liquido: null }), aplicado: false });
    const { entrada } = abrir();
    escolher(entrada);
    await screen.findByRole("region", { name: "Termo de rescisão lido" });
    const txt = limpo(document.body.textContent);
    expect(txt).toContain("Gorjetanotermonãoencontrada");
    expect(txt).toContain("Saída—");
    expect(txt).toContain("Líquidodarescisão—");
    const usar = screen.getByText(/^Usar /).closest("button") as HTMLButtonElement;
    expect(usar.disabled).toBe(true);
  });

  test("divergências do servidor são listadas", async () => {
    vi.mocked(lerReciboRescisao).mockResolvedValue({ previa: previa({ divergencias: ["Data de saída diferente do cadastro"] }), aplicado: false });
    const { entrada } = abrir();
    escolher(entrada);
    expect(await screen.findByText("Data de saída diferente do cadastro")).toBeTruthy();
  });

  test("erro da API ao ler vai para onErro e não mostra prévia", async () => {
    vi.mocked(lerReciboRescisao).mockRejectedValue(new Error("PDF ilegível"));
    const { entrada, props } = abrir();
    escolher(entrada);
    await waitFor(() => expect(props.onErro).toHaveBeenCalledWith("PDF ilegível"));
    expect(screen.queryByRole("region", { name: "Termo de rescisão lido" })).toBeNull();
    await waitFor(() => expect((screen.getByText("Ler termo de rescisão (PDF)").closest("button") as HTMLButtonElement).disabled).toBe(false));
  });

  test("cancelar descarta a prévia sem gravar", async () => {
    vi.mocked(lerReciboRescisao).mockResolvedValue({ previa: previa(), aplicado: false });
    const { entrada, props } = abrir();
    escolher(entrada);
    await screen.findByRole("region", { name: "Termo de rescisão lido" });
    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.queryByRole("region", { name: "Termo de rescisão lido" })).toBeNull();
    expect(lerReciboRescisao).toHaveBeenCalledTimes(1);
    expect(props.onAplicado).not.toHaveBeenCalled();
  });

  test("usar como gorjeta quitada: termina o autosave antes, grava com aplicar=true e devolve a apuração", async () => {
    const ordem: string[] = [];
    const computation = { year: 2026, month: 9 } as TipComputation;
    vi.mocked(lerReciboRescisao).mockImplementation(async (_a, _m, _b, _n, aplicar) => {
      ordem.push(aplicar ? "grava" : "le");
      return aplicar ? { previa: previa(), aplicado: true, computation } : { previa: previa(), aplicado: false };
    });
    const { entrada, props } = abrir({ antesDeGravar: vi.fn(async () => { ordem.push("antes"); }) });
    escolher(entrada);
    fireEvent.click(await screen.findByText(/^Usar /));
    await waitFor(() => expect(props.onAplicado).toHaveBeenCalledWith(computation));
    expect(ordem).toEqual(["le", "antes", "grava"]);
    expect(lerReciboRescisao).toHaveBeenLastCalledWith(2026, 9, expect.any(String), "termo-ficticio.pdf", true);
    expect(screen.queryByRole("region", { name: "Termo de rescisão lido" })).toBeNull();
  });

  test("erro ao gravar vai para onErro e a prévia continua na tela", async () => {
    vi.mocked(lerReciboRescisao)
      .mockResolvedValueOnce({ previa: previa(), aplicado: false })
      .mockRejectedValueOnce(new Error("Período fechado"));
    const { entrada, props } = abrir();
    escolher(entrada);
    fireEvent.click(await screen.findByText(/^Usar /));
    await waitFor(() => expect(props.onErro).toHaveBeenCalledWith("Período fechado"));
    expect(props.onAplicado).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Termo de rescisão lido" })).toBeTruthy();
  });

  test("tela de uma pessoa só: termo de outra pessoa avisa e não deixa aplicar", async () => {
    vi.mocked(lerReciboRescisao).mockResolvedValue({ previa: previa({ employeeId: "outra", nome: "Outra Pessoa" }), aplicado: false });
    const { entrada } = abrir({ esperado: { employeeId: "emp-1", nome: "Pessoa Ficticia" } });
    escolher(entrada);
    expect(await screen.findByText("Este termo é de Outra Pessoa, não de Pessoa Ficticia. Escolha o PDF certo.")).toBeTruthy();
    expect((screen.getByText(/^Usar /).closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  test("termo da pessoa esperada não gera aviso e pode ser aplicado", async () => {
    vi.mocked(lerReciboRescisao).mockResolvedValue({ previa: previa(), aplicado: false });
    const { entrada } = abrir({ esperado: { employeeId: "emp-1", nome: "Pessoa Ficticia" } });
    escolher(entrada);
    await screen.findByRole("region", { name: "Termo de rescisão lido" });
    expect(screen.queryByText(/Escolha o PDF certo/)).toBeNull();
    expect((screen.getByText(/^Usar /).closest("button") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Selo de rescisão paga", () => {
  test("não aparece quando não foi paga", () => {
    const { container } = render(<SeloRecibo pago={false} pagamento="2026-09-20" />);
    expect(container.textContent).toBe("");
  });

  test("paga: mostra o selo com a data e o arquivo no title", () => {
    render(<SeloRecibo pago pagamento="2026-09-20T00:00:00.000Z" arquivo="termo-ficticio.pdf" />);
    const selo = screen.getByText(/Paga na rescisão/);
    expect(selo.textContent).toContain("20/09/2026");
    expect((selo.closest("[title]") ?? selo).getAttribute("title")).toBe("Termo: termo-ficticio.pdf");
  });

  test("paga sem data: só o texto base", () => {
    render(<SeloRecibo pago pagamento={null} />);
    expect(screen.getByText("Paga na rescisão")).toBeTruthy();
  });
});
