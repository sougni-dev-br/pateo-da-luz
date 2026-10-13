import type { WasteAnalysis, WasteAnalysisGroup, WasteEntry, WasteReason } from "../../api/client";
import { somarDiasIso } from "./motivos";

// Leitura do período: transforma os números do servidor em "o que mudou, por que importa e o que fazer".
// Tudo aqui é função pura (testada); a tela só desenha o resultado.

// ── Períodos prontos ──

export type PeriodoPronto = "HOJE" | "7D" | "30D" | "MES" | "MES_ANTERIOR";

export const PERIODOS_PRONTOS: ReadonlyArray<{ value: PeriodoPronto; label: string }> = [
  { value: "HOJE", label: "Hoje" },
  { value: "7D", label: "7 dias" },
  { value: "30D", label: "30 dias" },
  { value: "MES", label: "Este mês" },
  { value: "MES_ANTERIOR", label: "Mês passado" },
];

const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const iso = (ano: number, mes: number, dia: number) => `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

export function intervaloDoPeriodo(periodo: PeriodoPronto, hoje: string): { de: string; ate: string } {
  const [ano, mes] = hoje.split("-").map(Number);
  switch (periodo) {
    case "HOJE": return { de: hoje, ate: hoje };
    case "7D": return { de: somarDiasIso(hoje, -6), ate: hoje };
    case "30D": return { de: somarDiasIso(hoje, -29), ate: hoje };
    case "MES": return { de: iso(ano, mes, 1), ate: hoje };
    case "MES_ANTERIOR": {
      const anoAnterior = mes === 1 ? ano - 1 : ano;
      const mesAnterior = mes === 1 ? 12 : mes - 1;
      return { de: iso(anoAnterior, mesAnterior, 1), ate: iso(anoAnterior, mesAnterior, ultimoDiaDoMes(anoAnterior, mesAnterior)) };
    }
  }
}

/** Qual atalho corresponde às datas na tela (para destacá-lo); nenhum quando a pessoa digitou outro intervalo. */
export function periodoProntoDe(de: string, ate: string, hoje: string): PeriodoPronto | null {
  return PERIODOS_PRONTOS.find((p) => {
    const i = intervaloDoPeriodo(p.value, hoje);
    return i.de === de && i.ate === ate;
  })?.value ?? null;
}

// ── Variação contra o período anterior ──

export type Variacao =
  | { tipo: "SEM_BASE" }
  | { tipo: "IGUAL" }
  | { tipo: "SOBE" | "DESCE"; percentual: number; diferenca: number };

/** Com período anterior zerado não existe percentual: "sem base" é mais honesto do que "+∞%". */
export function variacao(atual: number | null, anterior: number | null): Variacao {
  if (atual == null || anterior == null || !(anterior > 0)) return { tipo: "SEM_BASE" };
  const diferenca = Math.round((atual - anterior) * 100) / 100;
  if (diferenca === 0) return { tipo: "IGUAL" };
  return { tipo: diferenca > 0 ? "SOBE" : "DESCE", percentual: Math.round((Math.abs(diferenca) / anterior) * 100), diferenca };
}

// ── Gráfico do período ──

export type Barra = { inicio: string; fim: string; lancamentos: number; valor: number | null };

/** Acima disto o gráfico agrupa em semanas: 366 barras de 2 px não se leem nem se tocam no celular. */
const MAX_BARRAS_POR_DIA = 62;
const DIAS_POR_SEMANA = 7;

export function serieDoGrafico(porDia: WasteAnalysis["porDia"]): { barras: Barra[]; porSemana: boolean } {
  if (porDia.length <= MAX_BARRAS_POR_DIA) {
    return { barras: porDia.map((d) => ({ inicio: d.dia, fim: d.dia, lancamentos: d.lancamentos, valor: d.valor })), porSemana: false };
  }
  const barras: Barra[] = [];
  for (let i = 0; i < porDia.length; i += DIAS_POR_SEMANA) {
    const bloco = porDia.slice(i, i + DIAS_POR_SEMANA);
    barras.push({
      inicio: bloco[0].dia,
      fim: bloco[bloco.length - 1].dia,
      lancamentos: bloco.reduce((s, d) => s + d.lancamentos, 0),
      valor: bloco[0].valor == null ? null : Math.round(bloco.reduce((s, d) => s + (d.valor ?? 0), 0) * 100) / 100,
    });
  }
  return { barras, porSemana: true };
}

// ── O que fazer ──

export type Tom = "danger" | "warn" | "info" | "ok";
export type FiltroDaLeitura = { tipo: "motivo"; valor: string } | { tipo: "item"; valor: string; rotulo: string };
export type Leitura = { id: string; tom: Tom; titulo: string; detalhe: string; acao: string; filtro?: FiltroDaLeitura };

/** O que costuma estar por trás de cada motivo e o primeiro passo para reduzi-lo. */
export const PLAYBOOK: Record<WasteReason, string> = {
  EXPIRED: "Vencimento é compra acima do giro ou falta de controle de validade: confira o pedido mínimo e use primeiro o que vence primeiro (PVPS), com etiqueta de validade nas câmaras.",
  SPOILED: "Estrago é armazenamento: confira temperatura das câmaras, embalagem aberta e o prazo de uso depois de aberto.",
  BREAKAGE: "Quebra e avaria vêm do manuseio ou da entrega: confira o recebimento (rejeitar na hora, cobrar o fornecedor) e a embalagem de transporte.",
  PREPARATION_ERROR: "Erro de preparo pede padrão: reforce a ficha técnica na bancada, treine o porcionamento e deixe a receita à vista.",
  PRODUCTION_LEFTOVER: "Sobra de produção é previsão de público: produza em lotes menores, reponha por demanda e compare o produzido com o vendido.",
  CUSTOMER_RETURN: "Devolução é qualidade percebida: veja qual prato volta mais (ponto, temperatura, sabor) e ajuste o preparo ou a descrição.",
  CONTAMINATION: "Contaminação é cadeia fria e higiene: revise separação de alimentos, higienização e temperatura, e registre o que foi feito.",
  OTHER: "Sem motivo claro não dá para agir: oriente a equipe a escolher o motivo mais próximo e deixe 'Outro' só para o que não se encaixa.",
};

const ALTA_RELEVANTE_PERCENTUAL = 25;
const ALTA_RELEVANTE_VALOR = 50;
const ALTA_RELEVANTE_LANCAMENTOS = 5;
const MOTIVO_DOMINANTE_PARTICIPACAO = 0.4;
const MIN_LANCAMENTOS_PARA_LER = 5;
const POUCOS_ITENS_CONCENTRAM = 3;
const MIN_ITENS_PARA_CONCENTRAR = 5;
const DIA_DA_SEMANA_PESADO = 1.8;
const MIN_OCORRENCIAS_DO_DIA = 2;
const MIN_LANCAMENTOS_DO_DIA = 3;
const DIAS_SEM_REGISTRO_PARTICIPACAO = 0.3;
const MIN_DIAS_COM_VENDA = 7;
const SEM_CUSTO_MINIMO = 3;
const OUTRO_PARTICIPACAO = 0.25;
const RETROATIVO_PARTICIPACAO = 0.3;
const MIN_SEM_FOTO = 3;
const TAXA_DE_PERDA_ALTA = 10;
const MIN_LANCAMENTOS_PARA_TAXA = 3;
const MAX_LEITURAS = 6;

const ORDEM_DO_TOM: Record<Tom, number> = { danger: 0, warn: 1, info: 2, ok: 3 };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** Mede um grupo pelo valor quando há custo; senão pela contagem de lançamentos. */
const medida = (g: Pick<WasteAnalysisGroup, "valor" | "lancamentos">, veCusto: boolean) => (veCusto ? g.valor ?? 0 : g.lancamentos);
const medidaAnterior = (g: Pick<WasteAnalysisGroup, "anteriorValor" | "anteriorLancamentos">, veCusto: boolean) => (veCusto ? g.anteriorValor ?? 0 : g.anteriorLancamentos);

function quemMaisCresceu(analise: WasteAnalysis, veCusto: boolean): string | null {
  const candidatos = [...analise.porMotivo, ...analise.porProduto]
    .map((g) => ({ nome: g.nome, aumento: medida(g, veCusto) - medidaAnterior(g, veCusto) }))
    .filter((g) => g.aumento > 0)
    .sort((a, b) => b.aumento - a.aumento);
  const topo = candidatos[0];
  if (!topo) return null;
  return veCusto ? `${topo.nome} (+${brl(topo.aumento)})` : `${topo.nome} (+${topo.aumento})`;
}

export function lerPeriodo(analise: WasteAnalysis, veCusto: boolean): Leitura[] {
  const leituras: Leitura[] = [];
  const total = analise.total;
  if (total.lancamentos === 0) return leituras;

  // 1. O que mudou em relação ao período anterior.
  const atual = veCusto ? total.valor : total.lancamentos;
  const anterior = veCusto ? analise.anterior.valor : analise.anterior.lancamentos;
  const v = variacao(atual, anterior);
  const limiar = veCusto ? ALTA_RELEVANTE_VALOR : ALTA_RELEVANTE_LANCAMENTOS;
  if ((v.tipo === "SOBE" || v.tipo === "DESCE") && v.percentual >= ALTA_RELEVANTE_PERCENTUAL && Math.abs(v.diferenca) >= limiar) {
    const quantidade = veCusto ? brl(Math.abs(v.diferenca)) : `${Math.abs(v.diferenca)} ${plural(Math.abs(v.diferenca), "lançamento", "lançamentos")}`;
    if (v.tipo === "SOBE") {
      const cresceu = quemMaisCresceu(analise, veCusto);
      leituras.push({
        id: "alta",
        tom: "danger",
        titulo: `O desperdício subiu ${v.percentual}% em relação ao período anterior`,
        detalhe: `${quantidade} a mais que nos ${analise.periodo.dias} ${plural(analise.periodo.dias, "dia", "dias")} anteriores.${cresceu ? ` Quem mais cresceu: ${cresceu}.` : ""}`,
        acao: "Olhe o que mudou nesse intervalo (pedido, cardápio, evento, equipe) e comece pelo item ou motivo que mais cresceu.",
      });
    } else {
      leituras.push({
        id: "queda",
        tom: "ok",
        titulo: `O desperdício caiu ${v.percentual}% em relação ao período anterior`,
        detalhe: `${quantidade} a menos que nos ${analise.periodo.dias} ${plural(analise.periodo.dias, "dia", "dias")} anteriores.`,
        acao: "Descubra o que foi feito diferente e transforme em rotina.",
      });
    }
  }

  // 2. Motivo dominante: aponta a causa, não só o tamanho.
  const somaDosMotivos = analise.porMotivo.reduce((s, g) => s + medida(g, veCusto), 0);
  const topoMotivo = analise.porMotivo[0];
  if (topoMotivo && total.lancamentos >= MIN_LANCAMENTOS_PARA_LER && somaDosMotivos > 0 && medida(topoMotivo, veCusto) / somaDosMotivos >= MOTIVO_DOMINANTE_PARTICIPACAO) {
    const parte = Math.round((medida(topoMotivo, veCusto) / somaDosMotivos) * 100);
    leituras.push({
      id: "motivo",
      tom: "warn",
      titulo: `${topoMotivo.nome} responde por ${parte}% ${veCusto ? "do valor" : "dos lançamentos"}`,
      detalhe: veCusto ? `${brl(topoMotivo.valor ?? 0)} em ${topoMotivo.lancamentos} ${plural(topoMotivo.lancamentos, "lançamento", "lançamentos")}.` : `${topoMotivo.lancamentos} lançamentos.`,
      acao: PLAYBOOK[topoMotivo.chave as WasteReason] ?? PLAYBOOK.OTHER,
      filtro: { tipo: "motivo", valor: topoMotivo.chave },
    });
  }

  // 3. Perda que se repete é processo, não azar.
  const reincidente = analise.reincidentes[0];
  if (reincidente) {
    leituras.push({
      id: "reincidente",
      tom: "warn",
      titulo: `${reincidente.nome} foi perdido em ${reincidente.dias} dias diferentes`,
      detalhe: `${reincidente.lancamentos} ${plural(reincidente.lancamentos, "lançamento", "lançamentos")}, principalmente por ${reincidente.motivoPrincipalRotulo.toLowerCase()}${veCusto && reincidente.valor ? ` (${brl(reincidente.valor)})` : ""}.`,
      acao: `Perda que se repete é de processo. ${PLAYBOOK[reincidente.motivoPrincipal] ?? ""}`.trim(),
      filtro: { tipo: "item", valor: reincidente.chave, rotulo: reincidente.nome },
    });
  }

  // 3b. Perdeu uma parte grande do que comprou: o sinal mais direto de pedido acima do giro ou de manuseio ruim.
  const taxaAlta = veCusto
    ? analise.porProduto.find((p) => p.taxaDePerda != null && p.taxaDePerda >= TAXA_DE_PERDA_ALTA && p.lancamentos >= MIN_LANCAMENTOS_PARA_TAXA)
    : undefined;
  if (taxaAlta && taxaAlta.taxaDePerda != null && taxaAlta.comprado != null) {
    const nome = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
    const un = taxaAlta.unidade ? ` ${taxaAlta.unidade}` : "";
    leituras.push({
      id: "taxa-de-perda",
      tom: "warn",
      titulo: `${taxaAlta.nome} perdeu ${taxaAlta.taxaDePerda.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do que foi comprado no período`,
      detalhe: `${nome(taxaAlta.quantidade ?? 0)}${un} perdidos de ${nome(taxaAlta.comprado)}${un} comprados.`,
      acao: "Compare o pedido com o giro real: comprar menos e com mais frequência costuma custar menos do que perder.",
      filtro: { tipo: "item", valor: taxaAlta.chave, rotulo: taxaAlta.nome },
    });
  }

  // 4. Poucos itens concentram a perda: foco.
  if (veCusto && analise.itensPara80 != null && analise.produtosTotal >= MIN_ITENS_PARA_CONCENTRAR && analise.itensPara80 <= POUCOS_ITENS_CONCENTRAM) {
    leituras.push({
      id: "concentracao",
      tom: "info",
      titulo: `${analise.itensPara80} de ${analise.produtosTotal} itens ${plural(analise.itensPara80, "concentra", "concentram")} 80% do valor perdido`,
      detalhe: `Os maiores: ${analise.porProduto.slice(0, analise.itensPara80).map((p) => p.nome).join(", ")}.`,
      acao: "Não adianta perseguir todos os itens: comece por esses, que têm o maior retorno.",
    });
  }

  // 5. Dia da semana que pesa mais que os outros.
  const mediaGeral = medida({ valor: total.valor, lancamentos: total.lancamentos }, veCusto) / analise.periodo.dias;
  const pesado = analise.porDiaDaSemana
    .filter((d) => d.ocorrencias >= MIN_OCORRENCIAS_DO_DIA && d.lancamentos >= MIN_LANCAMENTOS_DO_DIA)
    .map((d) => ({ nome: d.nome, media: medida(d, veCusto) / d.ocorrencias }))
    .sort((a, b) => b.media - a.media)[0];
  if (pesado && mediaGeral > 0 && pesado.media / mediaGeral >= DIA_DA_SEMANA_PESADO) {
    leituras.push({
      id: "dia-da-semana",
      tom: "info",
      titulo: `${pesado.nome} perde ${(pesado.media / mediaGeral).toFixed(1).replace(".", ",")}× a média diária do período`,
      detalhe: veCusto ? `Em média ${brl(pesado.media)} por ${pesado.nome.toLowerCase()}, contra ${brl(mediaGeral)} por dia.` : `Em média ${pesado.media.toFixed(1).replace(".", ",")} lançamentos por ${pesado.nome.toLowerCase()}.`,
      acao: "Ajuste produção e pedido desse dia da semana ao movimento real, em vez de usar a mesma quantidade todos os dias.",
    });
  }

  // 6. Confiança nos dados: o que ainda impede a leitura de ser completa.
  const q = analise.qualidade;
  if (q.diasSemRegistro != null && q.diasComVenda != null && q.diasComVenda >= MIN_DIAS_COM_VENDA && q.diasSemRegistro / q.diasComVenda >= DIAS_SEM_REGISTRO_PARTICIPACAO) {
    leituras.push({
      id: "dias-sem-registro",
      tom: "warn",
      titulo: `${q.diasSemRegistro} de ${q.diasComVenda} dias com venda não têm nenhum registro de desperdício`,
      detalhe: "Dia de operação sem perda nenhuma é raro: provavelmente ninguém lançou.",
      acao: "Combine um horário para o lançamento do fechamento do dia. Sem registro o número real de perda é maior que o mostrado.",
    });
  }
  if (veCusto && q.semCusto >= SEM_CUSTO_MINIMO) {
    leituras.push({
      id: "sem-custo",
      tom: "info",
      titulo: `${q.semCusto} lançamentos estão sem custo e não entram no valor`,
      detalhe: "O valor mostrado está abaixo do real.",
      acao: "Registre a compra do item na unidade do estoque (ou, para prato, a ficha técnica completa) para que o custo apareça.",
    });
  }
  if (total.lancamentos >= MIN_LANCAMENTOS_PARA_LER && q.motivoOutro / total.lancamentos >= OUTRO_PARTICIPACAO && q.motivoOutro >= SEM_CUSTO_MINIMO) {
    leituras.push({
      id: "motivo-outro",
      tom: "info",
      titulo: `${q.motivoOutro} lançamentos estão como "Outro"`,
      detalhe: "Sem um motivo claro não dá para dizer o que corrigir.",
      acao: PLAYBOOK.OTHER,
      filtro: { tipo: "motivo", valor: "OTHER" },
    });
  }
  if (total.lancamentos >= MIN_LANCAMENTOS_PARA_LER && q.retroativos / total.lancamentos >= RETROATIVO_PARTICIPACAO && q.retroativos >= SEM_CUSTO_MINIMO) {
    leituras.push({
      id: "retroativo",
      tom: "info",
      titulo: `${q.retroativos} lançamentos foram digitados dias depois`,
      detalhe: "Registro de memória perde quantidade e motivo.",
      acao: "Lance na hora, ou no fechamento do dia, com foto quando o valor for alto.",
    });
  }
  if (veCusto && q.semFotoNosMaiores >= MIN_SEM_FOTO) {
    leituras.push({
      id: "sem-foto",
      tom: "info",
      titulo: `${q.semFotoNosMaiores} dos 10 maiores lançamentos estão sem foto`,
      detalhe: "A foto é a prova do que foi perdido e ajuda a achar a causa.",
      acao: "Peça foto nos lançamentos de valor alto; dá para anexar na lista, até 2 dias depois.",
    });
  }

  return leituras
    .map((l, i) => ({ l, i }))
    .sort((a, b) => ORDEM_DO_TOM[a.l.tom] - ORDEM_DO_TOM[b.l.tom] || a.i - b.i)
    .map(({ l }) => l)
    .slice(0, MAX_LEITURAS);
}

// ── Exportação ──

const SEPARADOR = ";";
const numeroBr = (n: number) => String(n).replace(".", ",");

/** Planilha abre texto que começa com = + - @ como fórmula; o apóstrofo a neutraliza. */
function celula(valor: string | number | null | undefined): string {
  if (valor == null) return "";
  const texto = typeof valor === "number" ? numeroBr(valor) : valor;
  const seguro = typeof valor === "string" && /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** CSV dos lançamentos como estão na tela (UTF-8 com BOM, separador `;`, números com vírgula): abre direto no Excel em pt-BR. */
export function csvDosLancamentos(itens: WasteEntry[], veCusto: boolean): string {
  const cabecalho = ["Data", "Item", "Código", "Setor", "Quantidade digitada", "Unidade digitada", "Quantidade no estoque", "Unidade do estoque", "Motivo", ...(veCusto ? ["Valor (R$)"] : []), "Observação", "Situação"];
  const linhas = itens.map((i) => [
    i.occurredOn.split("-").reverse().join("/"),
    i.productName,
    i.productCode,
    i.sectorName,
    i.enteredQuantity ?? i.quantity,
    i.enteredQuantity != null ? i.enteredUnit : i.unit,
    i.quantity,
    i.unit,
    i.reasonLabel,
    ...(veCusto ? [typeof i.totalCost === "number" ? i.totalCost : null] : []),
    i.notes,
    i.cancelledAt ? `Cancelado: ${i.cancelReason ?? ""}` : "Ativo",
  ]);
  return `﻿${[cabecalho, ...linhas].map((l) => l.map(celula).join(SEPARADOR)).join("\r\n")}\r\n`;
}
