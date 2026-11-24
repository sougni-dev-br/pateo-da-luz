import { useEffect, useMemo, useState } from "react";
import { getPlanejamentoRealizadoDeCaixa, type PlanejamentoCaixaPremissas, type PlanejamentoGrupoDeGasto, type PlanejamentoLinhaDeGasto, type PlanejamentoRealizadoDeCaixa } from "../../api/client";
import { Dialog } from "../../components/ui/Dialog";
import { Alert, Button } from "../../design-system";
import { mensagemHumana } from "./erros";
import { NOMES_DOS_MESES_CURTOS, percentualParaTexto, ROTULO_DA_FORMA, ROTULO_DO_GRUPO } from "./formato";
import { Reais } from "./Reais";
import { aplicarRealizadoDeCaixa } from "./realizado-caixa";
import { CabecalhoDeSugestoes, ErroDoRealizado, Mudanca, RodapeDoDialogo, SemSugestao, Sugestao } from "./Sugestao";
import { useDialogoAcessivel } from "./useDialogoAcessivel";
import { useEstreito } from "./useEstreito";
import { useOculto } from "./useOculto";

// Sugere as premissas de caixa a partir do que o ERP já mediu no ano-base. Prazo e taxa das maquininhas não existem no
// ERP e continuam à mão. Cada linha mostra hoje → realizado; a que não muda nada vem desmarcada, em cinza.
// Nada é gravado até a pessoa salvar o cenário.

const pct = (f: number) => `${percentualParaTexto(f)}%`;
const mesmoPct = (a: number, b: number) => Math.round(a * 1000) === Math.round(b * 1000);
const deltaPp = (de: number, para: number) => `${para >= de ? "+" : "−"}${percentualParaTexto(Math.abs(para - de))} p.p.`;
const mesmosReais = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.round(v) === Math.round(b[i] ?? 0));

function mixIgual(caixa: PlanejamentoCaixaPremissas, dados: PlanejamentoRealizadoDeCaixa): boolean {
  if (!dados.mix) return true;
  const mix = dados.mix.formas;
  return caixa.formas.every((f) => mesmoPct(f.mix, mix[f.forma] ?? 0));
}

function herdadoIgual(caixa: PlanejamentoCaixaPremissas, dados: PlanejamentoRealizadoDeCaixa): boolean {
  // Espelha o aplicar: um lado sem nada lançado no ERP não troca o que está no cenário.
  const entradas = dados.herdado.entradas.some((v) => v > 0) ? dados.herdado.entradas : caixa.herdado.entradas;
  const saidas = dados.herdado.saidas.some((v) => v > 0) ? dados.herdado.saidas : caixa.herdado.saidas;
  return mesmosReais(entradas, caixa.herdado.entradas) && mesmosReais(saidas, caixa.herdado.saidas);
}

/** Mix em grade fixa (uma coluna por forma): hoje em cima, realizado embaixo, para comparar de olho. No celular as cinco
 * colunas não cabem: a grade é transposta (uma linha por forma: hoje → realizado). */
