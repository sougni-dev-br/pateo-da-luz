import { useEffect, useMemo, useState } from "react";
import { getDishRevisions, type DishRevision } from "../../../api/client";
import { Money, Sparkline, StatusBadge } from "../../../design-system";
import { montarLinhaDoTempo, serieDoCusto } from "../../../lib/historicoDaFicha";

type Props = {
  pratoId: string;
  /** Muda quando a ficha é gravada: o histórico recarrega sozinho. */
  versao: string;
};

const ACAO: Record<DishRevision["action"], { rotulo: string; tom: "success" | "info" | "neutral" | "warning" }> = {
  CRIADA: { rotulo: "Criada", tom: "success" },
  ALTERADA: { rotulo: "Alterada", tom: "info" },
  INATIVADA: { rotulo: "Inativada", tom: "warning" },
  REATIVADA: { rotulo: "Reativada", tom: "neutral" }
};

function dataHora(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Linha do tempo da ficha: cada gravação com quem fez, o que mudou e quanto o custo por porção variou.
 * Carrega só quando a seção é aberta — a maioria das consultas à ficha não precisa dela.
 */
export function HistoricoDaFicha({ pratoId, versao }: Props) {
  const [aberto, setAberto] = useState(false);
  const [revisoes, setRevisoes] = useState<DishRevision[] | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    setRevisoes(null);
    setFalhou(false);
  }, [pratoId, versao]);

  useEffect(() => {
    if (!aberto || revisoes) return undefined;
    let valido = true;
    getDishRevisions(pratoId)
      .then((lista) => { if (valido) setRevisoes(lista); })
      .catch(() => { if (valido) setFalhou(true); });
    return () => { valido = false; };
  }, [aberto, revisoes, pratoId, versao]);

  const linha = useMemo(() => (revisoes ? montarLinhaDoTempo(revisoes) : []), [revisoes]);
  const serie = useMemo(() => (revisoes ? serieDoCusto(revisoes) : []), [revisoes]);
  const primeiro = serie[0]?.custo;
  const ultimo = serie[serie.length - 1]?.custo;

  return (
    <details className="ft-recolhivel" onToggle={(evento) => setAberto((evento.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className="ft-recolhivel-titulo">Histórico da ficha</span>
        <span className="ft-recolhivel-resumo">
          {revisoes ? `${revisoes.length} versão${revisoes.length === 1 ? "" : "ões"}` : "ver alterações e custo ao longo do tempo"}
        </span>
      </summary>

      <div className="ft-historico">
        {falhou && <p className="ft-nota" role="alert">Não foi possível carregar o histórico agora. Feche e abra de novo.</p>}
        {!revisoes && !falhou && <p className="ft-nota" role="status">Carregando o histórico…</p>}

        {revisoes && revisoes.length === 0 && (
          <p className="ft-nota">Este prato ainda não tem versões salvas. A partir da próxima gravação, cada alteração fica registrada aqui.</p>
        )}

        {serie.length >= 2 && primeiro != null && ultimo != null && (
          <div className="ft-historico-grafico">
            <div>
              <span className="ft-metrica-rotulo">Custo por porção ao longo do tempo</span>
              <p className="ft-historico-faixa">
                <Money value={primeiro} /> → <strong><Money value={ultimo} /></strong>
              </p>
            </div>
            <Sparkline points={serie.map((ponto) => ponto.custo)} width={160} height={36} className="ft-historico-linha" />
          </div>
        )}

        {linha.length > 0 && (
          <ol className="ft-linha-do-tempo">
            {linha.map(({ revisao, mudancas, variacaoDoCusto }) => (
              <li key={revisao.id}>
                <div className="ft-lt-topo">
                  <StatusBadge tone={ACAO[revisao.action].tom}>{ACAO[revisao.action].rotulo}</StatusBadge>
                  <time dateTime={revisao.createdAt}>{dataHora(revisao.createdAt)}</time>
                  <span className="ft-lt-quem">{revisao.userName ?? "—"}</span>
                  {revisao.costPerServing != null && revisao.snapshot.items.length > 0 && (
                    <span className="ft-lt-custo">
                      <Money value={revisao.costPerServing} />
                      {revisao.snapshot.custoIncompleto && <small> parcial</small>}
                      {variacaoDoCusto != null && Math.abs(variacaoDoCusto) >= 0.005 && (
                        <small className={variacaoDoCusto > 0 ? "ft-lt-sobe" : "ft-lt-desce"}>
                          {variacaoDoCusto > 0 ? " ▲ " : " ▼ "}
                          <Money value={Math.abs(variacaoDoCusto)} />
                        </small>
                      )}
                    </span>
                  )}
                </div>
                <ul>{mudancas.map((frase, indice) => <li key={indice}>{frase}</li>)}</ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
