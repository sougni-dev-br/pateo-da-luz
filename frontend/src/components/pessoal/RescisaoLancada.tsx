// A rescisão já lançada: valores, parcelas e o que foi ajustado à mão (com o porquê).
import type { CSSProperties } from "react";
import type { ApuracaoRescisao, RescisaoLancada as Lancada, ValoresRescisaoLancada } from "../../api/client";
import { Button, Money, StatusBadge } from "../../design-system";

const muted: CSSProperties = { fontSize: 12, color: "var(--muted)" };
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dataBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type Divergencia = { rotulo: string; apurado: number; lancado: number; diferenca: number };

// Os mesmos campos que o backend confere. Salário, gorjeta e vales só para sem registro
// (CLT: vêm da contabilidade); gorjeta pendente não conta.
export function divergencias(
  sugestao: ApuracaoRescisao["sugestao"] | null | undefined,
  v: { salario: number | null; gorjeta: number | null; vales: number; vtDesconto: number },
): Divergencia[] {
  if (!sugestao) return [];
  const pares: Array<[string, number | null, number | null]> = [
    ["Salário proporcional", sugestao.salario, v.salario],
    ["Gorjeta até a saída", sugestao.gorjeta, v.gorjeta],
    ["Vales", sugestao.salario != null ? sugestao.vales : null, v.vales],
    ["VT a descontar", sugestao.vtDesconto, v.vtDesconto],
  ];
  return pares
    .filter(([, ap, la]) => ap != null && la != null && Math.abs(la - ap) >= 0.01)
    .map(([rotulo, ap, la]) => ({ rotulo, apurado: ap!, lancado: la!, diferenca: Math.round((la! - ap!) * 100) / 100 }));
}

// "gorjeta R$ 516,29 → R$ 400,00; vales R$ 0,00 → R$ 50,00" — só o que mudou.
function mudancas(antes: ValoresRescisaoLancada, depois: ValoresRescisaoLancada): string {
  const campos: Array<[string, number | null, number | null]> = [
    ["salário", antes.salario, depois.salario], ["gorjeta", antes.gorjeta, depois.gorjeta],
    ["bruto", antes.bruto, depois.bruto], ["vales", antes.vales, depois.vales],
    ["VT", antes.vtDesconto, depois.vtDesconto], ["outro desconto", antes.outroDesconto, depois.outroDesconto],
  ];
  const mudou = campos.filter(([, a, d]) => (a ?? 0) !== (d ?? 0));
  return mudou.length === 0 ? "sem mudança de valores" : mudou.map(([r, a, d]) => `${r} ${a == null ? "—" : reais(a)} → ${d == null ? "—" : reais(d)}`).join("; ");
}

export function ListaDivergencias({ itens }: { itens: Divergencia[] }) {
  return (
    <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
      {itens.map((d) => (
        <li key={d.rotulo}>
          {d.rotulo}: apurado {reais(d.apurado)} → lançado <strong>{reais(d.lancado)}</strong>{" "}
          <span style={muted}>({d.diferenca > 0 ? "+" : ""}{reais(d.diferenca)})</span>
        </li>
      ))}
    </ul>
  );
}

export function RescisaoLancadaPainel({ lancada: l, onAjustar }: { lancada: Lancada; onAjustar: () => void }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Rescisão lançada</div>
        <Button size="sm" variant="secondary" disabled={l.algumaPaga} onClick={onAjustar}
          title={l.algumaPaga ? "Há parcela paga: estorne em Contas a Pagar antes de ajustar" : undefined}>
          Ajustar rescisão
        </Button>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14, marginTop: 6 }}>
        {l.salario != null && <span>Salário <strong><Money value={l.salario} /></strong></span>}
        {l.gorjeta != null && <span>Gorjeta <strong><Money value={l.gorjeta} /></strong></span>}
        <span>Bruto <strong><Money value={l.bruto} /></strong></span>
        {l.vales > 0 && <span>Vales − <strong><Money value={l.vales} /></strong></span>}
        <span>VT − <strong><Money value={l.vtDesconto} /></strong></span>
        <span>Outro − <strong><Money value={l.outroDesconto} /></strong></span>
        <span>Líquido <strong><Money value={l.liquido} /></strong></span>
      </div>
      {l.outroDescontoRotulo && <div style={muted}>Outro desconto: {l.outroDescontoRotulo}</div>}
      <div style={{ ...muted, marginTop: 4 }}>
        {l.parcelas.map((p) => `${p.rotulo} ${reais(p.valor)} · vence ${dataBr(p.vencimento)}${p.paga ? " · paga" : ""}`).join(" | ")}
      </div>
      {l.algumaPaga && <div style={{ marginTop: 6 }}><StatusBadge tone="warning">parcela paga: ajuste só depois de estornar</StatusBadge></div>}

      {l.ajusteManual && (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <strong>Lançada com ajuste sobre o apurado</strong>
          <span style={muted}> · {l.ajusteManual.porNome ?? "—"}, {dataHora(l.ajusteManual.em)}</span>
          <ListaDivergencias itens={l.ajusteManual.divergencias} />
          <div style={{ marginTop: 2 }}>Justificativa: “{l.ajusteManual.justificativa}”</div>
        </div>
      )}

      {l.historicoAjustes.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <strong>Ajustes depois de lançada</strong>
          {l.historicoAjustes.map((a, i) => (
            <div key={i} style={{ borderTop: "1px solid var(--border)", padding: "6px 0" }}>
              <div style={muted}>{a.porNome ?? "—"} · {dataHora(a.em)}</div>
              <div>
                Líquido {reais(a.antes.liquido)} → <strong>{reais(a.depois.liquido)}</strong>
                <span style={muted}> ({mudancas(a.antes, a.depois)})</span>
              </div>
              <div>Justificativa: “{a.justificativa}”</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
