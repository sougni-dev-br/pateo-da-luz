import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getCampanhasBrinde: vi.fn(),
  getDetalheBrinde: vi.fn(),
  criarCampanhaBrinde: vi.fn(async () => ({ id: "b1" })),
  marcarEntregaBrinde: vi.fn(async () => ({ id: "x" })),
  desfazerEntregaBrinde: vi.fn(async () => ({ ok: true })),
  marcarEntregasBrindeEmLote: vi.fn(async () => ({ marcados: 1, jaMarcadosOuInativos: 0 })),
}));

import {
  type DetalheBrinde, type PessoaBrinde, criarCampanhaBrinde, desfazerEntregaBrinde,
  getCampanhasBrinde, getDetalheBrinde, marcarEntregaBrinde, marcarEntregasBrindeEmLote,
} from "../../../api/client";
import { Brindes } from "../Brindes";

const pessoa = (o: Partial<PessoaBrinde> & Pick<PessoaBrinde, "employeeId" | "nome">): PessoaBrinde => ({
  nomeCompleto: o.nome, empresa: "Casa Teste", setor: "Salão", cargo: null, ativo: true, saidaEm: null, entrega: null, ...o,
});
const detalhe = (pessoas: PessoaBrinde[]): DetalheBrinde => ({
  hoje: "2026-12-20",
  campanha: { id: "b1", nome: "Brinde de Natal", ano: 2026, observacao: null },
  resumo: {
    ativos: pessoas.filter((p) => p.ativo).length,
    entregues: pessoas.filter((p) => p.ativo && p.entrega).length,
    faltam: pessoas.filter((p) => p.ativo && !p.entrega).length,
    entreguesDeInativos: pessoas.filter((p) => !p.ativo && p.entrega).length,
  },
  pessoas,
});
const entrega = { id: "e1", entregueEm: "2026-12-20", observacao: null, registradoPor: "Admin" };
const campanhas = { hoje: "2026-12-20", ativos: 2, campanhas: [{ id: "b1", nome: "Brinde de Natal", ano: 2026, observacao: null, entregues: 1 }] };
const abrir = () => render(<MemoryRouter><Brindes /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(getCampanhasBrinde).mockResolvedValue(campanhas);
});

describe("Brindes", () => {
  test("sem campanha oferece criar o brinde", async () => {
    vi.mocked(getCampanhasBrinde).mockResolvedValue({ hoje: "2026-12-20", ativos: 0, campanhas: [] });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Criar" }));
    await waitFor(() => expect(criarCampanhaBrinde).toHaveBeenCalledWith({ nome: "Brinde de Natal", ano: new Date().getFullYear() }));
  });

  test("mostra o andamento e quem recebeu; marcar e desfazer chamam a API", async () => {
    vi.mocked(getDetalheBrinde).mockResolvedValue(detalhe([pessoa({ employeeId: "a", nome: "Ana" }), pessoa({ employeeId: "b", nome: "Bia", entrega })]));
    abrir();
    expect(await screen.findByText(/1 de 2 funcionários ativos já receberam/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar como entregue" }));
    await waitFor(() => expect(marcarEntregaBrinde).toHaveBeenCalledWith("b1", "a"));
    fireEvent.click(screen.getByRole("button", { name: "✓ Recebeu" }));
    await waitFor(() => expect(desfazerEntregaBrinde).toHaveBeenCalledWith("b1", "b"));
  });

  test("filtro Faltam esconde quem já recebeu; quem saiu e recebeu só aparece em Receberam", async () => {
    vi.mocked(getDetalheBrinde).mockResolvedValue(detalhe([
      pessoa({ employeeId: "a", nome: "Ana" }),
      pessoa({ employeeId: "b", nome: "Bia", entrega }),
      pessoa({ employeeId: "c", nome: "Caio", ativo: false, entrega }),
    ]));
    abrir();
    // A folha de assinatura (aria-hidden, só impressão) repete os nomes: a tela é a região.
    const tela = within(await screen.findByRole("region", { name: /Brindes aos colaboradores/ }));
    await tela.findByText("Ana");
    fireEvent.click(tela.getByRole("button", { name: /Faltam/ }));
    expect(tela.getByText("Ana")).toBeInTheDocument();
    expect(tela.queryByText("Bia")).not.toBeInTheDocument();
    expect(tela.queryByText("Caio")).not.toBeInTheDocument();
    fireEvent.click(tela.getByRole("button", { name: /Receberam/ }));
    expect(tela.getByText("Caio")).toBeInTheDocument();
    expect(tela.getByText("Já saiu da empresa")).toBeInTheDocument();
  });

  test("marcar todos que faltam pede confirmação e manda só os ativos sem entrega", async () => {
    vi.mocked(getDetalheBrinde).mockResolvedValue(detalhe([pessoa({ employeeId: "a", nome: "Ana" }), pessoa({ employeeId: "b", nome: "Bia", entrega })]));
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Marcar todos que faltam" }));
    await waitFor(() => expect(marcarEntregasBrindeEmLote).toHaveBeenCalledWith("b1", { employeeIds: ["a"] }));
    expect(window.confirm).toHaveBeenCalled();
  });
});
