// O que fazer a seguir com as férias de cada pessoa, em uma frase (vai na folha impressa, ao lado de cada nome).
import type { PeriodoFerias, PessoaFerias } from "../../../api/client";
import { dataBr, somaDias } from "./feriasFormato";
import { compararPedido } from "./pedido";
import { prazoParaAvisar } from "./regrasFerias";

export type TipoDePasso = "vencido" | "responder" | "definir" | "programar-resto" | "avisar-outra" | "avisar" | "confirmar";
export type PassoDaPessoa = { texto: string; tipo: TipoDePasso; /** Prazo vencido ou perto de vencer: a folha destaca. */ urgente: boolean };

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
    if (periodo.situacao === "VENCIDA" || periodo.limiteInicioGozo < hoje) return { texto: `Definir a data já: o prazo venceu em ${limite}`, tipo: "vencido", urgente: true };
    const urgente = periodo.nivel !== "ok";
    if (comparacao?.situacao === "AGUARDANDO") return { texto: `Responder ao pedido e definir a data até ${limite}`, tipo: "responder", urgente };
    if (programadas(periodo).length > 0) return { texto: `Programar o resto (${periodo.diasPendentes} dias) até ${limite}`, tipo: "programar-resto", urgente };
    return { texto: `Definir a data até ${limite}`, tipo: "definir", urgente };
  }
  if (comparacao?.situacao === "DIFERENTE" && periodo.solicitacao) {
    return { texto: `Avisar que a empresa quer outra data (ele pediu ${dataBr(periodo.solicitacao.inicio)})`, tipo: "avisar-outra", urgente: false };
  }
  const semAviso = programadas(periodo).filter((g) => (g.gozoInicio as string) > hoje && !g.avisadoEm).sort((a, b) => (a.gozoInicio as string).localeCompare(b.gozoInicio as string))[0];
  if (semAviso) {
    const ate = prazoParaAvisar(semAviso.gozoInicio as string);
    return ate < hoje ? { texto: `Avisar já: o prazo era ${dataBr(ate)}`, tipo: "avisar", urgente: true } : { texto: `Avisar até ${dataBr(ate)}`, tipo: "avisar", urgente: false };
  }
  if (programadas(periodo).some((g) => g.passouDaData)) return { texto: "Confirmar que gozou", tipo: "confirmar", urgente: false };
  return null;
}

/** Quanto pesa a pessoa na folha: 0 prazo vencido/urgente, 1 pedido a responder, 2 outra providência, 3 nada a decidir. */
export function pesoDaPessoa(pessoa: PessoaFerias, hoje: string): number {
  const periodo = periodoDaFicha(pessoa);
  const passo = periodo ? proximoPasso(periodo, hoje) : null;
  if (!passo) return 3;
  if (passo.urgente || passo.tipo === "vencido") return 0;
  return passo.tipo === "responder" ? 1 : 2;
}

/** Empresas na ordem em que aparecem; dentro de cada uma, quem exige providência primeiro (a ordem original desempata). */
export function ordenarPorUrgencia(pessoas: PessoaFerias[], hoje: string): PessoaFerias[] {
  const empresa = (p: PessoaFerias) => p.empresa ?? "Sem empresa";
  const ordemEmpresa = new Map<string, number>();
  pessoas.forEach((p) => { if (!ordemEmpresa.has(empresa(p))) ordemEmpresa.set(empresa(p), ordemEmpresa.size); });
  return pessoas
    .map((p, i) => ({ p, i, peso: pesoDaPessoa(p, hoje) }))
    .sort((a, b) => (ordemEmpresa.get(empresa(a.p)) as number) - (ordemEmpresa.get(empresa(b.p)) as number) || a.peso - b.peso || a.i - b.i)
    .map((x) => x.p);
}

/** Quantos dias antes de o período aquisitivo se completar a tela já avisa que a pessoa vai ter direito. */
export const JANELA_DIREITO_DIAS = 90;

export type ItemDoResumo = { tipo: "vencido" | "responder" | "definir" | "completar" | "avisar" | "confirmar"; urgente: boolean; nomes: string[] };

/** O que fazer agora, somando as providências da folha por tipo (só os tipos que têm gente). */
export function resumoDoQueFazer(pessoas: PessoaFerias[], hoje: string): ItemDoResumo[] {
  const grupo = (t: TipoDePasso): ItemDoResumo["tipo"] => (t === "programar-resto" ? "definir" : t === "avisar-outra" ? "avisar" : t);
  const itens = new Map<ItemDoResumo["tipo"], ItemDoResumo>();
  for (const pessoa of pessoas) {
    const periodo = periodoDaFicha(pessoa);
    const passo = periodo ? proximoPasso(periodo, hoje) : null;
    if (!passo) continue;
    const tipo = grupo(passo.tipo);
    const atual = itens.get(tipo) ?? { tipo, urgente: false, nomes: [] };
    itens.set(tipo, { ...atual, urgente: atual.urgente || passo.urgente, nomes: [...atual.nomes, pessoa.nome] });
  }
  const completando = pessoas
    .flatMap((pessoa) => pessoa.periodos
      .filter((p) => p.situacao === "EM_AQUISICAO" && p.diasParaCompletar !== null && p.diasParaCompletar <= JANELA_DIREITO_DIAS)
      .map((p) => ({ pessoa, dias: p.diasParaCompletar as number, direito: somaDias(p.aquisitivoFim, 1) })))
    .sort((a, b) => a.dias - b.dias);
  if (completando.length > 0) {
    itens.set("completar", {
      tipo: "completar",
      urgente: completando.some((c) => c.dias <= 30),
      nomes: completando.map((c) => `${c.pessoa.nome} (${dataBr(c.direito)}, em ${c.dias} ${c.dias === 1 ? "dia" : "dias"})`),
    });
  }
  const ordem: ItemDoResumo["tipo"][] = ["vencido", "responder", "definir", "completar", "avisar", "confirmar"];
  return ordem.flatMap((t) => itens.get(t) ?? []);
}
