import "./planejamento/planejamento-edicao.css";
import "./planejamento/planejamento.css";
import "./planejamento/planejamento-acabamento.css";
import "./planejamento/comentarios/comentarios.css";
import { MessageSquare, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getPlanejamentoComparativo, type PlanejamentoComparativo } from "../api/client";
import { Alert, Button, EmptyState, Select } from "../design-system";
import { hojeLocalIso } from "../lib/datas";
import { Abas, PainelDaAba, type Aba } from "./planejamento/Abas";
import { Cenarios } from "./planejamento/Cenarios";
import { Esqueleto } from "./planejamento/Esqueleto";
import { mensagemHumana } from "./planejamento/erros";
import { descricaoDoPeriodo, NOMES_DOS_MESES } from "./planejamento/formato";
import { GraficoComparativo } from "./planejamento/GraficoComparativo";
import { PainelComparativo } from "./planejamento/PainelComparativo";
import { Quadro } from "./planejamento/Quadro";
import { TabelaMensal, type GrandezaDoQuadro } from "./planejamento/TabelaMensal";
import { PainelDeComentarios } from "./planejamento/comentarios/PainelDeComentarios";
import { useComentarios } from "./planejamento/comentarios/useComentarios";
import type { LigacaoDeComentarios } from "./planejamento/comentarios/ligacao";
import { metricaDaGrandeza, type PontoDeComentario } from "./planejamento/comentarios/ponto";
import { BotaoImprimirComparativo } from "./planejamento/impressao/BotaoImprimirComparativo";
import { useEstreito } from "./planejamento/useEstreito";
import { hasPermission } from "../lib/permissions";
import { useSession } from "../context/SessionContext";

// Planejamento > Comparativo: o que a planilha de planejamento fazia à mão (clientes por turno, vendas,
// ticket médio e a comparação ano × ano), calculado direto do faturamento do ERP. O histórico anterior ao
// PDV vem da carga da planilha de fechamento de caixa.

const GRANDEZAS: Aba<GrandezaDoQuadro>[] = [
  { valor: "vendas", rotulo: "Vendas" },
  { valor: "clientes", rotulo: "Clientes" },
  { valor: "ticket", rotulo: "Ticket médio" }
];

const mensagemDeErro = (e: unknown): string => mensagemHumana(e, "Não foi possível carregar o comparativo.");

function notasDaFonte(dados: PlanejamentoComparativo): string[] {
  const notas: string[] = [];
  const doHistorico = (lado: "base" | "comparado") => dados.meses.some((m) => m[lado].fonte === "HISTORICO");
  const anosDoHistorico = [doHistorico("base") ? dados.anoBase : null, doHistorico("comparado") ? dados.anoComparado : null].filter((a): a is number => a !== null);
  if (anosDoHistorico.length > 0) notas.push(`${anosDoHistorico.join(" e ")}: dados do histórico importado do fechamento de caixa, não do PDV.`);
  const emAndamento = dados.meses.filter((m) => m.emAndamento).map((m) => NOMES_DOS_MESES[m.mes - 1]);
  if (emAndamento.length > 0) notas.push(`${emAndamento.join(" e ")} ainda ${emAndamento.length > 1 ? "estão" : "está"} em andamento (parcial) e ${emAndamento.length > 1 ? "ficam" : "fica"} fora do acumulado e das variações.`);
  const parciais = dados.meses.filter((m) => !m.emAndamento && (m.base.parcial || m.comparado.parcial)).map((m) => NOMES_DOS_MESES[m.mes - 1]);
  if (parciais.length > 0) notas.push(`Em ${parciais.join(", ")} o ERP tem venda em menos de 90% dos dias: o mês aparece como parcial e fica fora do acumulado.`);
  const incompletos = dados.meses.filter((m) => m.incompleto && !m.emAndamento).map((m) => NOMES_DOS_MESES[m.mes - 1]);
  if (incompletos.length > 0) notas.push(`Em ${incompletos.join(", ")} há vendas sem o número de clientes registrado: o mês fica sem clientes, ticket médio e variações, e fora do acumulado.`);
  return notas.map((n) => n.charAt(0).toUpperCase() + n.slice(1));
}

