import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  previaFichaRegistro: vi.fn(),
  aplicarFichaRegistro: vi.fn(),
}));
vi.mock("../../../context/SessionContext", () => ({ useSession: () => ({ user: { id: "u1" } }) }));
vi.mock("../../../lib/permissions", () => ({ hasPermission: vi.fn(() => true) }));

import { type FichaPessoaPrevista, aplicarFichaRegistro, previaFichaRegistro } from "../../../api/client";
import { hasPermission } from "../../../lib/permissions";
import { ImportarFicha } from "../ImportarFicha";

const pessoa = (o: Partial<FichaPessoaPrevista> = {}): FichaPessoaPrevista => ({
  chave: "e1", employeeId: "e1", nome: "FULANA DE TAL", registro: "000020", situacao: "COM_ITENS",
  cadastro: { nome: "Fulana de Tal", cargo: "Cozinheiro", empresa: "Pateo" },
  itens: [
    { id: "preenche:cbo", tipo: "PREENCHE", rotulo: "CBO", atual: null, ficha: "513205", detalhes: [], padrao: true, bloqueio: null },
    { id: "diverge:racaCor", tipo: "DIVERGE", rotulo: "Raça/cor", atual: "Branca", ficha: "Parda", detalhes: [], padrao: false, bloqueio: null },
    { id: "salario", tipo: "SALARIO", rotulo: "Salário", atual: "R$ 2.600,00", ficha: "R$ 2.700,00", detalhes: ["desde 01/11/2026: R$ 2.600,00 → R$ 2.700,00"], padrao: false, bloqueio: null },
  ],
  suspeitos: ["RG emitido antes do nascimento"], observacoes: [], ...o,
});

const renderPagina = () => render(<MemoryRouter><ImportarFicha /></MemoryRouter>);
const enviarPdf = async () => {
  const pdf = new File(["%PDF-1.4"], "ficha.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByTestId("arquivo-ficha"), { target: { files: [pdf] } });
  await screen.findByText("FULANA DE TAL");
  return pdf;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasPermission).mockReturnValue(true);
  vi.mocked(previaFichaRegistro).mockResolvedValue({ desde: null, pessoas: [pessoa()] });
  vi.mocked(aplicarFichaRegistro).mockResolvedValue({ resultados: [{ employeeId: "e1", nome: "Fulana", aplicados: ["preenche:cbo"], ignorados: [] }] });
});

