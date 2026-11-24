import { useEffect, useMemo, useState } from "react";
import { getPlanejamentoRealizado, type PlanejamentoGrupoDeGasto, type PlanejamentoLinhaDeGasto, type PlanejamentoRealizado, type PlanejamentoRealizadoDoGrupo } from "../../api/client";
import { Dialog } from "../../components/ui/Dialog";
import { Alert, Button, Select } from "../../design-system";
import { mensagemHumana } from "./erros";
import { NOMES_DOS_MESES_CURTOS, percentualParaTexto, ROTULO_DO_GRUPO } from "./formato";
import { Reais } from "./Reais";
import { aplicarRealizado, passaDaReceita, SALTO_SUSPEITO, suspeitaDa, temSugestao, type ModoDoPreenchimento, type Suspeita } from "./realizado";
import { CabecalhoDeSugestoes, ErroDoRealizado, Mudanca, RodapeDoDialogo, SemSugestao, Sugestao } from "./Sugestao";
import { useDialogoAcessivel } from "./useDialogoAcessivel";

// Sugere os gastos do cenário a partir do que o DRE já apurou no ano-base (só meses encerrados). Cada grupo mostra
// o que está hoje no cenário, para onde vai e qual linha será sobrescrita. Vem desmarcado o que não muda e o que o
// próprio diálogo acha suspeito (receita incompleta, salto de mais de 3 vezes). Nada é gravado até salvar o cenário.

const OPCOES_DE_MODO: { value: ModoDoPreenchimento; label: string }[] = [
  { value: "MEDIA", label: "Média dos meses fechados" },
  { value: "MESMO_MES", label: "Mesmo mês do ano-base" }
];

const comSugestaoDe = (dados: PlanejamentoRealizado | null) => (dados?.grupos ?? []).filter((g) => temSugestao(g));
const media = (valores: readonly number[]) => (valores.length === 0 ? 0 : valores.reduce((s, v) => s + v, 0) / valores.length);
const pct = (f: number) => `${percentualParaTexto(f)}%`;

type Comparacao = {
  percentual: boolean;
  hoje: number | null;
  realizado: number | null;
  igual: boolean;
  acimaDaReceita: boolean;
  suspeita: Suspeita | null;
  /** Linha que recebe o realizado (a primeira do grupo) e quantas outras o grupo tem; null = a linha será criada. */
  linha: { nome: string; outras: number } | null;
};

/** Hoje no cenário (primeira linha do grupo, média dos 12 meses) contra o realizado, na unidade da linha. */
function comparar(g: PlanejamentoRealizadoDoGrupo, gastos: readonly PlanejamentoLinhaDeGasto[]): Comparacao {
  const linha = gastos.find((l) => l.grupo === g.grupo);
  const percentual = (linha?.modo ?? (g.grupo === "TRIBUTOS" ? "PERCENTUAL" : "FIXO")) === "PERCENTUAL";
  const hoje = linha ? media(linha.valores) : null;
  const realizado = percentual ? g.percentualDaReceita : g.media;
  const igual = hoje !== null && realizado !== null && (percentual ? Math.round(hoje * 1000) === Math.round(realizado * 1000) : Math.round(hoje) === Math.round(realizado));
  const doGrupo = gastos.filter((l) => l.grupo === g.grupo).length;
  return {
    percentual, hoje, realizado, igual,
    acimaDaReceita: percentual && passaDaReceita(g),
    suspeita: igual ? null : suspeitaDa(g, hoje, realizado),
    linha: linha ? { nome: linha.nome, outras: doGrupo - 1 } : null
  };
}

/** O que muda no cenário se o grupo for usado: qual linha é sobrescrita (ou criada). */
function oQueSobrescreve(c: Comparacao, modo: ModoDoPreenchimento): string {
  if (!c.linha) return "Cria uma linha nova no grupo.";
  const outras = c.linha.outras === 0 ? "" : c.linha.outras === 1 ? " A outra linha do grupo fica como está." : ` As outras ${c.linha.outras} linhas do grupo ficam como estão.`;
  return `Substitui os 12 meses de “${c.linha.nome}”${modo === "MESMO_MES" ? ", mês a mês" : ""}.${outras}`;
}

