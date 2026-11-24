import { useEffect, useState } from "react";
import { getPlanejamentoRealizado, type PlanejamentoLinhaDeGasto, type PlanejamentoProjecao, type PlanejamentoRealizado } from "../../api/client";
import { mensagemHumana } from "./erros";
import { percentualParaTexto, ROTULO_DO_GRUPO } from "./formato";
import { emMil } from "./Reais";
import { useOculto } from "./useOculto";

// Leitura de cada linha de gasto enquanto se digita: quanto ela pesa na margem bruta do período projetado (uma
// microbarra) e quanto o mesmo grupo custou no ano-base (o realizado do DRE). Só exibição: o cálculo do cenário é
// do servidor; aqui é a mesma conta simples (R$ fixo, ou % × vendas do mês) para dar a escala da linha.

/** Valor da linha nos meses que têm projeção (R$ do mês, ou % × vendas projetadas do mês). */
export function valorNoPeriodo(linha: PlanejamentoLinhaDeGasto, projecao: PlanejamentoProjecao | null | undefined): number | null {
  if (!projecao) return null;
  return projecao.meses.reduce((soma, m, i) => {
    if (!m.projetado) return soma;
    const v = linha.valores[i] ?? 0;
    return soma + (linha.modo === "PERCENTUAL" ? v * m.projetado.vendas.total : v);
  }, 0);
}

/** Fração da margem bruta do período que a linha consome (0,34 = 34%), ou null sem margem. */
export function pesoNaMargem(linha: PlanejamentoLinhaDeGasto, projecao: PlanejamentoProjecao | null | undefined): number | null {
  const margem = projecao?.total.margemBruta ?? null;
  const valor = valorNoPeriodo(linha, projecao);
  if (margem === null || margem <= 0 || valor === null) return null;
  return valor / margem;
}

export function PesoNaMargem({ linha, projecao }: { linha: PlanejamentoLinhaDeGasto; projecao: PlanejamentoProjecao | null | undefined }) {
  const peso = pesoNaMargem(linha, projecao);
  if (peso === null) return null;
  const largura = Math.min(1, peso) * 100;
  const pesado = peso >= 0.25;
  return (
    <span className={`plan-peso${pesado ? " plan-peso-forte" : ""}`} title="Quanto desta margem bruta (vendas − CMV) a linha consome no período projetado">
      <span className="plan-peso-trilho" aria-hidden><span className="plan-peso-barra" style={{ transform: `scaleX(${largura / 100})` }} /></span>
      <span className="plan-peso-texto">{Math.round(peso * 100).toLocaleString("pt-BR")}% da margem bruta</span>
    </span>
  );
}

export type RealizadoDoAnoBase = { dados: PlanejamentoRealizado | null; erro: string | null; carregando: boolean };

/** Realizado do ano-base por grupo, buscado só quando a aba de gastos abre (é a mesma chamada do diálogo). */
export function useRealizadoDoAnoBase(anoBase: number, ativo: boolean): RealizadoDoAnoBase {
  const [estado, setEstado] = useState<RealizadoDoAnoBase>({ dados: null, erro: null, carregando: false });
  useEffect(() => {
    if (!ativo || anoBase <= 0) return undefined;
    let cancelado = false;
    setEstado((atual) => ({ ...atual, carregando: true, erro: null }));
    getPlanejamentoRealizado(anoBase, true)
      .then((dados) => { if (!cancelado) setEstado({ dados, erro: null, carregando: false }); })
      .catch((e: unknown) => { if (!cancelado) setEstado({ dados: null, erro: mensagemHumana(e, "O realizado não carregou."), carregando: false }); });
    return () => { cancelado = true; };
  }, [anoBase, ativo]);
  return estado;
}

/** "2026: 52 mil/mês" na primeira linha de cada grupo; nas outras do mesmo grupo, nada (o DRE é por grupo). */
export function ReferenciaDoAnoBase({ linha, indice, gastos, anoBase, realizado }: { linha: PlanejamentoLinhaDeGasto; indice: number; gastos: readonly PlanejamentoLinhaDeGasto[]; anoBase: number; realizado?: RealizadoDoAnoBase }) {
  const hidden = useOculto();
  if (!realizado?.dados) return null;
  if (gastos.findIndex((g) => g.grupo === linha.grupo) !== indice) return null;
  const grupo = realizado.dados.grupos.find((g) => g.grupo === linha.grupo);
  if (!grupo) return null;
  const titulo = `${ROTULO_DO_GRUPO[linha.grupo] ?? linha.grupo} no DRE de ${anoBase}, média dos meses fechados`;
  if (grupo.media === null || !grupo.origemNoDre) return <span className="plan-referencia" title={titulo}>{anoBase}: sem lançamento</span>;
  const texto = linha.modo === "PERCENTUAL"
    ? grupo.percentualDaReceita === null ? "sem receita" : `${percentualParaTexto(grupo.percentualDaReceita)}% da receita`
    : `${hidden ? "••••" : emMil(grupo.media)}/mês`;
  return <span className="plan-referencia" title={titulo}>{anoBase} real: {texto}</span>;
}
