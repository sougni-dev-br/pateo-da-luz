import { BellRing, Pin, Repeat, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  deleteBuffetPlatePrint, getBuffetPlatePrints, type BuffetPlateItem, type BuffetPlatePrint, type BuffetUsageRow, type PlateListKind,
} from "../../../api/client";
import { Alert, Button, EmptyState } from "../../../design-system";
import { JANELAS, dataCurtaIso, useAcompanhamento, vezes, type Janela } from "./acompanhamento";
import { TIPOS_LISTA } from "./plaquinhasFormato";

const RANKING_INICIAL = 15;

type Props = {
  ativa: boolean;
  catalogo: BuffetPlateItem[];
  podeExcluir: boolean;
  versao: number;
  aoMudar: () => void;
};

// Acompanhamento: o que a cozinha tem feito, a partir das plaquinhas impressas. Conta dias,
// não impressões. Os mesmos números alimentam o alerta na hora de montar a folha.
export function AcompanhamentoPratos({ ativa, catalogo, podeExcluir, versao, aoMudar }: Props) {
  const [tipo, setTipo] = useState<PlateListKind>("BUFFET");
  const [janela, setJanela] = useState<Janela>(30);
  const [ordem, setOrdem] = useState<"mais" | "menos">("mais");
  const [todos, setTodos] = useState(false);
  const { relatorio, carregando, erro } = useAcompanhamento(tipo, janela, versao, ativa);
  const porId = useMemo(() => new Map(catalogo.map((p) => [p.id, p])), [catalogo]);
  const nome = (id: string) => porId.get(id)?.namePt ?? "Prato apagado";
  const rotuloTipo = TIPOS_LISTA.find((t) => t.value === tipo)?.label.toLowerCase() ?? "";

  // Prato inativado saiu de propósito: não é esquecimento.
  const esquecidos = useMemo(() => (relatorio?.forgotten ?? []).filter((f) => porId.get(f.itemId)?.isActive), [relatorio, porId]);
  const ranking = useMemo(() => {
    const linhas = relatorio?.ranking ?? [];
    return ordem === "mais" ? linhas : [...linhas].reverse();
  }, [relatorio, ordem]);

  return (
    <div className="acp">
      <div className="acp-filtros">
        <div className="plq-segmento" role="group" aria-label="Tipo de lista">
          {TIPOS_LISTA.map((t) => <button key={t.value} type="button" aria-pressed={tipo === t.value} onClick={() => setTipo(t.value)}>{t.label}</button>)}
        </div>
        <div className="plq-segmento" role="group" aria-label="Período">
          {JANELAS.map((j) => <button key={j.dias} type="button" aria-pressed={janela === j.dias} onClick={() => setJanela(j.dias)}>{j.rotulo}</button>)}
        </div>
      </div>

      {erro && <Alert tone="error">{erro}</Alert>}
      {carregando && !relatorio && <p className="plq-contagem">Carregando o acompanhamento…</p>}

      {relatorio && (
        <>
          <p className="acp-resumo">
            {relatorio.period.servedDays
              ? <><strong>{vezes(relatorio.period.servedDays)}</strong> de {rotuloTipo} registrados entre {dataCurtaIso(relatorio.period.start)} e {dataCurtaIso(relatorio.period.end)}</>
              : <>Nenhum dia de {rotuloTipo} registrado nos últimos {relatorio.period.windowDays} dias.</>}
          </p>

          {relatorio.period.servedDays === 0 && relatorio.forgotten.length === 0 ? (
            <EmptyState title="Ainda sem registros"
              description="Cada vez que a cozinha imprime as plaquinhas, o ERP anota os pratos daquele dia. Com alguns dias registrados, aparecem aqui os pratos mais feitos, os que estão repetindo e os que ficaram esquecidos." />
          ) : (
            <>
              <div className="acp-cartoes">
                <section className="acp-cartao acp-cartao--esquecido" aria-labelledby="acp-esq">
                  <h3 id="acp-esq"><BellRing size={16} aria-hidden="true" /> Esquecidos</h3>
                  <p className="acp-explica">Saíam com frequência e não saem há duas semanas ou mais.</p>
                  {esquecidos.length ? (
                    <ul>{esquecidos.map((f) => (
                      <li key={f.itemId}><span>{nome(f.itemId)}</span><small>há {f.daysSince} dias · saiu {vezes(f.daysInHistory)} em 3 meses</small></li>
                    ))}</ul>
                  ) : <p className="plq-vazio">Nenhum prato esquecido.</p>}
                </section>
                <section className="acp-cartao acp-cartao--repete" aria-labelledby="acp-rep">
                  <h3 id="acp-rep"><Repeat size={16} aria-hidden="true" /> Saindo demais</h3>
                  <p className="acp-explica">Em 40% dos dias ou mais, sem ser base do buffet.</p>
                  <ListaPorDias ids={relatorio.repeating} ranking={relatorio.ranking} nome={nome} total={relatorio.period.servedDays} vazio="Nada repetindo demais." />
                </section>
                <section className="acp-cartao" aria-labelledby="acp-base">
                  <h3 id="acp-base"><Pin size={16} aria-hidden="true" /> Base do buffet</h3>
                  <p className="acp-explica">Sai em quase todos os dias: é esperado, não é alerta.</p>
                  <ListaPorDias ids={relatorio.staples} ranking={relatorio.ranking} nome={nome} total={relatorio.period.servedDays} vazio="Precisa de pelo menos 5 dias registrados." />
                </section>
              </div>

              {ranking.length > 0 && (
                <section className="acp-ranking" aria-labelledby="acp-rank">
                  <div className="acp-ranking-topo">
                    <h3 id="acp-rank">Pratos do período</h3>
                    <div className="plq-segmento" role="group" aria-label="Ordem">
                      <button type="button" aria-pressed={ordem === "mais"} onClick={() => setOrdem("mais")}>Mais usados</button>
                      <button type="button" aria-pressed={ordem === "menos"} onClick={() => setOrdem("menos")}>Menos usados</button>
                    </div>
                  </div>
                  <ol>
                    {(todos ? ranking : ranking.slice(0, RANKING_INICIAL)).map((r) => (
                      <LinhaRanking key={r.itemId} linha={r} prato={porId.get(r.itemId)} total={relatorio.period.servedDays} />
                    ))}
                  </ol>
                  {ranking.length > RANKING_INICIAL && (
                    <button type="button" className="plq-link" onClick={() => setTodos((v) => !v)}>
                      {todos ? "Mostrar menos" : `Ver os ${ranking.length} pratos`}
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}

      <Registros tipo={tipo} versao={versao} ativa={ativa} podeExcluir={podeExcluir} aoMudar={aoMudar} />
    </div>
  );
}

function ListaPorDias({ ids, ranking, nome, total, vazio }: { ids: string[]; ranking: BuffetUsageRow[]; nome: (id: string) => string; total: number; vazio: string }) {
  if (!ids.length) return <p className="plq-vazio">{vazio}</p>;
  const dias = new Map(ranking.map((r) => [r.itemId, r.days]));
  return <ul>{ids.map((id) => <li key={id}><span>{nome(id)}</span><small>{dias.get(id)} de {total} dias</small></li>)}</ul>;
}

function LinhaRanking({ linha, prato, total }: { linha: BuffetUsageRow; prato: BuffetPlateItem | undefined; total: number }) {
  const pct = Math.round(linha.share * 100);
  return (
    <li className="acp-linha">
      <span className="acp-linha-nome">{prato?.namePt ?? "Prato apagado"}<small>{prato?.category}</small></span>
      <span className="acp-barra" aria-hidden="true"><i style={{ width: `${Math.max(pct, 2)}%` }} /></span>
      <span className="acp-linha-num">{linha.days} de {total} <small>último {dataCurtaIso(linha.lastDay)}</small></span>
    </li>
  );
}

// Os últimos registros, para desfazer uma impressão que foi para o lixo.
function Registros({ tipo, versao, ativa, podeExcluir, aoMudar }: { tipo: PlateListKind; versao: number; ativa: boolean; podeExcluir: boolean; aoMudar: () => void }) {
  const [registros, setRegistros] = useState<BuffetPlatePrint[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!ativa) return undefined;
    let vivo = true;
    getBuffetPlatePrints(tipo).then((r) => { if (vivo) { setRegistros(r); setErro(null); } })
      .catch((x) => { if (vivo) setErro(x instanceof Error ? x.message : "Não foi possível carregar os registros."); });
    return () => { vivo = false; };
  }, [tipo, versao, ativa]);

  async function apagar(r: BuffetPlatePrint) {
    if (!window.confirm(`Apagar o registro de ${dataCurtaIso(r.servedOn)} (${r.listName ?? "lista sem nome"})? Os pratos dele deixam de contar no acompanhamento.`)) return;
    try {
      await deleteBuffetPlatePrint(r.id);
      aoMudar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível apagar o registro.");
    }
  }

  if (!registros.length && !erro) return null;
  return (
    <section className="acp-registros" aria-labelledby="acp-reg">
      <h3 id="acp-reg">Últimas impressões registradas</h3>
      <p className="acp-explica">Cada clique em Imprimir conta, mesmo se a impressão for cancelada. Imprimiu e jogou fora? Apague o registro para ele não contar.</p>
      {erro && <Alert tone="error">{erro}</Alert>}
      <ul>
        {registros.map((r) => (
          <li key={r.id}>
            <span><strong>{dataCurtaIso(r.servedOn)}</strong> {r.listName ?? "Lista sem nome"}</span>
            <small>{r.itemCount} {r.itemCount === 1 ? "prato" : "pratos"}</small>
            {podeExcluir && (
              <Button variant="icon" size="sm" aria-label={`Apagar o registro de ${dataCurtaIso(r.servedOn)}`} title="Apagar registro" onClick={() => apagar(r)}>
                <Trash2 size={15} />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
