// Corpo do bloco "Cartões de crédito" do fechamento: um cartão por linha, com a
// situação da fatura do mês e a ação que resolve.

import { ExternalLink, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { MonthlyClosureState } from "../../api/client";
import { StatusBadge } from "../../design-system";
import { destinoDaPendencia } from "../../lib/fechamento-destinos";

type Justificativa = MonthlyClosureState["justifications"][number];

type Props = {
  cards: MonthlyClosureState["cards"];
  /** Chaves que o backend ainda acusa como pendência (as justificadas já saíram). */
  pendencias: Set<string>;
  justificativas: Map<string, Justificativa>;
  /** Pode justificar/remover: tem permissão e o mês não está travado. */
  podeAgir: boolean;
  ocupado: boolean;
  onJustificar: (chave: string, rotulo: string) => void;
  onRemover: (chave: string) => void;
};

function statusDaFatura(status: string): string {
  if (status === "OPEN") return "Aberta (não conferida)";
  if (status === "CHECKED") return "Conferida";
  if (status === "CLOSED") return "Fechada";
  if (status === "PAID") return "Paga";
  return status;
}

export function CartoesDoFechamento({ cards, pendencias, justificativas, podeAgir, ocupado, onJustificar, onRemover }: Props) {
  if (cards.cartoes.length === 0) {
    return (
      <p className="muted">
        Nenhum cartão ativo cadastrado. <Link to="/financeiro/cartoes">Cadastrar em Financeiro → Cartões</Link>.
      </p>
    );
  }

  return (
    <>
      <p className="fm-nota">
        Não se fecha o mês sem conferir a fatura de cada cartão contra o extrato.
        Marque a fatura como <strong>Conferida</strong> em Cartões; cartão que não foi usado no mês exige justificativa.
      </p>
      <table className="data-table fm-tabela fm-tabela-empilhada">
        <thead>
          <tr><th>Cartão</th><th>Fatura do mês</th><th>Situação</th></tr>
        </thead>
        <tbody>
          {cards.cartoes.map((c) => {
            const chave = `card:${c.id}`;
            const fatura = cards.faturas.find((f) => f.creditCardId === c.id && f.status !== "CANCELLED");
            const just = justificativas.get(chave);
            const pendente = pendencias.has(chave);
            // O backend tira a pendência justificada da lista: justificado e pendente
            // nunca coexistem, então a justificativa vem primeiro.
            const tone = pendente ? "danger" : just ? "warning" : "success";
            const texto = pendente ? "Pendente" : just ? "Justificado" : "Conferido";
            const destino = destinoDaPendencia(chave);
            return (
              <tr key={c.id}>
                <td data-label="Cartão">{c.name} <small className="muted">final {c.last4Digits}</small></td>
                <td data-label="Fatura do mês">
                  {fatura ? statusDaFatura(fatura.status) : "Sem fatura"}
                  {fatura && fatura.itensComDivergencia > 0 && ` · ${fatura.itensComDivergencia} com divergência`}
                </td>
                <td data-label="Situação">
                  <div className="fm-celula-situacao">
                    <StatusBadge tone={tone}>{texto}</StatusBadge>
                    <div className="fm-acoes-celula">
                      {pendente && destino && (
                        <Link to={destino.rota} className="link-btn">
                          <ExternalLink size={12} /> {destino.rotulo}
                        </Link>
                      )}
                      {podeAgir && pendente && !just && (
                        <button className="link-btn" disabled={ocupado}
                          onClick={() => onJustificar(chave, `Cartão ${c.name} (final ${c.last4Digits})`)}>
                          Justificar
                        </button>
                      )}
                      {podeAgir && just && (
                        <button className="link-btn" title={just.reason} disabled={ocupado} onClick={() => onRemover(chave)}>
                          <X size={12} /> remover
                        </button>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {cards.cartoes.filter((c) => justificativas.has(`card:${c.id}`)).map((c) => (
        <p key={c.id} className="fm-justificada">
          <span><strong>{c.name}:</strong> <em>{justificativas.get(`card:${c.id}`)?.reason}</em></span>
        </p>
      ))}
    </>
  );
}
