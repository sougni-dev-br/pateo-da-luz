// Resultado do buffet: o que as pesagens mostram por dia e por prato (produzido, sobra, consumido, custo e retorno por
// pessoa) e o planejamento do próximo buffet. Valores em R$ só chegam do servidor para quem tem permissão de custos.
import { useEffect, useMemo, useRef, useState } from "react";
import { getBuffetAnalysis, type BuffetAnalysis, type BuffetAnalysisItem, type BuffetAnalysisSignal, type PlateListKind } from "../../../api/client";
import { Alert, EmptyState, Money, Select } from "../../../design-system";
import { PlanejarBuffet } from "./PlanejarBuffet";
import { kgTexto } from "./pesagemFormato";
import { TIPOS_LISTA } from "./plaquinhasFormato";

type Props = { ativa: boolean };

const JANELAS = [7, 30, 90] as const;
/** Abaixo disso os padrões ainda são fracos: a tela avisa. */
const DIAS_CONFIAVEIS = 10;
const hojeSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const somarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`);
const gramas = (g: number | null) => (g === null ? "—" : `${g} g`);

const SINAL: Record<BuffetAnalysisSignal, { texto: string; tom: "alerta" | "atencao" | "neutro" }> = {
  SOBRA_ALTA: { texto: "Sobra alta: fazer menos", tom: "alerta" },
  PODE_FALTAR: { texto: "Quase não sobra: pode ter acabado", tom: "atencao" },
  POUCOS_DIAS: { texto: "Poucos dias pesados", tom: "neutro" },
};

type Ordem = "producao" | "sobra" | "custoPessoa" | "perda";
const ORDENS: Array<{ value: Ordem; label: string }> = [
  { value: "producao", label: "Mais produzido" }, { value: "sobra", label: "Maior sobra (%)" },
  { value: "custoPessoa", label: "Maior custo por pessoa" }, { value: "perda", label: "Maior sobra em R$" },
];
const valorDaOrdem = (i: BuffetAnalysisItem, o: Ordem) => (o === "producao" ? i.producedG : o === "sobra" ? i.leftoverPct ?? -1 : o === "custoPessoa" ? i.costPerPerson ?? -1 : i.leftoverCost ?? -1);

export function ResultadoBuffet({ ativa }: Props) {
  const [dias, setDias] = useState<(typeof JANELAS)[number]>(30);
  const [tipo, setTipo] = useState<PlateListKind>("BUFFET");
  const [ordem, setOrdem] = useState<Ordem>("producao");
  const [dados, setDados] = useState<BuffetAnalysis | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const chaveCarregada = useRef("");

  useEffect(() => {
    if (!ativa) return undefined;
    let ok = true;
    const to = hojeSaoPaulo();
    // Filtro novo limpa o resultado (senão o período anterior ficaria na tela com o filtro novo). Voltar para a aba com o
    // mesmo filtro só atualiza por baixo: o que a pessoa digitou no planejamento não some.
    const chave = `${dias}-${tipo}`;
    if (chaveCarregada.current !== chave) { setDados(null); chaveCarregada.current = chave; }
    setErro(null);
    getBuffetAnalysis(somarDias(to, -(dias - 1)), to, tipo)
      .then((d) => { if (ok) setDados(d); })
      .catch((x) => { if (ok) { chaveCarregada.current = ""; setErro(x instanceof Error ? x.message : "Não foi possível carregar o resultado."); } });
    return () => { ok = false; };
  }, [ativa, dias, tipo]);

  const pratos = useMemo(() => [...(dados?.items ?? [])].sort((a, b) => valorDaOrdem(b, ordem) - valorDaOrdem(a, ordem)), [dados, ordem]);
  const semSobra = (dados?.items ?? []).filter((i) => i.daysWithLeftover === 0).length;
  const pessoasMedia = dados && dados.summary.daysWithPeople > 0 ? Math.round(dados.summary.people / dados.summary.daysWithPeople) : null;
  const verCusto = dados?.costVisible ?? false;
  const r = dados?.summary;

  return (
    <div className="pes res">
      <div className="acp-filtros">
        <div className="plq-segmento" role="group" aria-label="Período">
          {JANELAS.map((j) => <button key={j} type="button" aria-pressed={dias === j} aria-label={`Últimos ${j} dias`} onClick={() => setDias(j)}>{j} dias</button>)}
        </div>
        <Select aria-label="Tipo" value={tipo} options={TIPOS_LISTA} onChange={(e) => setTipo(e.target.value as PlateListKind)} />
      </div>

      {erro && <Alert tone="error">{erro}</Alert>}
      {!dados && !erro && <p className="plq-contagem" role="status">Carregando o resultado…</p>}

      {dados && r && r.days === 0 && (
        <EmptyState title="Nenhuma pesagem neste período" description="Pese a produção e a sobra do buffet na aba Pesagem. Com alguns dias de dados, aparecem aqui o consumo, a sobra e o custo por pessoa." />
      )}

      {dados && r && r.days > 0 && (
        <>
          {r.days < DIAS_CONFIAVEIS && <Alert tone="info">Só {r.days} dia{r.days === 1 ? "" : "s"} pesado{r.days === 1 ? "" : "s"} no período. Os padrões ficam mais confiáveis com {DIAS_CONFIAVEIS} dias ou mais.</Alert>}
          {semSobra > 0 && <Alert tone="warning">{semSobra} prato{semSobra === 1 ? "" : "s"} sem sobra pesada: o consumo {semSobra === 1 ? "dele" : "deles"} não entra nas contas. Pese a sobra no fim do serviço (panela vazia vale zero).</Alert>}
          {dados.kind !== "BUFFET" && <Alert tone="info">Coffee break e evento não têm pessoas nem receita no PDV: aparecem só os quilos{verCusto ? " e o custo" : ""}.</Alert>}

          <section className="plq-bloco" aria-labelledby="res-resumo">
            <h3 className="plq-bloco-titulo" id="res-resumo"><span>Resumo</span><span>{dataBr(dados.from)} a {dataBr(dados.to)}</span></h3>
            <dl className="res-cartoes">
              <div><dt>Dias pesados</dt><dd>{r.days}</dd></div>
              {dados.kind === "BUFFET" && <div><dt>Pessoas (PDV)</dt><dd>{r.people.toLocaleString("pt-BR")}</dd></div>}
              <div><dt>Consumido</dt><dd>{kgTexto(r.consumedG)}</dd></div>
              <div><dt>Sobra</dt><dd>{pct(r.leftoverPct)}</dd></div>
              <div><dt>Por pessoa</dt><dd>{gramas(r.gPerPerson)}</dd></div>
              {verCusto && <div><dt>Custo por pessoa</dt><dd>{r.costPerPerson === null ? "—" : <Money value={r.costPerPerson} />}</dd></div>}
              {verCusto && dados.kind === "BUFFET" && <div><dt>Receita por pessoa</dt><dd>{r.revenuePerPerson === null ? "—" : <Money value={r.revenuePerPerson} />}</dd></div>}
              {verCusto && dados.kind === "BUFFET" && <div className="res-destaque"><dt>Margem por pessoa</dt><dd>{r.marginPerPerson === null ? "—" : <Money value={r.marginPerPerson} />}</dd></div>}
              {verCusto && <div><dt>Sobra em R$</dt><dd>{r.leftoverCost === null ? "—" : <Money value={r.leftoverCost} />}</dd></div>}
            </dl>
            {verCusto && (
              <p className="plq-contagem">
                Custo por pessoa = o que foi produzido (inclui o que sobrou) ÷ pessoas, pelo custo de hoje das fichas. Custo e margem usam só os dias em que
                todos os pratos têm ficha pronta: {r.daysWithFullCost} de {r.daysWithPeople} dia{r.daysWithPeople === 1 ? "" : "s"} com pessoas no PDV.
              </p>
            )}
          </section>

          <section className="plq-bloco" aria-labelledby="res-pratos">
            <h3 className="plq-bloco-titulo" id="res-pratos"><span>Por prato</span></h3>
            <Select label="Ordenar por" value={ordem} options={ORDENS.filter((o) => verCusto || (o.value !== "custoPessoa" && o.value !== "perda"))} onChange={(e) => setOrdem(e.target.value as Ordem)} />
            <div className="pes-tabela-rolagem">
              <table className="pes-tabela">
                <thead><tr><th>Prato</th><th>Dias</th><th>Sobra</th><th>Por pessoa</th>{verCusto && <th>R$/kg</th>}{verCusto && <th>R$/pessoa</th>}{verCusto && <th>Sobra em R$</th>}</tr></thead>
                <tbody>
                  {pratos.map((p) => (
                    <tr key={p.itemId}>
                      <td>
                        {p.name}
                        {p.signals.map((s) => <small key={s} className={`res-sinal res-sinal--${SINAL[s].tom}`}> · {SINAL[s].texto}</small>)}
                      </td>
                      <td>{p.days}</td><td>{pct(p.leftoverPct)}</td><td>{gramas(p.gPerPerson)}</td>
                      {verCusto && <td>{p.costPerKg === null ? <small>sem custo</small> : <Money value={p.costPerKg} />}</td>}
                      {verCusto && <td>{p.costPerPerson === null ? "—" : <Money value={p.costPerPerson} />}</td>}
                      {verCusto && <td>{p.leftoverCost === null ? "—" : <Money value={p.leftoverCost} />}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="plq-bloco res-dias">
            <summary className="plq-bloco-titulo">Por dia ({dados.days.length})</summary>
            <div className="pes-tabela-rolagem">
              <table className="pes-tabela">
                <thead><tr><th>Dia</th><th>Pessoas</th><th>Produzido</th><th>Sobra</th><th>Consumido</th><th>Por pessoa</th>{verCusto && <th>Custo/pessoa</th>}{verCusto && <th>Margem/pessoa</th>}</tr></thead>
                <tbody>
                  {[...dados.days].reverse().map((d) => (
                    <tr key={d.date}>
                      <td>{dataBr(d.date)}</td><td>{d.people ?? "—"}</td><td>{kgTexto(d.producedG)}</td><td>{kgTexto(d.leftoverG)}</td><td>{kgTexto(d.consumedG)}</td><td>{gramas(d.gPerPerson)}</td>
                      {verCusto && <td>{d.costPerPerson === null ? "—" : <Money value={d.costPerPerson} />}</td>}
                      {verCusto && <td>{d.marginPerPerson === null ? "—" : <Money value={d.marginPerPerson} />}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <PlanejarBuffet key={`${dados.from}-${dados.kind}`} itens={dados.items} cardapioAtual={dados.lastDayItemIds} pessoasMedia={pessoasMedia} costVisible={verCusto} />
        </>
      )}
    </div>
  );
}