function Comparativo() {
  const anoAtual = Number(hojeLocalIso().slice(0, 4));
  const [anoBase, setAnoBase] = useState(anoAtual - 1);
  const [anoComparado, setAnoComparado] = useState(anoAtual);
  const [grandeza, setGrandeza] = useState<GrandezaDoQuadro>("vendas");
  const [dados, setDados] = useState<PlanejamentoComparativo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [tentativa, setTentativa] = useState(0);

  const { user } = useSession();
  const podeEscrever = hasPermission(user, "planning", "edit");
  const comentarios = useComentarios(anoBase, anoComparado, anoBase !== anoComparado);
  const [pontoAberto, setPontoAberto] = useState<PontoDeComentario | null>(null);
  const ligacao = useMemo<LigacaoDeComentarios>(
    () => ({ todos: comentarios.comentarios, porPonto: comentarios.porPonto, podeEscrever, abrir: setPontoAberto }),
    [comentarios.comentarios, comentarios.porPonto, podeEscrever]
  );

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
  }, [anoBase, anoComparado, mesmoAno, tentativa]);

  const tentarDeNovo = useCallback(() => setTentativa((t) => t + 1), []);
  const notas = dados ? notasDaFonte(dados) : [];
  const estreito = useEstreito();
  const quadroMensal = dados && (
    <Quadro rotulo={`Quadro mês a mês: ${GRANDEZAS.find((g) => g.valor === grandeza)?.rotulo ?? ""}`} className="plan-quadro-mensal">
      <TabelaMensal dados={dados} grandeza={grandeza} comentarios={ligacao} />
    </Quadro>
  );
  const semComparacao = dados !== null && dados.acumulado.mesesComparados.length === 0;

  return (
    <div className="plan">
      <div className="plan-barra-cenario">
        <div className="plan-barra-campos">
          <Select label="Ano de referência" value={String(anoBase)} onChange={(e) => setAnoBase(Number(e.target.value))} options={opcoes} containerClassName="plan-filtro" />
          <span className="plan-contra" aria-hidden>contra</span>
          <Select label="Ano comparado" value={String(anoComparado)} onChange={(e) => setAnoComparado(Number(e.target.value))} options={opcoes} containerClassName="plan-filtro" />
        </div>
        {dados && !mesmoAno && !semComparacao && (
          <div className="plan-barra-acoes plan-coment-barra">
            {podeEscrever && (
              <Button variant="secondary" onClick={() => setPontoAberto({ mes: null, metrica: metricaDaGrandeza(grandeza), turno: "TOTAL" })}>
                <MessageSquare size={16} aria-hidden /> Comentar
              </Button>
            )}
            <BotaoImprimirComparativo dados={dados} comentarios={comentarios.comentarios} usuario={user?.name ?? ""} />
          </div>
        )}
      </div>

      {mesmoAno && <Alert tone="warning" role="alert">Escolha dois anos diferentes para comparar.</Alert>}
      {erro && (
        <Alert tone="error" role="alert" title="O comparativo não carregou">
          {erro} Os anos escolhidos continuam aqui; tente de novo em instantes.
          <span className="plan-salvar-acoes-alerta"><Button variant="secondary" onClick={tentarDeNovo}><RefreshCw size={16} aria-hidden /> Tentar de novo</Button></span>
        </Alert>
      )}
      {!mesmoAno && comentarios.erro && !pontoAberto && (
        <Alert tone="warning" role="alert" title="Os comentários não carregaram">
          {comentarios.erro} Os números do comparativo estão corretos.
          <span className="plan-salvar-acoes-alerta"><Button variant="secondary" onClick={comentarios.recarregar}><RefreshCw size={16} aria-hidden /> Tentar de novo</Button></span>
        </Alert>
      )}
      {!mesmoAno && carregando && !dados && <Esqueleto rotulo="Carregando comparativo…" />}

      {!mesmoAno && dados && (
        <div className="plan-conteudo" aria-busy={carregando}>
          {semComparacao ? (
            <EmptyState
              className="plan-vazio"
              title={`Nenhum mês com dados completos em ${dados.anoBase} e em ${dados.anoComparado}.`}
              description="O histórico anterior ao PDV é carregado a partir da planilha de fechamento de caixa. Se esperava ver esse período, peça a carga a quem administra o sistema."
            />
          ) : (
            <>
              <PainelComparativo dados={dados} comentarios={ligacao} />
              <section className="plan-secao" aria-labelledby="plan-mensal">
                <div className="plan-cabecalho plan-cabecalho-com-controle">
                  <div>
                    <h2 id="plan-mensal" className="plan-titulo">Mês a mês</h2>
                    <p className="plan-sub">{dados.anoComparado} contra {dados.anoBase}, mês a mês. O acumulado é de {descricaoDoPeriodo(dados.acumulado.mesesComparados)}; o mês parcial aparece, mas fica fora dele.</p>
                  </div>
                  <Abas id="plan-grandeza" rotulo="Grandeza do quadro" variante="segmentada" abas={GRANDEZAS} valor={grandeza} aoMudar={setGrandeza} />
                </div>
                <PainelDaAba id="plan-grandeza" valor={grandeza} className="plan-secao">
                  <GraficoComparativo dados={dados} grandeza={grandeza} comentarios={ligacao} />
                  {estreito ? (
                    <details className="plan-recolhido">
                      <summary className="plan-recolhido-titulo">Ver os números mês a mês</summary>
                      {quadroMensal}
                    </details>
                  ) : quadroMensal}
                </PainelDaAba>
              </section>
            </>
          )}
          {notas.length > 0 && (
            <Alert tone="info" title="Sobre os dados">
              <ul className="plan-lista-avisos">{notas.map((n) => <li key={n}>{n}</li>)}</ul>
            </Alert>
          )}
        </div>
      )}
      {dados && !mesmoAno && (
        <PainelDeComentarios ponto={pontoAberto} aoMudarPonto={setPontoAberto} aoFechar={() => setPontoAberto(null)} dados={dados} api={comentarios} podeEscrever={podeEscrever} />
      )}
    </div>
  );
}

