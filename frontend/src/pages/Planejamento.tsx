import "./planejamento/planejamento.css";
import { useEffect, useMemo, useState } from "react";
import { getPlanejamentoComparativo, type PlanejamentoComparativo } from "../api/client";
import { Alert, EmptyState, Select, Tabs } from "../design-system";
import { hojeLocalIso } from "../lib/datas";
import { descricaoDoPeriodo, NOMES_DOS_MESES } from "./planejamento/formato";
import { PainelComparativo } from "./planejamento/PainelComparativo";
import { TabelaMensal, type GrandezaDoQuadro } from "./planejamento/TabelaMensal";

// Planejamento > Comparativo: o que a planilha de planejamento fazia à mão (clientes por turno, vendas,
// ticket médio e a comparação ano × ano), calculado direto do faturamento do ERP. O histórico anterior ao
// PDV vem da carga da planilha de fechamento de caixa.

const ABAS: { value: GrandezaDoQuadro; label: string }[] = [
  { value: "vendas", label: "Vendas" },
  { value: "clientes", label: "Clientes" },
  { value: "ticket", label: "Ticket médio" }
];

function mensagemDeErro(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Não foi possível carregar o comparativo.";
}

function avisosDeFonte(dados: PlanejamentoComparativo): string[] {
  const avisos: string[] = [];
  const doHistorico = (lado: "base" | "comparado") => dados.meses.some((m) => m[lado].fonte === "HISTORICO");
  if (doHistorico("base")) avisos.push(`Os dados de ${dados.anoBase} vêm do histórico importado do fechamento de caixa, não do PDV.`);
  if (doHistorico("comparado")) avisos.push(`Os dados de ${dados.anoComparado} vêm do histórico importado do fechamento de caixa, não do PDV.`);
  const emAndamento = dados.meses.filter((m) => m.emAndamento).map((m) => NOMES_DOS_MESES[m.mes - 1]);
  if (emAndamento.length > 0) avisos.push(`${emAndamento.join(" e ")} ainda ${emAndamento.length > 1 ? "estão" : "está"} em andamento e ${emAndamento.length > 1 ? "ficam" : "fica"} fora do acumulado e das variações.`);
  const incompletos = dados.meses.filter((m) => m.incompleto && !m.emAndamento).map((m) => NOMES_DOS_MESES[m.mes - 1]);
  if (incompletos.length > 0) avisos.push(`Em ${incompletos.join(", ")} há vendas sem o número de clientes registrado: o mês fica sem clientes, ticket médio e variações, e fora do acumulado.`);
  return avisos;
}

export function Planejamento() {
  const anoAtual = Number(hojeLocalIso().slice(0, 4));
  const [anoBase, setAnoBase] = useState(anoAtual - 1);
  const [anoComparado, setAnoComparado] = useState(anoAtual);
  const [aba, setAba] = useState<GrandezaDoQuadro>("vendas");
  const [dados, setDados] = useState<PlanejamentoComparativo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const anos = useMemo(() => Array.from({ length: 6 }, (_, i) => anoAtual - 4 + i), [anoAtual]);
  const opcoes = useMemo(() => anos.map((a) => ({ value: String(a), label: String(a) })), [anos]);
  const mesmoAno = anoBase === anoComparado;

  useEffect(() => {
    if (mesmoAno) return undefined;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    getPlanejamentoComparativo(anoBase, anoComparado)
      .then((resposta) => { if (!cancelado) setDados(resposta); })
      .catch((e: unknown) => { if (!cancelado) { setDados(null); setErro(mensagemDeErro(e)); } })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [anoBase, anoComparado, mesmoAno]);

  const avisos = dados ? avisosDeFonte(dados) : [];
  const semComparacao = dados !== null && dados.acumulado.mesesComparados.length === 0;

  return (
    <div className="plan">
      <p className="plan-intro">Compara dois anos do Salão por turno: vendas, clientes e ticket médio. Só entram no acumulado os meses encerrados e com dado nos dois anos.</p>

      <div className="plan-barra">
        <Select aria-label="Ano de referência" value={String(anoBase)} onChange={(e) => setAnoBase(Number(e.target.value))} options={opcoes} containerClassName="plan-filtro" />
        <span className="plan-contra" aria-hidden>contra</span>
        <Select aria-label="Ano comparado" value={String(anoComparado)} onChange={(e) => setAnoComparado(Number(e.target.value))} options={opcoes} containerClassName="plan-filtro" />
      </div>

      {mesmoAno && <Alert tone="warning">Escolha dois anos diferentes para comparar.</Alert>}
      {erro && <Alert tone="error">{erro}</Alert>}
      {!mesmoAno && carregando && !dados && <div className="page-loading">Carregando comparativo…</div>}

      {!mesmoAno && dados && (
        <div className="plan-conteudo" aria-busy={carregando}>
          {avisos.map((aviso) => <Alert key={aviso} tone="info">{aviso}</Alert>)}

          {semComparacao ? (
            <EmptyState
              title={`Nenhum mês com dados em ${dados.anoBase} e em ${dados.anoComparado}.`}
              description="O histórico anterior ao PDV é carregado a partir da planilha de fechamento de caixa. Se esperava ver esse período, peça a carga a quem administra o sistema."
            />
          ) : (
            <>
              <PainelComparativo dados={dados} />
              <section className="plan-secao" aria-labelledby="plan-mensal">
                <h2 id="plan-mensal" className="plan-titulo">Mês a mês</h2>
                <p className="plan-sub">Acumulado de {descricaoDoPeriodo(dados.acumulado.mesesComparados)}. ◐ marca o mês em andamento.</p>
                <Tabs tabs={ABAS} value={aba} onChange={(v) => setAba(v as GrandezaDoQuadro)} aria-label="Grandeza do quadro" />
                <div className="plan-quadro" role="tabpanel" aria-label={`Quadro mês a mês: ${ABAS.find((a) => a.value === aba)?.label ?? ""}`}>
                  <TabelaMensal dados={dados} grandeza={aba} />
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
