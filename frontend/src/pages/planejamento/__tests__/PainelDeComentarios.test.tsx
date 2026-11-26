import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { acoes } from "./acoes";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../api/client";
import { PainelDeComentarios } from "../comentarios/PainelDeComentarios";
import { useComentarios } from "../comentarios/useComentarios";
import type { PontoDeComentario } from "../comentarios/ponto";
import { comentarioFicticio, comparativoFicticio } from "./fixturesComentarios";

vi.mock("../../../api/client", async (original) => ({
  ...(await original<typeof import("../../../api/client")>()),
  listarComentariosDoComparativo: vi.fn(),
  criarComentario: vi.fn(),
  editarComentario: vi.fn(),
  apagarComentario: vi.fn()
}));

const PONTO: PontoDeComentario = { mes: 10, metrica: "VENDAS", turno: "TOTAL" };
const dados = comparativoFicticio();

function Montagem({ podeEscrever = true, aoFechar = () => undefined }: { podeEscrever?: boolean; aoFechar?: () => void }) {
  const api = useComentarios(2025, 2026, true);
  const [ponto, setPonto] = useState<PontoDeComentario | null>(PONTO);
  return <PainelDeComentarios ponto={ponto} aoMudarPonto={setPonto} aoFechar={() => { setPonto(null); aoFechar(); }} dados={dados} api={api} podeEscrever={podeEscrever} />;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.listarComentariosDoComparativo).mockResolvedValue([]);
});

describe("PainelDeComentarios", () => {
  it("mostra o estado vazio e o cabeçalho com os números do ponto", async () => {
    render(<Montagem />);
    expect(await screen.findByText(/Ninguém explicou este ponto ainda/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Out\/2026 · Vendas/ })).toBeInTheDocument();
    expect(screen.getByText("Variação")).toBeInTheDocument();
  });

  it("falha só nos comentários: mostra o erro e tenta de novo", async () => {
    vi.mocked(client.listarComentariosDoComparativo).mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce([comentarioFicticio({ texto: "Chuva forte" })]);
    render(<Montagem />);
    expect(await screen.findByText("Os comentários não carregaram")).toBeInTheDocument();
    await acoes.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Chuva forte")).toBeInTheDocument();
  });

  it("sem permissão de edição: lê, mas não vê formulário nem Editar", async () => {
    vi.mocked(client.listarComentariosDoComparativo).mockResolvedValue([comentarioFicticio({ podeEditar: false, podeApagar: false })]);
    render(<Montagem podeEscrever={false} />);
    expect(await screen.findByText("Teste fictício")).toBeInTheDocument();
    expect(screen.queryByLabelText("Novo comentário")).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.getByText(/exige permissão de edição/)).toBeInTheDocument();
  });

  it("cria um comentário e mostra na lista", async () => {
    vi.mocked(client.criarComentario).mockResolvedValue(comentarioFicticio({ id: "n1", texto: "Reforma no salão" }));
    render(<Montagem />);
    await acoes.type(await screen.findByLabelText("Novo comentário"), "Reforma no salão");
    await acoes.click(screen.getByRole("button", { name: "Salvar comentário" }));
    expect(await screen.findByText("Reforma no salão", { selector: "p" })).toBeInTheDocument();
    expect(client.criarComentario).toHaveBeenCalledWith(expect.objectContaining({ anoComparado: 2026, mes: 10, metrica: "VENDAS", turno: "TOTAL", naImpressao: true }));
  });

  it("Ctrl+Enter salva e o contador mostra o tamanho", async () => {
    vi.mocked(client.criarComentario).mockResolvedValue(comentarioFicticio({ id: "n2", texto: "abc" }));
    render(<Montagem />);
    const campo = await screen.findByLabelText("Novo comentário");
    await acoes.type(campo, "abc");
    expect(screen.getByText("3/1000")).toBeInTheDocument();
    fireEvent.keyDown(campo, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(client.criarComentario).toHaveBeenCalled());
  });

  it("edita o próprio comentário e esconde Editar no alheio", async () => {
    vi.mocked(client.listarComentariosDoComparativo).mockResolvedValue([
      comentarioFicticio({ id: "meu", texto: "Meu texto" }),
      comentarioFicticio({ id: "alheio", texto: "Texto de outra pessoa", podeEditar: false, podeApagar: false })
    ]);
    vi.mocked(client.editarComentario).mockResolvedValue(comentarioFicticio({ id: "meu", texto: "Texto novo", editadoEm: "2026-11-02T10:00:00.000Z" }));
    render(<Montagem />);
    await screen.findByText("Meu texto");
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(1);
    await acoes.click(screen.getByRole("button", { name: "Editar" }));
    const campo = screen.getByLabelText("Editar comentário");
    await acoes.clear(campo);
    await acoes.type(campo, "Texto novo");
    await acoes.click(screen.getByRole("button", { name: "Salvar alteração" }));
    expect(await screen.findByText("editado")).toBeInTheDocument();
    expect(client.editarComentario).toHaveBeenCalledWith("meu", expect.objectContaining({ texto: "Texto novo", atualizadoEm: "2026-11-01T13:00:00.000Z" }));
  });

  it("administrador vê Apagar no comentário alheio e apaga após confirmar", async () => {
    vi.mocked(client.listarComentariosDoComparativo).mockResolvedValue([comentarioFicticio({ id: "x", texto: "De outro", podeEditar: false, podeApagar: true })]);
    vi.mocked(client.apagarComentario).mockResolvedValue({ ok: true });
    render(<Montagem />);
    await screen.findByText("De outro");
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    await acoes.click(screen.getByRole("button", { name: "Apagar" }));
    const confirmacao = await screen.findByRole("dialog", { name: "Apagar este comentário?" });
    await acoes.click(within(confirmacao).getByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(screen.queryByText("De outro")).toBeNull());
  });

  it("depois de apagar o último comentário o foco fica na gaveta, não no body", async () => {
    vi.mocked(client.listarComentariosDoComparativo).mockResolvedValue([comentarioFicticio({ id: "x", texto: "De outro", podeEditar: false, podeApagar: true })]);
    vi.mocked(client.apagarComentario).mockResolvedValue({ ok: true });
    render(<Montagem />);
    await screen.findByText("De outro");
    await acoes.click(screen.getByRole("button", { name: "Apagar" }));
    const confirmacao = await screen.findByRole("dialog", { name: "Apagar este comentário?" });
    await acoes.click(within(confirmacao).getByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(screen.queryByText("De outro")).toBeNull());
    await waitFor(() => expect(document.body).not.toBe(document.activeElement));
    expect(screen.getByRole("dialog", { name: /Comentários/ }).contains(document.activeElement)).toBe(true);
  });

  it("Esc fecha a gaveta", async () => {
    const aoFechar = vi.fn();
    render(<Montagem aoFechar={aoFechar} />);
    await screen.findByLabelText("Novo comentário");
    await acoes.escape();
    expect(aoFechar).toHaveBeenCalled();
  });
});
