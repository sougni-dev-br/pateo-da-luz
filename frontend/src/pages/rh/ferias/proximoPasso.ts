// O que fazer a seguir com as férias de cada pessoa, em uma frase (vai na folha impressa, ao lado de cada nome).
import type { PeriodoFerias, PessoaFerias } from "../../../api/client";
import { dataBr } from "./feriasFormato";
import { compararPedido } from "./pedido";
import { prazoParaAvisar } from "./regrasFerias";

export type PassoDaPessoa = { texto: string; /** Prazo vencido ou perto de vencer: a folha destaca. */ urgente: boolean };

const temDiasAProgramar = (p: PeriodoFerias) => p.diasPendentes > 0 && p.situacao !== "EM_AQUISICAO" && !p.doHistorico;
const programadas = (p: PeriodoFerias) => p.programacoes.filter((g) => g.status === "PROGRAMADA" && g.gozoInicio !== null);

/** O período que a ficha da pessoa descreve: o que tem pedido, senão o que ainda tem dias a programar, senão o primeiro com férias programadas. */
export function periodoDaFicha(pessoa: PessoaFerias): PeriodoFerias | null {
  return pessoa.periodos.find((p) => p.solicitacao)
    ?? pessoa.periodos.find(temDiasAProgramar)
    ?? pessoa.periodos.find((p) => programadas(p).length > 0)
    ?? null;
}

/**
 * A próxima providência do período, na ordem em que pesa:
 * prazo vencido → definir a data; pedido sem resposta ou dias a programar → definir até o limite;
 * pedido atendido com outra data → avisar a pessoa; férias programadas sem aviso → avisar (30 dias antes);
 * férias que já passaram da data → confirmar que gozou.
 */
export function proximoPasso(periodo: PeriodoFerias, hoje: string): PassoDaPessoa | null {
  const comparacao = compararPedido(periodo);
  if (temDiasAProgramar(periodo)) {
    const limite = dataBr(periodo.limiteInicioGozo);
    if (periodo.situacao === "VENCIDA" || periodo.limiteInicioGozo < hoje) return { texto: `Definir a data já: o prazo venceu em ${limite}`, urgente: true };
    const urgente = periodo.nivel !== "ok";
    if (comparacao?.situacao === "AGUARDANDO") return { texto: `Responder ao pedido e definir a data até ${limite}`, urgente };
    if (programadas(periodo).length > 0) return { texto: `Programar o resto (${periodo.diasPendentes} dias) até ${limite}`, urgente };
    return { texto: `Definir a data até ${limite}`, urgente };
  }
  if (comparacao?.situacao === "DIFERENTE" && periodo.solicitacao) {
    return { texto: `Avisar que a empresa quer outra data (ele pediu ${dataBr(periodo.solicitacao.inicio)})`, urgente: false };
  }
  const semAviso = programadas(periodo).filter((g) => (g.gozoInicio as string) > hoje && !g.avisadoEm).sort((a, b) => (a.gozoInicio as string).localeCompare(b.gozoInicio as string))[0];
  if (semAviso) {
    const ate = prazoParaAvisar(semAviso.gozoInicio as string);
    return ate < hoje ? { texto: `Avisar já: o prazo era ${dataBr(ate)}`, urgente: true } : { texto: `Avisar até ${dataBr(ate)}`, urgente: false };
  }
  if (programadas(periodo).some((g) => g.passouDaData)) return { texto: "Confirmar que gozou", urgente: false };
  return null;
}
