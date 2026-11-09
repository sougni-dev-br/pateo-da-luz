import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { IfoodPrevisaoImportacao } from "../../api/client";
import { HideValuesProvider } from "../../design-system";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";

const api = vi.hoisted(() => ({ previsao: vi.fn(), confirmar: vi.fn() }));

vi.mock("../../api/client", () => ({
  previewIfoodImport: (...a: unknown[]) => api.previsao(...a),
  confirmIfoodImport: (...a: unknown[]) => api.confirmar(...a)
}));

const { IfoodImportacao } = await import("../IfoodImportacao");

const LOJA = {
  lojaId: "uuid-a", lojaIdCurto: "111", competencia: "2026-10", pedidos: 3, vendas: 300, taxas: -50, promocaoLoja: -20,
  servicos: 0, ajustes: 0, saldoAnterior: 0, bruto: 280, liquido: 230, liquidoComSaldo: 230, repasses: []
};

function previsao(parcial: Partial<IfoodPrevisaoImportacao> = {}): IfoodPrevisaoImportacao {
  return {
    arquivo: "c.xlsx", erros: [], avisos: [], alertas: [],
    plano: [{ loja: LOJA, id: "ifood-import-202610-111", acao: "CRIAR", existenteId: null, nomeDaLoja: "Loja Teste", repassesNovos: 1, anterior: null }],
    mesesTravados: [], totais: { criar: 1, alterar: 0, igual: 0, conflito: 0, travado: 0, semLoja: 0 },
    ...parcial
  };
}

const SESSAO = { user: { id: "u1", role: "ADMIN", permissions: [] } } as unknown as SessionContextValue;

function montar(onImportado: () => void = vi.fn()) {
  return render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider>
        <IfoodImportacao onImportado={onImportado} />
      </HideValuesProvider>
    </SessionContext.Provider>
  );
}

function enviarArquivo() {
  const input = screen.getByLabelText(/Relatório de Conciliação/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "c.xlsx")] } });
}

beforeEach(() => {
  api.previsao.mockReset();
  api.confirmar.mockReset();
});

describe("IfoodImportacao", () => {
  test("sem alertas, o botão Gravar fica liberado e confirma sem exigir checkbox", async () => {
    api.previsao.mockResolvedValue(previsao());
    api.confirmar.mockResolvedValue({ ...previsao(), gravados: 1, repassesGravados: 1, gravadas: ["Loja Teste 10/2026"] });
    const onImportado = vi.fn();
    montar(onImportado);
    enviarArquivo();
    const gravar = await screen.findByRole("button", { name: /Gravar no faturamento/i });
    expect(gravar).toBeEnabled();
    fireEvent.click(gravar);
    await waitFor(() => expect(api.confirmar).toHaveBeenCalledWith(expect.any(File), false));
    expect(await screen.findByText(/Loja Teste 10\/2026/)).toBeInTheDocument();
    expect(onImportado).toHaveBeenCalled();
  });

  test("com alertas, o botão só libera depois de marcar a confirmação, e o servidor recebe true", async () => {
    api.previsao.mockResolvedValue(previsao({ alertas: ["Loja Teste: o arquivo reduz o valor já gravado."] }));
    api.confirmar.mockResolvedValue({ ...previsao(), gravados: 1, repassesGravados: 0, gravadas: [] });
    montar();
    enviarArquivo();
    const gravar = await screen.findByRole("button", { name: /Gravar no faturamento/i });
    expect(gravar).toBeDisabled();
    expect(screen.getByText(/reduz o valor já gravado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(gravar).toBeEnabled();
    fireEvent.click(gravar);
    await waitFor(() => expect(api.confirmar).toHaveBeenCalledWith(expect.any(File), true));
  });

  test("com erro no arquivo, nada pode ser gravado", async () => {
    api.previsao.mockResolvedValue(previsao({ erros: ["Linha 3 da planilha: competência inválida."] }));
    montar();
    enviarArquivo();
    expect(await screen.findByText(/Linha 3 da planilha/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gravar no faturamento/i })).toBeDisabled();
  });

  test("loja não cadastrada aparece como tal na tabela, não como Novo", async () => {
    api.previsao.mockResolvedValue(previsao({
      plano: [{ loja: LOJA, id: "x", acao: "CRIAR", existenteId: null, nomeDaLoja: null, repassesNovos: 0, anterior: null }],
      totais: { criar: 0, alterar: 0, igual: 0, conflito: 0, travado: 0, semLoja: 1 }
    }));
    montar();
    enviarArquivo();
    expect(await screen.findByText("Loja não cadastrada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gravar no faturamento/i })).toBeDisabled();
    expect(screen.getByText(/não serão/i)).toBeInTheDocument();
  });

  test("mostra o valor anterior ao lado do novo quando a linha vai ser alterada", async () => {
    api.previsao.mockResolvedValue(previsao({
      plano: [{ loja: LOJA, id: "x", acao: "ALTERAR", existenteId: "x", nomeDaLoja: "Loja Teste", repassesNovos: 0,
        anterior: { pedidos: 1, bruto: 10, liquido: 5 } }],
      totais: { criar: 0, alterar: 1, igual: 0, conflito: 0, travado: 0, semLoja: 0 }
    }));
    montar();
    enviarArquivo();
    expect(await screen.findByText("Altera")).toBeInTheDocument();
    expect(screen.getByText(/1 →/)).toBeInTheDocument();
  });

  test("erro ao gravar mostra a mensagem e recarrega a tela, porque a gravação pode ter terminado", async () => {
    api.previsao.mockResolvedValue(previsao());
    api.confirmar.mockRejectedValue(new Error("Erro HTTP 500"));
    const onImportado = vi.fn();
    montar(onImportado);
    enviarArquivo();
    fireEvent.click(await screen.findByRole("button", { name: /Gravar no faturamento/i }));
    expect(await screen.findByText(/Erro HTTP 500/)).toBeInTheDocument();
    expect(onImportado).toHaveBeenCalled();
  });
});
