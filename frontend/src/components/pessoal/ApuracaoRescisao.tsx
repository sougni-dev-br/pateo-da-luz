// O que o sistema apurou para a rescisão: VT pago para depois da saída, vales em
// aberto, salário proporcional e gorjeta até a saída. Cada número diz de onde veio.
import type { CSSProperties, ReactNode } from "react";
import type { ApuracaoRescisao as Apuracao } from "../../api/client";
import { Button, Money, StatusBadge } from "../../design-system";

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const muted: CSSProperties = { fontSize: 12, color: "var(--muted)" };
const linha: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", padding: "6px 0" };

function Linha({ rotulo, detalhe, valor, sinal }: { rotulo: string; detalhe?: ReactNode; valor: number | null; sinal?: "+" | "−" }) {
  return (
    <div style={{ ...linha, borderTop: "1px solid var(--border)" }}>
      <div>
        <div style={{ fontSize: 14 }}>{rotulo}</div>
        {detalhe && <div style={muted}>{detalhe}</div>}
      </div>
      <strong style={{ fontSize: 14, whiteSpace: "nowrap" }}>
        {valor == null ? "—" : <>{sinal === "−" && valor > 0 ? "− " : ""}<Money value={valor} /></>}
      </strong>
    </div>
  );
}

// "15/09 a 25/09 · 9 dias (1ª e 2ª quinzena)"
function resumoDias(a: Apuracao["vt"]): string {
  if (a.dias.length === 0) return "nenhum dia pago depois da saída";
  const lancamentos = [...new Set(a.dias.map((d) => d.lancamento))].join(", ");
  const naoPagos = a.dias.some((d) => !d.pago) ? " · parte ainda sem baixa em Contas a Pagar" : "";
  return `${dataBr(a.dias[0].data)} a ${dataBr(a.dias[a.dias.length - 1].data)} · ${a.dias.length} dia(s) · ${lancamentos}${naoPagos}`;
}

export function ApuracaoRescisaoPainel({ apuracao: a, onUsar }: { apuracao: Apuracao; onUsar: () => void }) {
  const g = a.gorjeta;
  const valesDoMes = a.vales.itens.filter((v) => v.tipo !== "CREDITO");
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Apurado pelo sistema</div>
          <div style={muted}>Saída em {dataBr(a.saida)} · {a.semRegistro
            ? "sem registro: o sistema monta o valor, nada vai para a contabilidade"
            : "CLT: o bruto vem da contabilidade; aqui entra o desconto do VT"}</div>
        </div>
        <Button size="sm" variant="secondary" onClick={onUsar}>Usar estes valores</Button>
      </div>

      {a.semRegistro && (
        <>
          <Linha rotulo="Salário proporcional" valor={g?.salarioProporcional ?? null} sinal="+"
            detalhe={g ? `salário ÷ 30 × ${g.diasSalario} dias até a saída` : a.gorjetaObservacao} />
          <Linha rotulo="Gorjeta até a saída" valor={g && !g.pendente ? g.gorjeta : null} sinal="+"
            detalhe={g
              ? (g.pendente ? a.gorjetaObservacao : `${g.periodo}: ${g.pontos.toLocaleString("pt-BR")} pts × R$ ${g.valorPonto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`)
              : a.gorjetaObservacao} />
          {a.vales.creditos > 0 && <Linha rotulo="Créditos (aba Vales)" valor={a.vales.creditos} sinal="+" />}
        </>
      )}

      {!a.semRegistro && (
        <Linha rotulo="Gorjeta até a saída (conferir no TRCT)" valor={g && !g.pendente ? g.gorjeta : null}
          detalhe={g
            ? (g.pendente ? a.gorjetaObservacao : `${g.periodo}: ${g.pontos.toLocaleString("pt-BR")} pts × R$ ${g.valorPonto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · entra no bruto da contabilidade`)
            : a.gorjetaObservacao} />
      )}
      <Linha rotulo={a.semRegistro ? "Vales em aberto" : "Vales do mês (só conferência)"} sinal="−"
        valor={a.semRegistro ? a.vales.descontos : null}
        detalhe={valesDoMes.length === 0
          ? "nenhum vale lançado no mês da saída"
          : <>
            {valesDoMes.map((v) => `${v.codigo ?? v.tipo} ${v.data ? dataBr(v.data) : ""} (R$ ${v.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`).join(" · ")}
            {!a.semRegistro && <div>já descontados da gorjeta enviada à contabilidade: não abatem de novo aqui</div>}
          </>} />

      <Linha rotulo="VT pago para depois da saída" valor={a.vt.total} sinal="−"
        detalhe={<>
          {resumoDias(a.vt)}
          {a.vt.observacao && <div>{a.vt.observacao}</div>}
          {a.vt.semDetalhe.length > 0 && <div>Sem a lista de dias (conferir à mão): {a.vt.semDetalhe.join(", ")}</div>}
        </>} />

      {a.semRegistro && (
        <div style={{ ...linha, borderTop: "1px solid var(--border-strong, var(--border))", paddingTop: 8 }}>
          <span style={{ fontWeight: 600 }}>Líquido apurado</span>
          {a.sugestao.bruto == null
            ? <StatusBadge tone="warning">falta a gorjeta até a saída</StatusBadge>
            : <strong style={{ fontSize: 16 }}><Money value={a.sugestao.bruto - a.sugestao.vtDesconto - a.sugestao.vales} /></strong>}
        </div>
      )}
    </div>
  );
}
