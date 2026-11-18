import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { PeriodoFerias, PessoaFerias, ProgramacaoFerias } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { LinhaPeriodo } from "../LinhaPeriodo";

// Valores FICTÍCIOS. O botão aparece só no título de férias que veio do recibo e ainda está em aberto.
const programada = (pagamento: ProgramacaoFerias["pagamento"]): ProgramacaoFerias => ({
  id: "g1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", gozoFim: "2026-12-30", dias: 30, diasAbono: 0,
  status: "PROGRAMADA", observacao: null, passouDaData: false, pagamento,
});
const periodo = (g: ProgramacaoFerias): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 30, diasAbono: 0, diasPendentes: 0, situacao: "PROGRAMADA", nivel: "ok",
  diasParaLimite: 107, diasParaCompletar: null, foraDoPrazo: false, doHistorico: false, programacoes: [g],
});
const pessoa = (p: PeriodoFerias): PessoaFerias =>
  ({ employeeId: "e1", nome: "Ana Souza", empresa: "Pateo da Luz", setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos: [p] });
const SESSAO = { hideSensitiveValues: false, toggleSensitiveValues: () => undefined } as unknown as SessionContextValue;

function abrir(pagamento: ProgramacaoFerias["pagamento"], onSomarCombinado: ((g: ProgramacaoFerias) => void) | null = vi.fn()) {
  const g = programada(pagamento);
  const p = periodo(g);
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider>
        <ul>
          <LinhaPeriodo linha={{ pessoa: pessoa(p), periodo: p }} ocupado={false} formulario={null} onProgramar={vi.fn()} onPedido={vi.fn()} onJaGozou={vi.fn()}
            onEditar={vi.fn()} onCancelar={vi.fn()} onConfirmar={vi.fn()} onDesfazer={vi.fn()} onSomarCombinado={onSomarCombinado ?? undefined} />
        </ul>
      </HideValuesProvider>
    </SessionContext.Provider>,
  );
  return { g, onSomarCombinado };
}
const titulo = (o: Partial<NonNullable<ProgramacaoFerias["pagamento"]>> = {}) => ({ id: "t1", valor: 4633.68, vencimento: "2026-11-30", pago: false, doRecibo: true, combinadoSomado: false, ...o });

describe("botão de somar o combinado na linha de férias", () => {
  test("título do recibo em aberto: mostra 'Somar combinado' e abre com a programação", () => {
    const { g, onSomarCombinado } = abrir(titulo());
    fireEvent.click(screen.getByRole("button", { name: /Somar combinado nas férias de Ana Souza/ }));
    expect(onSomarCombinado).toHaveBeenCalledWith(g);
  });

  test("título que já recebeu a soma: o botão vira 'Refazer combinado'", () => {
    abrir(titulo({ combinadoSomado: true }));
    expect(screen.getByRole("button", { name: /Refazer a soma do combinado/ })).toHaveTextContent("Refazer combinado");
  });

  test("título pago: sem botão (pago nunca muda)", () => {
    abrir(titulo({ pago: true }));
    expect(screen.queryByRole("button", { name: /combinado/i })).not.toBeInTheDocument();
  });

  test("título lançado à mão (não veio do recibo): sem botão", () => {
    abrir(titulo({ doRecibo: false }));
    expect(screen.queryByRole("button", { name: /combinado/i })).not.toBeInTheDocument();
  });

  test("sem título ou sem a ação (impressão, outras telas): sem botão", () => {
    abrir(null);
    expect(screen.queryByRole("button", { name: /combinado/i })).not.toBeInTheDocument();
  });

  test("sem a função da tela: sem botão mesmo com título do recibo em aberto", () => {
    abrir(titulo(), null);
    expect(screen.queryByRole("button", { name: /combinado/i })).not.toBeInTheDocument();
  });
});
