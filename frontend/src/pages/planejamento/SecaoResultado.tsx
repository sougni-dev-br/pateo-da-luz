import { useState } from "react";
import type { PlanejamentoCaixa, PlanejamentoProjecao, PlanejamentoResultado } from "../../api/client";
import { Alert } from "../../design-system";
import { Abas, PainelDaAba, type Aba } from "./Abas";
import { GraficoCompetenciaCaixa } from "./GraficoCompetenciaCaixa";
import { NOMES_DOS_MESES } from "./formato";
import { Reais } from "./Reais";
import { ResultadoCaixa } from "./ResultadoCaixa";
import { ResultadoGastos } from "./ResultadoGastos";
import { ResultadoProjecao } from "./ResultadoProjecao";
import { useEstreito } from "./useEstreito";

// Aba Resultado do cenário: lucro e caixa mês a mês e as vendas projetadas. No computador, os dois regimes cabem lado a
// lado; no celular não cabem, então aparece um por vez (Competência | Caixa) e o outro fica resumido numa linha.

type Regime = "competencia" | "caixa" | "lado";
const REGIMES: Aba<Regime>[] = [
  { valor: "lado", rotulo: "Lado a lado" },
  { valor: "competencia", rotulo: "Competência" },
  { valor: "caixa", rotulo: "Caixa" }
];
const REGIMES_NO_CELULAR = REGIMES.filter((r) => r.valor !== "lado");

type Props = { projecao: PlanejamentoProjecao; resultado: PlanejamentoResultado; caixa: PlanejamentoCaixa | null; ano: number; anoBase: number };

/** O regime que não está à vista, numa linha: no celular a pessoa não perde o outro lado da conta. */
function OutroRegime({ regime, resultado, caixa, onTrocar }: { regime: "competencia" | "caixa"; resultado: PlanejamentoResultado; caixa: PlanejamentoCaixa | null; onTrocar: () => void }) {
  if (regime === "competencia") {
    if (!caixa) return null;
    const pior = caixa.total.menorSaldo;
    return (
      <p className="plan-outro-regime plan-outro-regime-caixa">
        <span className="plan-outro-regime-rotulo">No caixa</span>
        <span>resultado <strong><Reais valor={caixa.total.resultado} /></strong>{pior ? <>; saldo mínimo <strong><Reais valor={pior.valor} /></strong> em {NOMES_DOS_MESES[pior.mes - 1]}</> : null}.</span>
        <button type="button" className="plan-link" onClick={onTrocar}>Ver o caixa</button>
      </p>
    );
  }
  return (
    <p className="plan-outro-regime plan-outro-regime-competencia">
      <span className="plan-outro-regime-rotulo">Em competência</span>
      <span>lucro de <strong><Reais valor={resultado.total.lucro} /></strong> no período.</span>
      <button type="button" className="plan-link" onClick={onTrocar}>Ver a competência</button>
    </p>
  );
}

export function SecaoResultado({ projecao, resultado, caixa, ano, anoBase }: Props) {
  const estreito = useEstreito();
  const [regime, setRegime] = useState<Regime>("lado");
  const visivel: Regime = estreito && regime === "lado" ? "competencia" : regime;

  return (
    <>
      <section className="plan-secao" aria-labelledby="plan-lucro-caixa">
        <div className="plan-cabecalho plan-cabecalho-com-controle">
          <div>
            <h2 id="plan-lucro-caixa" className="plan-titulo">Lucro e caixa mês a mês</h2>
            <p className="plan-sub">Competência é quando a venda e o gasto acontecem; caixa é quando o dinheiro entra e sai.</p>
          </div>
          <Abas id="plan-regime" rotulo="Regime do resultado" variante="segmentada" abas={estreito ? REGIMES_NO_CELULAR : REGIMES} valor={visivel} aoMudar={setRegime} />
        </div>
        <GraficoCompetenciaCaixa resultado={resultado} caixa={caixa} />
        <PainelDaAba id="plan-regime" valor={visivel} className="plan-secao">
          {estreito && visivel !== "lado" && <OutroRegime regime={visivel} resultado={resultado} caixa={caixa} onTrocar={() => setRegime(visivel === "competencia" ? "caixa" : "competencia")} />}
          {visivel === "competencia" ? (
            <ResultadoGastos projecao={projecao} resultado={resultado} />
          ) : caixa ? (
            <ResultadoCaixa projecao={projecao} resultado={resultado} caixa={caixa} modo={visivel === "caixa" ? "caixa" : "lado"} />
          ) : (
            <Alert tone="warning">O resultado de caixa precisa do mix das formas de pagamento somando 100%. Corrija na aba Caixa; a competência segue atualizada.</Alert>
          )}
        </PainelDaAba>
      </section>
      <section className="plan-secao" aria-labelledby="plan-vendas-projetadas">
        <div className="plan-cabecalho">
          <h2 id="plan-vendas-projetadas" className="plan-titulo">Vendas projetadas</h2>
          <p className="plan-sub">Clientes × ticket por turno, sobre o mesmo mês de {anoBase}.</p>
        </div>
        <ResultadoProjecao projecao={projecao} ano={ano} anoBase={anoBase} />
      </section>
    </>
  );
}
