import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { PeriodoFerias, PessoaFerias, ProgramacaoFerias } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { LinhaPeriodo } from "../LinhaPeriodo";

const SESSAO = { hideSensitiveValues: false, toggleSensitiveValues: () => undefined } as unknown as SessionContextValue;
const prog = (pagamento: ProgramacaoFerias["pagamento"]): ProgramacaoFerias => ({
  id: "g1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-02", gozoFim: "2026-12-31", dias: 30, diasAbono: 0, status: "PROGRAMADA", observacao: null, passouDaData: false, pagamento,
});
const periodo = (g: ProgramacaoFerias): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 30, diasAbono: 0, diasPendentes: 0, situacao: "PROGRAMADA", nivel: "ok", diasParaLimite: null, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [g],
});
const pessoa = { employeeId: "e1", nome: "Ana Exemplo", empresa: null, setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos: [] } as PessoaFerias;
const noop = () => undefined;

function montar(pagamento: ProgramacaoFerias["pagamento"], onComplementar?: (id: string) => void) {
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider>
        <ul><LinhaPeriodo linha={{ pessoa, periodo: periodo(prog(pagamento)) }} ocupado={false} formulario={null} onProgramar={noop} onPedido={noop} onJaGozou={noop}
          onEditar={noop} onCancelar={noop} onConfirmar={noop} onDesfazer={noop} onComplementar={onComplementar} /></ul>
      </HideValuesProvider>
    </SessionContext.Provider>,
  );
}

describe("LinhaPeriodo · Complementar pelo combinado", () => {
  test("título em aberto mostra a ação e entrega o id do título", () => {
    const onComplementar = vi.fn();
    montar({ id: "pi1", valor: 5304.84, vencimento: "2026-12-24", pago: false, combinado: true }, onComplementar);
    fireEvent.click(screen.getByRole("button", { name: /Complementar pelo combinado/ }));
    expect(onComplementar).toHaveBeenCalledWith("pi1");
  });

  test("título em aberto de quem não tem combinado não tem a ação", () => {
    montar({ id: "pi1", valor: 5304.84, vencimento: "2026-12-24", pago: false, combinado: false }, vi.fn());
    expect(screen.queryByRole("button", { name: /Complementar pelo combinado/ })).toBeNull();
  });

  test("título pago não tem a ação", () => {
    montar({ id: "pi1", valor: 5304.84, vencimento: "2026-12-24", pago: true }, vi.fn());
    expect(screen.queryByRole("button", { name: /Complementar pelo combinado/ })).toBeNull();
  });

  test("sem título lançado não tem a ação", () => {
    montar(null, vi.fn());
    expect(screen.queryByRole("button", { name: /Complementar pelo combinado/ })).toBeNull();
  });
});
