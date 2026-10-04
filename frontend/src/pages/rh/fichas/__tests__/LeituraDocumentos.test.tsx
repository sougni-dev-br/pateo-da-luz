import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FichaCadastralDetalhe } from "../../../../api/client";
import { ToastProvider } from "../../../../components/ui";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  corrigirFichaPelaLeitura: vi.fn(),
}));
// O OCR de verdade (tesseract no navegador) não roda no jsdom: o teste entrega o texto lido.
vi.mock("../leitorDocumentos", () => ({
  TIPOS_LIDOS: new Set(["DOC_FOTO"]),
  lerDocumentos: vi.fn(),
}));

import { corrigirFichaPelaLeitura } from "../../../../api/client";
import { LeituraDocumentos } from "../LeituraDocumentos";
import { lerDocumentos } from "../leitorDocumentos";

// Pessoa e números fictícios.
const RG = `REGISTRO GERAL 12.345.678-9
NOME
JOANA EXEMPLO DA SILVA
DATA DE NASCIMENTO 21/07/1998
CPF 123.456.789-09`;

const ficha = (arquivos = [{ id: "a1", tipo: "DOC_FOTO", nomeOriginal: "rg.jpg", mimeType: "image/jpeg", tamanho: 1, createdAt: "" }]) => ({
  id: "f1", tipo: "ATUALIZACAO", status: "FINALIZADA", arquivos,
  dados: { nomeCompleto: "Joana Exmplo da Silva", cpf: "12345678909", dataNascimento: "1998-07-12" },
  opcoes: { tiposArquivo: { DOC_FOTO: "RG ou CNH" }, rotulos: {} },
}) as unknown as FichaCadastralDetalhe;

const montar = (f = ficha(), onCorrigida = vi.fn()) => {
  render(<ToastProvider><LeituraDocumentos ficha={f} onCorrigida={onCorrigida} /></ToastProvider>);
  return onCorrigida;
};

describe("Conferir com os documentos", () => {
  beforeEach(() => {
    vi.mocked(lerDocumentos).mockReset().mockResolvedValue({ textos: { DOC_FOTO: RG }, falhas: [] });
    vi.mocked(corrigirFichaPelaLeitura).mockReset().mockResolvedValue({ ok: true, corrigidos: ["nomeCompleto", "dataNascimento"] });
  });

  test("nome e data divergentes vêm desmarcados: o RH confere na foto", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Ler documentos" }));
    expect(await screen.findByText(/outro valor em 2 campo/)).toBeTruthy();
    expect(screen.getByText("JOANA EXEMPLO DA SILVA")).toBeTruthy();
    expect(screen.getByText("21/07/1998")).toBeTruthy();
    expect(screen.getByText(/Conferem com o documento: CPF/)).toBeTruthy();
    expect(screen.getAllByText("confira na foto")).toHaveLength(2);
    expect(screen.getAllByRole("checkbox").some((c) => (c as HTMLInputElement).checked)).toBe(false);
  });

  test("CPF com dígito verificador vem marcado", async () => {
    const f = ficha();
    f.dados = { cpf: "12345678990" };
    montar(f);
    fireEvent.click(screen.getByRole("button", { name: "Ler documentos" }));
    expect(await screen.findByText("dígito verificador confere")).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  test("aplica só o que ficou marcado", async () => {
    const onCorrigida = montar();
    fireEvent.click(screen.getByRole("button", { name: "Ler documentos" }));
    await screen.findByText(/outro valor em 2 campo/);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Corrigir 1 campo(s) na ficha" }));
    await waitFor(() => expect(corrigirFichaPelaLeitura).toHaveBeenCalledWith("f1", { nomeCompleto: "JOANA EXEMPLO DA SILVA" }));
    await waitFor(() => expect(onCorrigida).toHaveBeenCalled());
  });

  test("leitura sem divergência não mostra botão de correção", async () => {
    vi.mocked(lerDocumentos).mockResolvedValue({ textos: { DOC_FOTO: RG }, falhas: ["RG ou CNH (verso.jpg)"] });
    const f = ficha();
    f.dados = { cpf: "12345678909" };
    montar(f);
    fireEvent.click(screen.getByRole("button", { name: "Ler documentos" }));
    expect(await screen.findByText(/Nenhuma divergência/)).toBeTruthy();
    expect(screen.getByText(/Não deu para abrir: RG ou CNH \(verso.jpg\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Corrigir/ })).toBeNull();
  });

  test("sem foto de documento: botão desabilitado e aviso", () => {
    montar(ficha([]));
    expect((screen.getByRole("button", { name: "Ler documentos" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/não mandou foto de documento/)).toBeTruthy();
  });

  test("falha na leitura vira mensagem, sem quebrar a tela", async () => {
    vi.mocked(lerDocumentos).mockRejectedValue(new Error("sem internet para baixar o leitor"));
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Ler documentos" }));
    expect(await screen.findByText(/sem internet para baixar o leitor/)).toBeTruthy();
  });
});
