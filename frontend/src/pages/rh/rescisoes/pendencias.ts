// O que precisa ser resolvido antes de lançar uma rescisão — e o que fazer em cada caso.
// Só lê o que o sistema já apurou (apuração da rescisão + detalhe de RH → Rescisões);
// as regras de valor continuam no backend.
import type { ApuracaoRescisao, DetalheRescisao, ItemFolhaAposSaida } from "../../../api/client";
import { ROTAS_RH } from "../rotasRh";

/** acao = resolver antes de lançar; aviso = conferir; ok = está certo, só para saber. */
export type TomPendencia = "acao" | "aviso" | "ok";

export type AcaoPendencia =
  | { tipo: "excluir"; itemId: string; rotulo: string; motivoSugerido: string }
  | { tipo: "link"; para: string; rotulo: string }
  | { tipo: "passo"; passo: 1 | 2; rotulo: string };

export type Pendencia = {
  id: string;
  tom: TomPendencia;
  titulo: string;
  detalhe?: string;
  oQueFazer: string;
  valor?: number;
  acao?: AcaoPendencia;
};

const ORDEM: Record<TomPendencia, number> = { acao: 0, aviso: 1, ok: 2 };
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** "09/2026" → 202609, para comparar competências. */
const chaveCompetencia = (mmAaaa: string) => Number(mmAaaa.slice(3, 7)) * 100 + Number(mmAaaa.slice(0, 2));
const competenciaDaData = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const ROTULO_FICA = { BILHETE_MENSAL: "Bilhete mensal", AJUDA_DE_CUSTO: "Ajuda de custo" } as const;

function pendenciaDoItem(item: ItemFolhaAposSaida, saida: string): Pendencia {
  const depoisDoMes = chaveCompetencia(item.competencia) > chaveCompetencia(competenciaDaData(saida));
  const doMesOuDepois = chaveCompetencia(item.competencia) >= chaveCompetencia(competenciaDaData(saida));
  const excluir = (motivo: string): AcaoPendencia => ({ tipo: "excluir", itemId: item.id, rotulo: "Excluir lançamento", motivoSugerido: `${motivo} (saída em ${dataBr(saida)})` });
  const base = { id: `folha-${item.id}`, valor: item.valor, detalhe: `${item.rotulo} · competência ${item.competencia} · vence ${dataBr(item.vencimento)} · ainda não pago` };

  if (item.ficaComAPessoa) {
    const nome = ROTULO_FICA[item.ficaComAPessoa];
    if (!depoisDoMes) {
      return { ...base, tom: "ok", titulo: `${nome} do mês da saída fica com a pessoa`, oQueFazer: "Não exclua e não desconte na rescisão: é a regra do bilhete mensal e da ajuda de custo." };
    }
    return {
      ...base, tom: "acao",
      titulo: `${nome} de ${item.competencia}: mês inteiro depois da saída`,
      oQueFazer: "A pessoa não trabalha nesse mês. Exclua o lançamento para não pagar.",
      acao: excluir(`${nome} de mês posterior à saída`),
    };
  }
  if (item.tipo === "VALE_TRANSPORTE") {
    return {
      ...base, tom: "acao", titulo: "VT para dias depois da saída",
      oQueFazer: "Exclua o lançamento: a pessoa não vai usar o VT desses dias.",
      acao: excluir("VT de dias depois da saída"),
    };
  }
  const nomeTipo = item.tipo === "ADIANTAMENTO" ? "Adiantamento" : "Salário";
  if (!doMesOuDepois) {
    return { ...base, tom: "ok", titulo: `${nomeTipo} de ${item.competencia} ainda a pagar`, oQueFazer: "É de mês anterior à saída: é devido, pague normalmente em Contas a Pagar." };
  }
  return {
    ...base, tom: "acao", titulo: `${nomeTipo} de ${item.competencia} ainda vai sair pela Folha`,
    oQueFazer: "O salário até a saída é pago na rescisão (sem registro: apurado aqui; CLT: vem no termo). Exclua para não pagar duas vezes.",
    acao: excluir(`${nomeTipo} pago na rescisão`),
  };
}

function pendenciasDaGorjeta(a: ApuracaoRescisao, detalhe: DetalheRescisao): Pendencia[] {
  if (a.jaPagoNaLista) return [];
  const linkGorjeta: AcaoPendencia = { tipo: "link", para: ROTAS_RH.gorjeta, rotulo: "Abrir Apuração de gorjeta" };
  const semPeriodo = (a.gorjetaPartes ?? []).filter((p) => p.valor == null && !p.pendente && !p.jaPagoNaLista);
  if (semPeriodo.length > 0) {
    return semPeriodo.map((p) => ({
      id: `gorjeta-${p.competencia}`, tom: "acao" as const,
      titulo: `Período de gorjeta de ${p.competencia} não existe`,
      detalhe: `A gorjeta de ${p.dias} não pode ser apurada sem ele.`,
      oQueFazer: "Abra o período em Apuração de gorjeta e volte aqui, ou lance agora e ajuste depois (com justificativa).",
      acao: linkGorjeta,
    }));
  }
  const pendente = a.gorjeta?.pendente || (a.gorjetaPartes ?? []).some((p) => p.pendente);
  if (pendente) {
    return [{
      id: "gorjeta-pendente", tom: "aviso", titulo: "Gorjeta até a saída pendente",
      oQueFazer: "Falta o serviço (faturamento) até a saída. Importe o faturamento e atualize a apuração da gorjeta.",
      acao: linkGorjeta,
    }];
  }
  if (!a.gorjeta && (!detalhe.periodoGorjeta || !detalhe.periodoGorjeta.participa)) {
    return [{
      id: "gorjeta-sem-periodo", tom: "aviso", titulo: "Gorjeta até a saída não apurada",
      detalhe: a.gorjetaObservacao ?? undefined,
      oQueFazer: "Confira em Apuração de gorjeta se a pessoa está no período da saída. Sem isso, digite a gorjeta no passo 4.",
      acao: linkGorjeta,
    }];
  }
  return [];
}

