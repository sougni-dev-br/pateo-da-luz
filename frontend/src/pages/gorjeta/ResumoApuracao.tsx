import type { CSSProperties, ReactNode } from "react";
import type { TipComputation } from "../../api/client";
import { money, pts } from "./gorjetaUtils";

// A conta inteira à vista: serviço − retenção = líquido − rescisões ÷ pontos que
// sobram = valor do ponto;
// e embaixo, para onde foi cada real do líquido. Tudo que aparece aqui soma: se
// não fechar com a planilha, a diferença fica visível em qual fatia está.

const termo: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2, padding: "10px 14px", minWidth: 0,
  background: "var(--surface, #fff)", border: "1px solid var(--border)", borderRadius: 10,
};
const rotulo: CSSProperties = { fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" };
const valor: CSSProperties = { fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

function Termo({ label, children, destaque, detalhe, acao }: {
  label: string; children: ReactNode; destaque?: string; detalhe?: ReactNode; acao?: ReactNode;
}) {
  return (
    <div style={{ ...termo, ...(destaque ? { borderColor: destaque, boxShadow: `inset 3px 0 0 ${destaque}` } : null) }}>
      <span style={{ ...rotulo, display: "flex", justifyContent: "space-between", gap: 6 }}>{label}{acao}</span>
      <span style={{ ...valor, color: destaque }}>{children}</span>
      {detalhe && <span style={{ ...rotulo, fontSize: 11, whiteSpace: "normal" }}>{detalhe}</span>}
    </div>
  );
}

type Fatia = { chave: string; label: string; valor: number; detalhe: string; cor: string; hachurado?: boolean };

type ResumoProps = { comp: TipComputation; compacto?: boolean; onAjustarServico?: () => void };

export function ResumoApuracao({ comp, compacto = false, onAjustarServico }: ResumoProps) {
  const temRescisao = comp.rescisoes.pontos > 0 || comp.rescisoes.valor > 0;
  const ajustado = Math.abs(comp.ajusteServico) >= 0.005;
  const retido = Math.round((comp.grossPool - comp.netPool) * 100) / 100;
  const c = comp.composicao;
  const estourou = comp.saldo < -0.005;

  const fatias: Fatia[] = [
    { chave: "mes", label: "Equipe no mês", valor: c.mes.valor, detalhe: `${c.mes.pessoas} pessoas · ${pts(c.mes.pontos)} pts`, cor: "var(--info)" },
    { chave: "resc", label: "Rescisões", valor: c.rescisoes.valor, cor: "#6b7a90",
      detalhe: `${c.rescisoes.pessoas} pessoas${c.rescisoes.pendentes ? ` · ${c.rescisoes.pendentes} pendente(s)` : ""}` },
    { chave: "fixo", label: "Cotas fixas", valor: c.fixos.valor, detalhe: `${c.fixos.pessoas} pessoas`, cor: "#8c7a5b" },
    { chave: "reserva", label: "Reserva da casa", valor: c.reserva.valor, detalhe: `${pts(c.reserva.pontos)} pts`, cor: "var(--gold)" },
    { chave: "saldo", label: estourou ? "Estouro" : "Saldo não distribuído", valor: Math.abs(comp.saldo), cor: estourou ? "var(--danger)" : "var(--warning)",
      detalhe: estourou ? "passa do líquido" : "fica retido no fechamento", hachurado: true },
  ].filter((f) => f.valor > 0.004 || f.chave === "mes" || f.chave === "saldo" || (f.chave === "resc" && c.rescisoes.pessoas > 0));

  const base = Math.max(comp.netPool, comp.distribuido, 0.01);

  if (compacto) {
    const itens: Array<[string, string, string | undefined]> = [
      ["Serviço", money(comp.grossPool), undefined],
      [`Líquido (−${comp.deductionPercent.toLocaleString("pt-BR")}%)`, money(comp.netPool), "var(--info)"],
      ...(temRescisao ? [["Rescisões", `− ${money(comp.rescisoes.valor)}`, undefined] as [string, string, string | undefined]] : []),
      [`Ponto (÷ ${pts(comp.pontosDisponiveis)})`, money(comp.pointValue), "var(--gold)"],
      ["Distribuído", money(comp.distribuido), undefined],
      [estourou ? "Estouro" : "Saldo", money(Math.abs(comp.saldo)), estourou ? "var(--danger)" : "var(--warning)"],
    ];
    return (
      <section aria-label="Resumo da apuração" className="resumo-compacto">
        {itens.map(([l, v, cor]) => (
          <span key={l}><span className="resumo-compacto-rotulo">{l}</span> <strong style={{ color: cor }}>{v}</strong></span>
        ))}
      </section>
    );
  }

  return (
    <section aria-label="Resumo da apuração" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, alignItems: "stretch" }}>
        <Termo label="Serviço arrecadado"
          acao={onAjustarServico && (
            <button type="button" className="barra-lista-link" onClick={onAjustarServico} style={{ fontSize: 11 }}>ajustar</button>
          )}
          detalhe={ajustado
            ? <>faturamento {money(comp.servicoFaturamento)} <strong style={{ color: comp.ajusteServico > 0 ? "var(--success)" : "var(--danger)" }}>
                {comp.ajusteServico > 0 ? "+" : "−"} {money(Math.abs(comp.ajusteServico))}</strong> de ajuste</>
            : "do faturamento"}>
          {money(comp.grossPool)}
        </Termo>
        <Termo label={`Retenção ${comp.deductionPercent.toLocaleString("pt-BR")}%`}>− {money(retido)}</Termo>
        <Termo label="Líquido a distribuir" destaque="var(--info)">{money(comp.netPool)}</Termo>
        {temRescisao && (
          <Termo label="Rescisões (saem antes)" detalhe={`${pts(comp.rescisoes.pontos)} pts com o valor do ponto de cada saída`}>
            − {money(comp.rescisoes.valor)}
          </Termo>
        )}
        <Termo label={temRescisao ? "Pontos que sobram" : "Pontos de referência"}
          detalhe={temRescisao ? `${pts(comp.pointsBudget)} − ${pts(comp.rescisoes.pontos)} das rescisões` : undefined}>
          ÷ {pts(comp.pontosDisponiveis)}
        </Termo>
        <Termo label="Valor do ponto" destaque="var(--gold)"
          detalhe={comp.fixedTotal > 0 ? `depois de ${money(comp.fixedTotal)} em cotas fixas` : undefined}>
          {money(comp.pointValue)}
        </Termo>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>Para onde vai o líquido</strong>
          <span style={{ fontSize: 13, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            distribuído {money(comp.distribuido)} {estourou ? "+" : "+ saldo"} {money(Math.abs(comp.saldo))}
            {estourou ? " além do" : " ="} líquido {money(comp.netPool)}
          </span>
        </div>
        <div role="img" aria-label="Composição do líquido"
          style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "var(--paper-soft, #f2f4f7)" }}>
          {fatias.map((f) => (
            <div key={f.chave} title={`${f.label}: ${money(f.valor)}`}
              style={{
                width: `${(f.valor / base) * 100}%`, background: f.cor, minWidth: f.valor > 0 ? 3 : 0,
                backgroundImage: f.hachurado ? "repeating-linear-gradient(135deg, rgba(255,255,255,.45) 0 4px, transparent 4px 8px)" : undefined,
              }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {fatias.map((f) => (
            <div key={f.chave} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: f.cor, marginTop: 4, flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{f.label}</span>
                <strong style={{ fontVariantNumeric: "tabular-nums", color: f.chave === "saldo" && estourou ? "var(--danger)" : undefined }}>
                  {f.chave === "saldo" && estourou ? "− " : ""}{money(f.valor)}
                </strong>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{f.detalhe}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