function textoDaSuspeita(s: Suspeita): string {
  const vezes = s.vezes !== null && s.vezes > SALTO_SUSPEITO ? `${s.vezes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vezes o valor de hoje` : null;
  if (s.motivo === "SALTO") return `Confira antes de usar: ${vezes ?? "mudança grande"}.`;
  return vezes ? `Confira antes de usar: ${vezes}, com a receita do período incompleta (aviso acima).` : "Confira antes de usar: a receita do período está incompleta (aviso acima).";
}

function notaDoGrupo(g: PlanejamentoRealizadoDoGrupo, encerrados: number, ignorar: boolean): string {
  if (!g.origemNoDre) return "Sem origem no DRE: digite à mão.";
  if (g.media !== null && g.media < 0) return "Soma negativa no período (estornos?): digite à mão.";
  if (g.media === null) return "Nenhum mês com lançamento.";
  const sem = g.mesesSemLancamento.length;
  const efeito = ignorar ? "fora da média" : "puxa a média para baixo";
  if (sem > 0 && sem >= encerrados) return "Sem lançamento no ano.";
  if (sem > 3) return `${sem} meses sem lançamento (${efeito}).`;
  if (sem > 0) return `Sem lançamento em ${g.mesesSemLancamento.map((m) => NOMES_DOS_MESES_CURTOS[m - 1]).join(", ")} (${efeito}).`;
  return `${g.mesesConsiderados.length} ${g.mesesConsiderados.length === 1 ? "mês" : "meses"} na média.`;
}

function Valores({ c }: { c: Comparacao }) {
  if (c.realizado === null) return <Mudanca hoje="" realizado="" igual={false} semRealizado="sem valor para sugerir" />;
  if (c.percentual) {
    const delta = c.hoje === null ? "linha nova" : `${c.realizado >= c.hoje ? "+" : "−"}${percentualParaTexto(Math.abs(c.realizado - c.hoje))} p.p.`;
    return <Mudanca igual={c.igual} hoje={c.hoje === null ? "sem linha" : pct(c.hoje)} realizado={pct(c.realizado)} delta={delta} />;
  }
  const delta = c.hoje === null ? "linha nova" : <><Reais valor={c.realizado - c.hoje} sinalPositivo />/mês</>;
  return <Mudanca igual={c.igual} hoje={c.hoje === null ? "sem linha" : <Reais valor={c.hoje} />} realizado={<><Reais valor={c.realizado} /><span className="plan-mudanca-unidade">/mês</span></>} delta={delta} />;
}

type Props = {
  aberto: boolean;
  anoBase: number;
  gastos: PlanejamentoLinhaDeGasto[];
  onFechar: () => void;
  onAplicar: (proximos: PlanejamentoLinhaDeGasto[]) => void;
};

