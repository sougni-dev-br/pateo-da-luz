// De onde saíram os números que preenchem a rescisão: VT pago para depois da saída,
// vales em aberto, salário proporcional e gorjeta até a saída. Fica recolhido — o
// formulário é a fonte; aqui é a conta, para quem quer conferir.
import type { ReactNode } from "react";
import type { ApuracaoRescisao as Apuracao } from "../../api/client";
import { Money, StatusBadge } from "../../design-system";
import { dataBr } from "./rescisaoFormato";
import "./rescisao.css";

function Linha({ rotulo, detalhe, valor, sinal }: { rotulo: string; detalhe?: ReactNode; valor: number | null; sinal?: "+" | "−" }) {
  return (
    <div className="resc-linha">
      <div>
        <div>{rotulo}</div>
        {detalhe && <div className="resc-detalhe">{detalhe}</div>}
      </div>
      <strong>{valor == null ? "—" : <>{sinal === "−" && valor > 0 ? "− " : ""}<Money value={valor} /></>}</strong>
    </div>
  );
}

// "15/09/2026 a 25/09/2026 · 9 dias · VT 2ª quinzena"
function resumoDias(a: Apuracao["vt"]): string {
  if (a.dias.length === 0) return "nenhum dia pago depois da saída";
  const lancamentos = [...new Set(a.dias.map((d) => d.lancamento))].join(", ");
  const semBaixa = a.dias.some((d) => !d.pago) ? " · parte ainda sem baixa em Contas a Pagar" : "";
  return `${dataBr(a.dias[0].data)} a ${dataBr(a.dias[a.dias.length - 1].data)} · ${a.dias.length} dia(s) · ${lancamentos}${semBaixa}`;
}

export function ApuracaoRescisaoPainel({ apuracao: a, aberto = false }: { apuracao: Apuracao; aberto?: boolean }) {
  const g = a.gorjeta;
  const valesDoMes = a.vales.itens.filter((v) => v.tipo !== "CREDITO");
  const liquido = a.sugestao.bruto == null ? null : a.sugestao.bruto - a.sugestao.vtDesconto - a.sugestao.vales;
  return (
    <details className="resc-como" open={aberto}>
      <summary>
        <span>
          Como o sistema chegou nesses valores
          <span className="resc-detalhe" style={{ display: "block" }}>
            saída em {dataBr(a.saida)} · {a.semRegistro ? "sem registro: apurado aqui, não vai à contabilidade" : "CLT: o bruto vem da contabilidade"}
          </span>
        </span>
      </summary>
      <div className="resc-quadro">
        {a.dadosPessoaisOcultos && <div className="resc-detalhe">Salário oculto: exige a permissão de ver Funcionários.</div>}
        {a.semRegistro && (
          <>
            <Linha rotulo="Salário proporcional" valor={g?.salarioProporcional ?? null} sinal="+"
              detalhe={g && g.diasSalario != null ? `diária (salário ÷ 30, arredondada) × ${g.diasSalario} dias do mês até a saída` : a.gorjetaObservacao} />
            <Linha rotulo="Gorjeta até a saída" valor={g && !g.pendente ? g.gorjeta : null} sinal="+"
              detalhe={g
                ? (g.pendente ? a.gorjetaObservacao : `${g.periodo}: ${g.pontos.toLocaleString("pt-BR")} pts × valor do ponto na saída`)
                : a.gorjetaObservacao} />
            {a.vales.creditos > 0 && <Linha rotulo="Créditos (aba Vales)" valor={a.vales.creditos} sinal="+" />}
          </>
        )}
        {!a.semRegistro && (
          <Linha rotulo="Gorjeta até a saída (conferir no TRCT)" valor={g && !g.pendente ? g.gorjeta : null}
            detalhe={g ? (g.pendente ? a.gorjetaObservacao : `${g.periodo}: ${g.pontos.toLocaleString("pt-BR")} pts · já vem no bruto da contabilidade`) : a.gorjetaObservacao} />
        )}
        <Linha rotulo={a.semRegistro ? "Vales em aberto" : "Vales do mês (só conferência)"} sinal="−"
          valor={a.semRegistro ? a.vales.descontos : null}
          detalhe={valesDoMes.length === 0
            ? "nenhum vale lançado na gorjeta do mês da saída"
            : <>
              {valesDoMes.map((v) => [v.codigo ?? v.tipo, v.data ? dataBr(v.data) : null].filter(Boolean).join(" ")).join(" · ")}
              {!a.semRegistro && <div>já descontados da gorjeta enviada à contabilidade: não abatem de novo</div>}
            </>} />
        <Linha rotulo="VT pago para depois da saída" valor={a.vt.total} sinal="−"
          detalhe={<>
            {resumoDias(a.vt)}
            {a.vt.observacao && <div>{a.vt.observacao}</div>}
            {a.vt.semDetalhe.length > 0 && <div>Sem a lista de dias (conferir à mão): {a.vt.semDetalhe.join(", ")}</div>}
          </>} />
        {a.semRegistro && (
          <div className="resc-linha resc-linha--total">
            <span>Líquido apurado</span>
            {liquido == null ? <StatusBadge tone="warning">falta a gorjeta até a saída</StatusBadge> : <strong><Money value={liquido} /></strong>}
          </div>
        )}
      </div>
    </details>
  );
}