function MixMudancas({ caixa, dados }: { caixa: PlanejamentoCaixaPremissas; dados: PlanejamentoRealizadoDeCaixa }) {
  const estreito = useEstreito();
  const mix = dados.mix?.formas;
  if (!mix) return <Mudanca hoje="" realizado="" igual={false} semRealizado="sem vendas por forma de pagamento" />;
  const classeDe = (atual: number, novo: number) => (mesmoPct(atual, novo) ? "plan-mix-grade-igual" : "plan-mix-grade-muda");
  if (estreito) {
    return (
      <table className="plan-mix-grade plan-mix-grade-transposta">
        <caption className="plan-sr">Mix de pagamento: hoje no cenário e realizado, por forma</caption>
        <thead>
          <tr><td /><th scope="col">hoje</th><th scope="col">realizado</th></tr>
        </thead>
        <tbody>
          {caixa.formas.map((f) => {
            const novo = mix[f.forma] ?? 0;
            return (
              <tr key={f.forma}>
                <th scope="row"><span className={`plan-mix-ponto plan-mix-${f.forma.toLowerCase()}`} aria-hidden />{ROTULO_DA_FORMA[f.forma]}</th>
                <td className="plan-mix-grade-hoje-celula">{pct(f.mix)}</td>
                <td className={classeDe(f.mix, novo)}>{pct(novo)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  return (
    <table className="plan-mix-grade">
      <caption className="plan-sr">Mix de pagamento: hoje no cenário e realizado, por forma</caption>
      <thead>
        <tr><td />{caixa.formas.map((f) => <th key={f.forma} scope="col">{ROTULO_DA_FORMA[f.forma]}</th>)}</tr>
      </thead>
      <tbody>
        <tr className="plan-mix-grade-hoje">
          <th scope="row">hoje</th>
          {caixa.formas.map((f) => <td key={f.forma}>{pct(f.mix)}</td>)}
        </tr>
        <tr>
          <th scope="row">realizado</th>
          {caixa.formas.map((f) => {
            const novo = mix[f.forma] ?? 0;
            return <td key={f.forma} className={classeDe(f.mix, novo)}>{pct(novo)}</td>;
          })}
        </tr>
      </tbody>
    </table>
  );
}

function MiniMeses({ caixa, dados, anoDoCenario }: { caixa: PlanejamentoCaixaPremissas; dados: PlanejamentoRealizadoDeCaixa; anoDoCenario: number }) {
  const hidden = useOculto();
  const linhas = [
    { rotulo: "Receber", realizado: dados.herdado.entradas, hoje: caixa.herdado.entradas },
    { rotulo: "Pagar", realizado: dados.herdado.saidas, hoje: caixa.herdado.saidas }
  ];
  return (
    <table className="plan-mini-meses">
      <caption className="plan-sr">A receber e a pagar em janeiro, fevereiro e março de {anoDoCenario}</caption>
      <thead>
        <tr><td /><th scope="col">{NOMES_DOS_MESES_CURTOS[0]}</th><th scope="col">{NOMES_DOS_MESES_CURTOS[1]}</th><th scope="col">{NOMES_DOS_MESES_CURTOS[2]}</th></tr>
      </thead>
      <tbody>
        {linhas.map((l) => {
          const temValor = l.realizado.some((v) => v > 0);
          return (
            <tr key={l.rotulo}>
              <th scope="row">{l.rotulo}</th>
              {[0, 1, 2].map((i) => {
                const novo = temValor ? l.realizado[i] ?? 0 : l.hoje[i] ?? 0;
                const antes = l.hoje[i] ?? 0;
                const mudou = Math.round(novo) !== Math.round(antes);
                return (
                  <td key={i} className={mudou ? "plan-mini-mudou" : undefined}>
                    <strong>{hidden ? "••••" : <Reais valor={novo} moeda={false} />}</strong>
                    {mudou && <span className="plan-mini-antes">era <Reais valor={antes} moeda={false} /></span>}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type Props = {
  aberto: boolean;
  anoBase: number;
  anoDoCenario: number;
  caixa: PlanejamentoCaixaPremissas;
  gastos: PlanejamentoLinhaDeGasto[];
  onFechar: () => void;
  onAplicar: (caixa: PlanejamentoCaixaPremissas, gastos: PlanejamentoLinhaDeGasto[]) => void;
};

export function RealizadoCaixaDialog({ aberto, anoBase, anoDoCenario, caixa, gastos, onFechar, onAplicar }: Props) {
  useDialogoAcessivel(aberto);
  const [dados, setDados] = useState<PlanejamentoRealizadoDeCaixa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [semMix, setSemMix] = useState(false);
  const [semCompras, setSemCompras] = useState(false);
  const [semHerdado, setSemHerdado] = useState(false);
  const [desmarcados, setDesmarcados] = useState<Set<PlanejamentoGrupoDeGasto>>(new Set());
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!aberto) return undefined;
    let cancelado = false;
    setCarregando(true);
    setDados(null);
    setErro(null);
    getPlanejamentoRealizadoDeCaixa(anoBase, anoDoCenario)
      .then((r) => {
        if (cancelado) return;
        // Vem marcado só o que muda alguma coisa no cenário.
        setSemMix(mixIgual(caixa, r));
        setSemCompras(r.comprasPrazoDias === null || r.comprasPrazoDias === caixa.comprasPrazoDias);
        setSemHerdado(herdadoIgual(caixa, r));
        setDesmarcados(new Set(r.pagoNoMes.filter((m) => {
          const atual = gastos.find((g) => g.grupo === m.grupo)?.pagoNoMes;
          return m.pagoNoMes !== null && atual !== undefined && mesmoPct(atual, m.pagoNoMes);
        }).map((m) => m.grupo)));
        setDados(r);
      })
      .catch((e: unknown) => { if (!cancelado) { setDados(null); setErro(mensagemHumana(e, "Não foi possível buscar o realizado de caixa.")); } })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
    // Busca a cada abertura; a comparação usa o cenário daquele momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, anoBase, anoDoCenario, tentativa]);

  const gruposComLinha = useMemo(() => new Set(gastos.map((g) => g.grupo)), [gastos]);
  const medidasUteis = (dados?.pagoNoMes ?? []).filter((m) => m.pagoNoMes !== null && gruposComLinha.has(m.grupo));
  const escolhidos = new Set(medidasUteis.filter((m) => !desmarcados.has(m.grupo)).map((m) => m.grupo));
  const herdadoTemValor = dados !== null && [...dados.herdado.entradas, ...dados.herdado.saidas].some((v) => v > 0);
  const nada = dados !== null && !dados.mix && dados.comprasPrazoDias === null && medidasUteis.length === 0 && !herdadoTemValor;
  const usaMix = dados !== null && !semMix && dados.mix !== null;
  const usaCompras = dados !== null && !semCompras && dados.comprasPrazoDias !== null;
  const usaHerdado = !semHerdado && herdadoTemValor;
  const falhou = erro !== null && !dados;
  const semValor = dados === null ? [] : [
    dados.mix === null ? "mix de pagamento" : null,
    dados.comprasPrazoDias === null ? "prazo das compras" : null,
    herdadoTemValor ? null : `a receber e a pagar de jan–mar de ${anoDoCenario}`
  ].filter((n): n is string => n !== null);
  const marcados = (usaMix ? 1 : 0) + (usaCompras ? 1 : 0) + (usaHerdado ? 1 : 0) + escolhidos.size;

  function alternar(grupo: PlanejamentoGrupoDeGasto) {
    setDesmarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(grupo)) novo.delete(grupo);
      else novo.add(grupo);
      return novo;
    });
  }

  function aplicar() {
    if (!dados) return;
    const r = aplicarRealizadoDeCaixa(caixa, gastos, dados, { mix: usaMix, compras: usaCompras, pagoNoMes: escolhidos, herdado: usaHerdado });
    onAplicar(r.caixa, r.gastos);
    onFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title={`Preencher o caixa com o realizado de ${anoBase}`} description="O que o ERP mediu no ano-base. Prazo e taxa das maquininhas não existem no ERP e continuam à mão. Nada é gravado até você salvar o cenário." size="xl">
      <div className="plan-realizado">
        {erro && <ErroDoRealizado mensagem={erro} carregando={carregando} onTentarDeNovo={() => setTentativa((t) => t + 1)} />}
        {carregando && <p className="plan-carregando" role="status">Buscando o realizado de {anoBase}…</p>}
        {dados?.avisos.map((a) => <Alert key={a} tone="warning">{a}</Alert>)}
        {nada && <Alert tone="warning">{`O ERP ainda não tem dado de ${anoBase} para sugerir nenhuma premissa de caixa.`}</Alert>}

        {dados && !nada && (
          <div className="plan-sugestoes-bloco">
            <p className="plan-sugestoes-resumo">{marcados === 0 ? "O cenário já está igual ao realizado: nada para aplicar." : `${marcados} ${marcados === 1 ? "premissa muda" : "premissas mudam"}; o que fica igual vem desmarcado.`}</p>
            <CabecalhoDeSugestoes colunas={["Usar", "Premissa", "Hoje no cenário → realizado"]} />
            <ul className="plan-sugestoes" aria-label="Realizado de caixa do ano-base">
              {dados.mix !== null && <Sugestao
                nome="Mix de pagamento"
                rotuloDoMarcar="Usar o mix de pagamento"
                marcado={usaMix}
                desabilitado={dados.mix === null}
                onAlternar={() => setSemMix((v) => !v)}
                igual={dados.mix !== null && mixIgual(caixa, dados)}
                valores={<MixMudancas caixa={caixa} dados={dados} />}
                nota={dados.mix ? <>Sobre <Reais valor={dados.mix.base} /> de vendas do Salão nos meses fechados.</> : "Sem vendas por forma de pagamento no ano-base."}
              />}
              {dados.comprasPrazoDias !== null && <Sugestao
                nome="Prazo de pagamento das compras"
                rotuloDoMarcar="Usar o prazo das compras"
                marcado={usaCompras}
                desabilitado={dados.comprasPrazoDias === null}
                onAlternar={() => setSemCompras((v) => !v)}
                igual={dados.comprasPrazoDias === caixa.comprasPrazoDias}
                valores={dados.comprasPrazoDias === null
                  ? <Mudanca hoje="" realizado="" igual={false} semRealizado="sem compras pagas no período" />
                  : <Mudanca igual={dados.comprasPrazoDias === caixa.comprasPrazoDias} hoje={`${caixa.comprasPrazoDias} dias`} realizado={`${dados.comprasPrazoDias} dias`} delta={`${dados.comprasPrazoDias >= caixa.comprasPrazoDias ? "+" : "−"}${Math.abs(dados.comprasPrazoDias - caixa.comprasPrazoDias)} dias`} />}
                nota={`Média ponderada pelo valor, entre a compra e o pagamento${dados.comprasCobertura === null ? "" : `; cobre ${Math.round(dados.comprasCobertura * 100)}% do valor das compras`}.`}
              />}
              {herdadoTemValor && <Sugestao
                nome={`A receber e a pagar em jan–mar de ${anoDoCenario}`}
                rotuloDoMarcar="Usar os valores herdados"
                marcado={usaHerdado}
                desabilitado={!herdadoTemValor}
                onAlternar={() => setSemHerdado((v) => !v)}
                igual={herdadoTemValor && herdadoIgual(caixa, dados)}
                valores={herdadoTemValor ? <MiniMeses caixa={caixa} dados={dados} anoDoCenario={anoDoCenario} /> : <Mudanca hoje="" realizado="" igual={false} semRealizado="nada lançado ainda" />}
                nota={`Só o que JÁ está lançado: contas a pagar, folha e tributos em aberto, e recebíveis de eventos (sem repasses de delivery). Nov e dez de ${anoBase} ainda não lançados ficam de fora.`}
              />}
              {medidasUteis.map((m) => {
                const atual = gastos.find((g) => g.grupo === m.grupo)?.pagoNoMes;
                const novo = m.pagoNoMes ?? 0;
                const igual = atual !== undefined && mesmoPct(atual, novo);
                return (
                  <Sugestao
                    key={m.grupo}
                    nome={`${ROTULO_DO_GRUPO[m.grupo]}: pago no mês`}
                    rotuloDoMarcar={`Usar o % pago no mês de ${ROTULO_DO_GRUPO[m.grupo]}`}
                    marcado={escolhidos.has(m.grupo)}
                    onAlternar={() => alternar(m.grupo)}
                    igual={igual}
                    valores={<Mudanca igual={igual} hoje={atual === undefined ? "—" : pct(atual)} realizado={pct(novo)} delta={atual === undefined ? undefined : deltaPp(atual, novo)} />}
                    nota={<>Mês seguinte {pct(m.mesSeguinte ?? 0)}{(m.depois ?? 0) > 0 ? `, depois ${pct(m.depois ?? 0)} (o modelo manda esse resto para o mês seguinte)` : ""}. Base: <Reais valor={m.base} />.</>}
                  />
                );
              })}
            </ul>
            <SemSugestao rotulo={`Sem dado no ERP de ${anoBase} (fica como está)`} nomes={semValor} />
          </div>
        )}

        {!falhou && <p className="plan-sub">O % pago no mês vale para todas as linhas do grupo. Grupos sem linha no cenário ou sem pagamento no período não aparecem. Os meses usados são só os já fechados e com pagamento concluído.</p>}

        <RodapeDoDialogo resumo={falhou || !dados ? null : marcados === 0 ? "Nada marcado" : `${marcados} ${marcados === 1 ? "premissa marcada" : "premissas marcadas"}`} onCancelar={onFechar}>
          {!falhou && <Button type="button" disabled={carregando || !dados || nada || marcados === 0} onClick={aplicar}>{carregando ? "Buscando…" : marcados > 0 ? `Aplicar ${marcados} ${marcados === 1 ? "mudança" : "mudanças"}` : "Nada a aplicar"}</Button>}
        </RodapeDoDialogo>
      </div>
    </Dialog>
  );
}