export function RealizadoDialog({ aberto, anoBase, gastos, onFechar, onAplicar }: Props) {
  useDialogoAcessivel(aberto);
  const [dados, setDados] = useState<PlanejamentoRealizado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ignorarSemLancamento, setIgnorarSemLancamento] = useState(true);
  const [modo, setModo] = useState<ModoDoPreenchimento>("MEDIA");
  const [aviso, setAviso] = useState<string | null>(null);
  const [desmarcados, setDesmarcados] = useState<Set<PlanejamentoGrupoDeGasto>>(new Set());
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!aberto) return undefined;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    setAviso(null);
    getPlanejamentoRealizado(anoBase, ignorarSemLancamento)
      .then((r) => { if (!cancelado) setDados(r); })
      .catch((e: unknown) => { if (!cancelado) { setDados(null); setErro(mensagemHumana(e, "Não foi possível buscar o realizado.")); } })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [aberto, anoBase, ignorarSemLancamento, tentativa]);

  const comparacoes = useMemo(() => new Map((dados?.grupos ?? []).map((g) => [g.grupo, comparar(g, gastos)])), [dados, gastos]);

  // A cada resposta: vem marcado só o que muda alguma coisa e não é suspeito (receita incompleta, salto de mais de 3x).
  useEffect(() => {
    if (!dados) return;
    setDesmarcados(new Set(dados.grupos.filter((g) => { const c = comparar(g, gastos); return c.igual || c.acimaDaReceita || c.suspeita !== null; }).map((g) => g.grupo)));
    // Só quando chegam dados novos; editar o cenário com o diálogo aberto não reescreve a escolha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados]);

  const escolhidos = useMemo(() => (dados?.grupos ?? []).filter((g) => temSugestao(g) && !desmarcados.has(g.grupo)), [dados, desmarcados]);

  function alternar(grupo: PlanejamentoGrupoDeGasto) {
    setDesmarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(grupo)) novo.delete(grupo);
      else novo.add(grupo);
      return novo;
    });
  }

  function aplicar() {
    const { gastos: proximos, gruposAplicados } = aplicarRealizado(gastos, escolhidos, modo);
    onAplicar(proximos);
    const naoAplicados = escolhidos.filter((g) => !gruposAplicados.includes(g.grupo));
    if (naoAplicados.length === 0) {
      onFechar();
      return;
    }
    // Linha em % das vendas sem receita no DRE para calcular o percentual: não dá para preencher, e a pessoa precisa saber.
    setAviso(`Aplicado a ${gruposAplicados.length} ${gruposAplicados.length === 1 ? "grupo" : "grupos"}. Não aplicado: ${naoAplicados.map((g) => ROTULO_DO_GRUPO[g.grupo]).join(", ")} (a linha é em % das vendas e o percentual do DRE não serve: falta receita ou passa de 100%).`);
  }

  const semMesFechado = dados !== null && dados.mesesEncerrados.length === 0;
  const mudam = dados ? dados.grupos.filter((g) => temSugestao(g) && !comparacoes.get(g.grupo)?.igual).length : 0;
  const comSugestao = comSugestaoDe(dados);
  const semSugestao = (dados?.grupos ?? []).filter((g) => !temSugestao(g));
  const falhou = erro !== null && !dados;
  const sobrescritas = escolhidos.filter((g) => comparacoes.get(g.grupo)?.linha).length;
  const criadas = escolhidos.length - sobrescritas;
  const partesDoResumo = [
    sobrescritas > 0 ? `sobrescreve ${sobrescritas} ${sobrescritas === 1 ? "linha" : "linhas"} do cenário` : null,
    criadas > 0 ? `cria ${criadas} ${criadas === 1 ? "linha" : "linhas"}` : null
  ].filter((p): p is string => p !== null).join(" e ");
  const resumoDoRodape = escolhidos.length === 0 ? "Nada marcado: o cenário não muda" : partesDoResumo.charAt(0).toUpperCase() + partesDoResumo.slice(1);
  const acimaDaReceita = comSugestao.filter(passaDaReceita);
  const pedemConferencia = comSugestao.filter((g) => comparacoes.get(g.grupo)?.suspeita).length;

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title={`Preencher com o realizado de ${anoBase}`} description="Valores do DRE Gerencial, só de meses encerrados. Nada é gravado até você salvar o cenário." size="xl">
      <div className="plan-realizado">
        {erro && <ErroDoRealizado mensagem={erro} carregando={carregando} onTentarDeNovo={() => setTentativa((t) => t + 1)} />}
        {carregando && <p className="plan-carregando" role="status">Buscando o realizado de {anoBase}…</p>}
        {aviso && <Alert tone="warning">{aviso}</Alert>}
        {semMesFechado && <Alert tone="warning">{`Nenhum mês de ${anoBase} está encerrado ainda: não há realizado para sugerir.`}</Alert>}

        {!falhou && <div className="plan-barra">
          <Select label="Forma de preencher" value={modo} onChange={(e) => setModo(e.target.value as ModoDoPreenchimento)} options={OPCOES_DE_MODO} containerClassName="plan-filtro plan-filtro-largo" />
          <label className="plan-check plan-marcar">
            <input type="checkbox" checked={ignorarSemLancamento} onChange={(e) => setIgnorarSemLancamento(e.target.checked)} />
            Ignorar meses sem lançamento na média
          </label>
        </div>}

        {dados && !semMesFechado && (
          <div className="plan-sugestoes-bloco">
            {acimaDaReceita.length > 0 && (
              <Alert tone="warning" title={`A receita do DRE de ${anoBase} parece incompleta`}>
                {acimaDaReceita.length === 1 ? "Este grupo passa" : "Estes grupos passam"} de 100% dela: {acimaDaReceita.map((g) => `${ROTULO_DO_GRUPO[g.grupo]} (${pct(g.percentualDaReceita ?? 0)})`).join(", ")}. O % sobre a receita fica inflado; o valor em R$ continua valendo, mas confira antes de usar: por isso {acimaDaReceita.length === 1 ? "ele vem desmarcado" : "eles vêm desmarcados"}.
              </Alert>
            )}
            <p className="plan-sugestoes-resumo">
              {mudam === 0 ? "O cenário já está igual ao realizado em todos os grupos." : `${mudam} ${mudam === 1 ? "grupo muda" : "grupos mudam"}; vem desmarcado o que fica igual${pedemConferencia > 0 ? " e o que pede conferência" : ""}. Usar um grupo sobrescreve a linha dele no cenário.`}
              {modo === "MESMO_MES" ? " Os valores abaixo são a média; cada mês recebe o realizado do mesmo mês." : ""}
            </p>
            <CabecalhoDeSugestoes colunas={["Usar", "Grupo", "Hoje no cenário → realizado"]} />
            <ul className="plan-sugestoes" aria-label="Realizado por grupo de gasto">
              {comSugestao.map((g) => {
                const c = comparacoes.get(g.grupo) ?? comparar(g, gastos);
                return (
                  <Sugestao
                    key={g.grupo}
                    nome={<>{ROTULO_DO_GRUPO[g.grupo]}{passaDaReceita(g) && !c.percentual && <span className="plan-sugestao-etiqueta">{pct(g.percentualDaReceita ?? 0)} da receita</span>}</>}
                    rotuloDoMarcar={`Usar ${ROTULO_DO_GRUPO[g.grupo]}`}
                    marcado={temSugestao(g) && !desmarcados.has(g.grupo)}
                    desabilitado={!temSugestao(g)}
                    onAlternar={() => alternar(g.grupo)}
                    igual={c.igual}
                    valores={<Valores c={c} />}
                    nota={<>
                      {notaDoGrupo(g, dados.mesesEncerrados.length, ignorarSemLancamento)}
                      {!c.igual && !c.acimaDaReceita && <> <span className="plan-sugestao-sobrescreve">{oQueSobrescreve(c, modo)}</span></>}
                    </>}
                    conferir={c.suspeita && !c.acimaDaReceita ? textoDaSuspeita(c.suspeita) : undefined}
                    alerta={c.acimaDaReceita ? `Passa de 100% da receita (${pct(g.percentualDaReceita ?? 0)}): não dá para usar como % das vendas. Confira os lançamentos do grupo no DRE.` : undefined}
                  />
                );
              })}
            </ul>
            <SemSugestao rotulo="Sem valor do DRE para sugerir (digite à mão)" nomes={semSugestao.map((g) => ROTULO_DO_GRUPO[g.grupo])} />
          </div>
        )}

        {!falhou && <p className="plan-sub">O DRE é da empresa toda; a projeção é só do Salão. O gasto entra como custo da casa contra a venda do Salão, como na planilha; o % da receita usa a receita de todos os canais. Só a primeira linha de cada grupo é preenchida; se o grupo não tem linha, ela é criada.</p>}

        <RodapeDoDialogo resumo={falhou ? null : resumoDoRodape} onCancelar={onFechar}>
          {!falhou && <Button type="button" disabled={carregando || escolhidos.length === 0} onClick={aplicar}>{carregando ? "Buscando…" : `Aplicar a ${escolhidos.length} ${escolhidos.length === 1 ? "grupo" : "grupos"}`}</Button>}
        </RodapeDoDialogo>
      </div>
    </Dialog>
  );
}
