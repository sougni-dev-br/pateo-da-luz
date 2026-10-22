// Linhas de um fornecedor obrigatório na tabela do fechamento.
//
// Fornecedor simples: uma linha ("teve alguma compra no mês?"). Fornecedor com
// lançamentos obrigatórios (ex.: condomínio do shopping = condomínio do mês + parcela
// do acordo): a linha do fornecedor resume e cada lançamento ganha a sua, com a sua
// situação e o seu botão de justificar — os dois precisam aparecer, não um só.

import { X } from "lucide-react";
import type { MonthlyClosureRequiredSupplier, MonthlyClosureState } from "../../api/client";
import { Money, StatusBadge } from "../../design-system";
import { chaveDaExigencia } from "../../lib/fechamento-exigencias";

type Justificativa = MonthlyClosureState["justifications"][number];

type Props = {
  fornecedor: MonthlyClosureRequiredSupplier;
  justificativas: Map<string, Justificativa>;
  podeAgir: boolean;
  ocupado: boolean;
  onJustificar: (chave: string, rotulo: string) => void;
  onRemover: (chave: string) => void;
};

function frequencia(freq: string): string {
  if (freq === "MONTHLY") return "Mensal";
  if (freq === "QUARTERLY") return "Trimestral";
  if (freq === "ANNUAL") return "Anual";
  return freq;
}

export function LinhasDoFornecedor({ fornecedor: s, justificativas, podeAgir, ocupado, onJustificar, onRemover }: Props) {
  const chave = `supplier:${s.id}`;
  const just = justificativas.get(chave);
  const exigencias = s.requirements ?? [];
  const tone = !s.appliesThisMonth ? "neutral" : s.present ? "success" : just ? "warning" : "danger";
  const texto = !s.appliesThisMonth ? "Não aplica"
    : s.present ? `Lançado (${s.purchaseCount})`
    : just ? "Justificado" : "Pendente";

  return (
    <>
      <tr>
        <td data-label="Fornecedor">{s.name}</td>
        <td data-label="Frequência">{frequencia(s.frequency)}</td>
        <td data-label="Situação"><StatusBadge tone={tone}>{s.usaExigencias && !s.present && s.appliesThisMonth ? "Incompleto" : texto}</StatusBadge></td>
        <td data-label="Total" className="num">{s.total > 0 ? <Money value={s.total} /> : "—"}</td>
        <td className="num">
          {/* Com lançamentos obrigatórios cada um é justificado na sua linha. */}
          {!s.usaExigencias && podeAgir && s.appliesThisMonth && !s.present && !just && (
            <button className="link-btn" disabled={ocupado} onClick={() => onJustificar(chave, `Fornecedor: ${s.name}`)}>
              Justificar
            </button>
          )}
          {!s.usaExigencias && podeAgir && just && (
            <button className="link-btn" title={just.reason} disabled={ocupado} onClick={() => onRemover(chave)}>
              <X size={12} /> remover
            </button>
          )}
        </td>
      </tr>

      {exigencias.map((e) => {
        const chaveDoLancamento = chaveDaExigencia(s.id, e.id);
        const justLancamento = justificativas.get(chaveDoLancamento);
        const cobrada = s.appliesThisMonth && !e.quitada;
        const toneDoLancamento = e.quitada || !s.appliesThisMonth ? "neutral"
          : e.present ? "success" : justLancamento ? "warning" : "danger";
        const textoDoLancamento = e.quitada ? "Quitado"
          : !s.appliesThisMonth ? "Não aplica"
          : e.present ? `Lançado (${e.purchaseCount})`
          : justLancamento ? "Justificado" : "Pendente";
        return (
          <tr key={e.id} className={`fm-exigencia${e.quitada ? " fm-exigencia-quitada" : ""}`}>
            <td data-label="Lançamento" className="fm-exigencia-nome">
              <span className="fm-exigencia-texto">
                <span className="fm-exigencia-rotulo"><span aria-hidden="true">↳ </span>{e.label}</span>
                <small className="muted">produto: {e.productName}</small>
              </span>
            </td>
            <td data-label="Frequência" className="fm-exigencia-vazio" />
            <td data-label="Situação"><StatusBadge tone={toneDoLancamento}>{textoDoLancamento}</StatusBadge></td>
            <td data-label="Total" className="num">{e.present ? <Money value={e.total} /> : "—"}</td>
            <td className="num">
              {podeAgir && cobrada && !e.present && !justLancamento && (
                <button className="link-btn" disabled={ocupado}
                  onClick={() => onJustificar(chaveDoLancamento, `Fornecedor: ${s.name} — ${e.label}`)}>
                  Justificar
                </button>
              )}
              {podeAgir && justLancamento && (
                <button className="link-btn" title={justLancamento.reason} disabled={ocupado} onClick={() => onRemover(chaveDoLancamento)}>
                  <X size={12} /> remover
                </button>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