type Visao = "comparativo" | "cenarios";
const VISOES: Aba<Visao>[] = [
  { valor: "comparativo", rotulo: "Comparativo" },
  { valor: "cenarios", rotulo: "Cenários" }
];
// O cabeçalho do shell descreve o comparativo (texto do App.tsx, fora deste módulo). Na aba Cenários a página mostra a
// própria descrição no lugar dela: só a linha da descrição do shell some, e só enquanto Cenários está aberta (regra
// presa ao irmão .plan-raiz, no CSS). Abaixo de 900px o shell esconde o cabeçalho inteiro: a página mostra o próprio
// h1 e o subtítulo de cada aba.
const SUBTITULO: Record<Visao, string> = {
  comparativo: "Compare dois anos do Salão: vendas, clientes e ticket médio, por turno e mês a mês.",
  cenarios: "Projete o ano: vendas, gastos e caixa, sempre em competência e em caixa."
};

export function Planejamento() {
  const { user } = useSession();
  const [visao, setVisao] = useState<Visao>("comparativo");
  // Quem pode ver o módulo vê as duas abas; a permissão de gravação é tratada dentro dos cenários.
  const podeVer = hasPermission(user, "planning", "view");
  if (!podeVer) return <Alert tone="warning">Você não tem acesso ao Planejamento.</Alert>;
  return (
    <div className="plan plan-raiz" data-visao={visao}>
      <h1 className="plan-h1-movel">Planejamento</h1>
      <p className={`plan-subtitulo-pagina${visao === "cenarios" ? " plan-subtitulo-proprio" : " plan-so-movel"}`}>{SUBTITULO[visao]}</p>
      <Abas id="plan-visao" rotulo="Visão do planejamento" abas={VISOES} valor={visao} aoMudar={setVisao} />
      <PainelDaAba id="plan-visao" valor={visao}>
        {visao === "comparativo" ? <Comparativo /> : <Cenarios />}
      </PainelDaAba>
    </div>
  );
}