describe("ImportarFicha", () => {
  test("mostra a prévia: campo vazio já marcado, divergência e salário desmarcados, suspeito como aviso", async () => {
    renderPagina();
    await enviarPdf();
    expect(screen.getByRole("checkbox", { name: /CBO: 513205/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Raça\/cor: Parda/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Salário: R\$ 2\.700,00/ })).not.toBeChecked();
    expect(screen.getByText(/RG emitido antes do nascimento/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar 1 item(ns) em 1 pessoa(s)" })).toBeEnabled();
  });

  test("a data de início dos salários vai junto na leitura do PDF", async () => {
    renderPagina();
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: "2026-11-01" } });
    await enviarPdf();
    expect(vi.mocked(previaFichaRegistro).mock.calls[0][1]).toBe("2026-11-01");
  });

  test("aplicar envia só os ids marcados por funcionário, e o motivo aparece quando o salário é marcado", async () => {
    renderPagina();
    const pdf = await enviarPdf();
    expect(screen.queryByLabelText(/Motivo do reajuste/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Salário: R\$ 2\.700,00/ }));
    expect(screen.getByLabelText(/Motivo do reajuste/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar 2 item(ns) em 1 pessoa(s)" }));
    await waitFor(() => expect(aplicarFichaRegistro).toHaveBeenCalledTimes(1));
    const [arquivo, selecoes, desde, motivo] = vi.mocked(aplicarFichaRegistro).mock.calls[0];
    expect(arquivo).toBe(pdf);
    expect(selecoes).toEqual({ e1: ["preenche:cbo", "salario"] });
    expect(desde).toBeNull();
    expect(motivo).toMatch(/Dissídio 2026/);
    // Depois de gravar, a prévia é lida de novo.
    await waitFor(() => expect(previaFichaRegistro).toHaveBeenCalledTimes(2));
  });

  test("sem motivo de salário marcado, o motivo não é enviado", async () => {
    renderPagina();
    await enviarPdf();
    fireEvent.click(screen.getByRole("button", { name: /Aplicar 1 item/ }));
    await waitFor(() => expect(aplicarFichaRegistro).toHaveBeenCalled());
    expect(vi.mocked(aplicarFichaRegistro).mock.calls[0][3]).toBeNull();
  });

  test("item bloqueado aparece com o motivo e não pode ser marcado", async () => {
    const bloqueada = pessoa({ itens: [{ id: "salario", tipo: "SALARIO", rotulo: "Salário", atual: null, ficha: "R$ 2.700,00", detalhes: [], padrao: false, bloqueio: "desligado: confira à mão." }] });
    vi.mocked(previaFichaRegistro).mockResolvedValue({ desde: "2026-11-01", pessoas: [bloqueada] });
    renderPagina();
    await enviarPdf();
    expect(screen.getByRole("checkbox", { name: /Salário/ })).toBeDisabled();
    expect(screen.getByText(/Não pode ser gravado: desligado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marque o que aplicar" })).toBeDisabled();
  });

  test("sem cadastro e CPF duplicado explicam por que não há o que importar", async () => {
    vi.mocked(previaFichaRegistro).mockResolvedValue({
      desde: null,
      pessoas: [
        pessoa({ chave: "sem:1", employeeId: null, situacao: "SEM_CADASTRO", itens: [], nome: "SEM CADASTRO", suspeitos: [] }),
        pessoa({ chave: "sem:2", employeeId: null, situacao: "CPF_DUPLICADO", itens: [], nome: "DUPLICADA", suspeitos: [] }),
      ],
    });
    renderPagina();
    fireEvent.change(screen.getByTestId("arquivo-ficha"), { target: { files: [new File(["%PDF-"], "f.pdf")] } });
    expect(await screen.findByText(/A importação não cria cadastro/)).toBeInTheDocument();
    expect(screen.getByText(/em mais de um cadastro, ou a pessoa aparece em duas fichas/)).toBeInTheDocument();
  });

  test("erro do servidor na leitura aparece na tela", async () => {
    vi.mocked(previaFichaRegistro).mockRejectedValue(new Error("Não consegui ler a ficha: Ficha sem número de registro."));
    renderPagina();
    fireEvent.change(screen.getByTestId("arquivo-ficha"), { target: { files: [new File(["%PDF-"], "f.pdf")] } });
    expect(await screen.findByText(/Ficha sem número de registro/)).toBeInTheDocument();
  });

  test("quem não pode editar vê a prévia mas não consegue aplicar", async () => {
    vi.mocked(hasPermission).mockReturnValue(false);
    renderPagina();
    await enviarPdf();
    expect(screen.getByRole("button", { name: /Aplicar 1 item/ })).toBeDisabled();
  });

  test("itens ignorados pelo servidor são listados com o motivo", async () => {
    vi.mocked(aplicarFichaRegistro).mockResolvedValue({
      resultados: [{ employeeId: "e1", nome: "Fulana", aplicados: [], ignorados: [{ id: "preenche:cbo", motivo: "já não vale: o cadastro mudou." }] }],
    });
    renderPagina();
    await enviarPdf();
    fireEvent.click(screen.getByRole("button", { name: /Aplicar 1 item/ }));
    expect(await screen.findByText(/Não foram gravados/)).toBeInTheDocument();
    expect(screen.getByText(/já não vale: o cadastro mudou/)).toBeInTheDocument();
  });
});