function pendenciasDosVales(a: ApuracaoRescisao): Pendencia[] {
  if (a.jaPagoNaLista) return [];
  const vales = a.vales.itens.filter((v) => v.tipo !== "CREDITO");
  if (vales.length === 0) return [];
  const total = Math.round(vales.reduce((s, v) => s + v.valor, 0) * 100) / 100;
  const titulo = `${vales.length} ${vales.length === 1 ? "vale" : "vales"} em aberto na gorjeta do mês`;
  const detalhe = vales.map((v) => v.codigo ?? v.tipo).join(" · ");
  if (!a.semRegistro) {
    return [{ id: "vales", tom: "ok", titulo, detalhe, valor: total, oQueFazer: "Já foram descontados da gorjeta enviada à contabilidade: não abatem de novo na rescisão." }];
  }
  return [{
    id: "vales", tom: "aviso", titulo, detalhe, valor: total,
    oQueFazer: "Entram no desconto da rescisão (passo 4). Se algum já foi descontado ou devolvido, quite na aba Vales antes de lançar.",
    acao: { tipo: "link", para: ROTAS_RH.gorjeta, rotulo: "Abrir aba Vales" },
  }];
}

function pendenciasDoRegistrado(detalhe: DetalheRescisao): Pendencia[] {
  const lista: Pendencia[] = [];
  const quitada = Boolean(detalhe.pessoa.rescisao?.quitadaNoTermo || detalhe.pessoa.rescisao?.quitadaSemValor);
  if (!detalhe.pessoa.termo && !quitada) {
    lista.push({
      id: "termo", tom: "acao", titulo: "Termo de rescisão (TRCT) ainda não importado",
      oQueFazer: "Importe o PDF da contabilidade no passo 2: a gorjeta do termo vira a gorjeta quitada e a lista do mês marca \"pago na rescisão\".",
      acao: { tipo: "passo", passo: 2, rotulo: "Importar o termo" },
    });
  }
  const e = detalhe.extratoDoMes;
  if (e && !e.importado) {
    lista.push({
      id: "extrato", tom: "aviso", titulo: `Folha de ${e.competencia} (Retorno do RH) ainda não importada`,
      oQueFazer: "Quando a contabilidade enviar o extrato do mês, importe em Retorno do RH para conferir o líquido e lançar a folha.",
      acao: { tipo: "link", para: ROTAS_RH.retorno, rotulo: "Abrir Retorno do RH" },
    });
  }
  return lista;
}

export function pendenciasDaRescisao(entrada: { detalhe: DetalheRescisao; apuracao: ApuracaoRescisao | null }): Pendencia[] {
  const { detalhe, apuracao: a } = entrada;
  const saida = detalhe.pessoa.saida;
  if (!saida) {
    return [{
      id: "saida", tom: "acao", titulo: "Sem data de saída",
      oQueFazer: "Registre a data de saída no passo 1: sem ela não há o que apurar.",
      acao: { tipo: "passo", passo: 1, rotulo: "Registrar a saída" },
    }];
  }
  const semRegistro = a?.semRegistro ?? detalhe.pessoa.semRegistro;
  const lista: Pendencia[] = [];
  if (a?.jaPagoNaLista) {
    lista.push({
      id: "ja-pago", tom: "acao", titulo: `Já paga na lista de pagamento da gorjeta de ${a.jaPagoNaLista.competencia}`,
      valor: a.jaPagoNaLista.valor,
      oQueFazer: "Não lance a rescisão de novo: salário e gorjeta até a saída já saíram pela lista fechada.",
    });
  }
  lista.push(...detalhe.itensAposSaida.map((i) => pendenciaDoItem(i, saida)));
  // Quitada (no termo, ou sem valor: líquido zero / saldo perdoado): concluída — nem termo,
  // nem gorjeta a digitar.
  const quitada = Boolean(detalhe.pessoa.rescisao?.quitadaNoTermo || detalhe.pessoa.rescisao?.quitadaSemValor);
  if (a) {
    lista.push(...pendenciasDosVales(a), ...(quitada ? [] : pendenciasDaGorjeta(a, detalhe)));
    if (a.vt.semDetalhe.length > 0) {
      lista.push({
        id: "vt-sem-detalhe", tom: "aviso", titulo: "VT sem a lista de dias pagos",
        detalhe: a.vt.semDetalhe.join(", "),
        oQueFazer: "O sistema não sabe que dias esses lançamentos cobriram: confira à mão se algum pagou dias depois da saída e desconte no passo 4.",
      });
    }
  }
  if (!semRegistro) lista.push(...pendenciasDoRegistrado(detalhe));
  return lista
    .map((p, i) => ({ p, i }))
    .sort((x, y) => ORDEM[x.p.tom] - ORDEM[y.p.tom] || x.i - y.i)
    .map(({ p }) => p);
}
