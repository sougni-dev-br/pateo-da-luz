import type { ListaFerias, PeriodoFerias, PessoaFerias, ProgramacaoFerias } from "../../../api/client";
import { dataBr, linhasDaLista, pertenceAoFiltro, somaDias, textoPrazo } from "./feriasFormato";
import { resumoDoPedido } from "./pedido";
import { prazoParaAvisar, prazoParaPagar } from "./regrasFerias";

// Dois papéis, um por etapa do combinado com a equipe:
//   CONVERSA        → o que ainda falta programar, com espaço para escrever a data combinada;
//   CONTABILIDADE   → o que já está programado no ERP, para a contabilidade lançar.
export type ModoImpressao = "CONVERSA" | "CONTABILIDADE";

export const SEM_EMPRESA = "Sem empresa";

export type LinhaConversa = {
  chave: string;
  nome: string;
  admissao: string | null;
  periodo: string;
  limite: string;
  prazo: string;
  urgente: boolean;
  diasAProgramar: number;
  /** Já tem parte programada (fracionadas): o papel avisa para programar só o que falta. */
  jaProgramado: string | null;
  /** O que o colaborador pediu para este período, para a conversa partir daí; null quando ainda não pediu. */
  pedido: string | null;
};

export type LinhaContabilidade = {
  chave: string;
  nome: string;
  periodo: string;
  inicio: string;
  fim: string;
  retorno: string;
  dias: number;
  abono: number;
  /** Último dia para avisar a pessoa por escrito (30 dias antes; "✓" quando já foi avisada) e para pagar (2 dias antes). */
  avisarAte: string;
  pagarAte: string;
  observacao: string;
};

export type FolhaEmpresa<T> = { empresa: string; linhas: T[] };

const empresaDe = (p: PessoaFerias) => p.empresa?.trim() || SEM_EMPRESA;

function agrupar<T>(itens: Array<{ empresa: string; linha: T }>): Array<FolhaEmpresa<T>> {
  const porEmpresa = new Map<string, T[]>();
  for (const { empresa, linha } of itens) porEmpresa.set(empresa, [...(porEmpresa.get(empresa) ?? []), linha]);
  return [...porEmpresa.entries()]
    .sort(([a], [b]) => (a === SEM_EMPRESA ? 1 : b === SEM_EMPRESA ? -1 : a.localeCompare(b, "pt-BR")))
    .map(([empresa, linhas]) => ({ empresa, linhas }));
}

const periodoBr = (p: PeriodoFerias) => `${dataBr(p.aquisitivoInicio)} a ${dataBr(p.aquisitivoFim)}`;

/** Quem ainda precisa de data: o que a tela mostra em "A programar", com o que falta de cada um. */
export function folhasDeConversa(lista: ListaFerias): Array<FolhaEmpresa<LinhaConversa>> {
  return agrupar(linhasDaLista(lista)
    .filter((l) => pertenceAoFiltro(l.periodo, "PENDENTES"))
    .map(({ pessoa, periodo }) => ({
      empresa: empresaDe(pessoa),
      linha: {
        chave: `${pessoa.employeeId}|${periodo.aquisitivoInicio}`,
        nome: pessoa.nome,
        admissao: pessoa.admissao,
        periodo: periodoBr(periodo),
        limite: dataBr(periodo.limiteInicioGozo),
        prazo: textoPrazo(periodo),
        urgente: periodo.nivel !== "ok",
        diasAProgramar: periodo.diasPendentes,
        jaProgramado: periodo.programacoes.length ? periodo.programacoes.map(resumoCurto).join("; ") : null,
        pedido: periodo.solicitacao ? resumoDoPedido(periodo.solicitacao) : null,
      },
    })));
}

function resumoCurto(g: ProgramacaoFerias): string {
  return g.gozoInicio ? `${dataBr(g.gozoInicio)} (${g.dias} d)` : `${g.dias} d`;
}

/** Férias programadas no ERP (ainda não gozadas), uma linha por parte, para a contabilidade lançar. */
export function folhasParaContabilidade(lista: ListaFerias): Array<FolhaEmpresa<LinhaContabilidade>> {
  const itens: Array<{ empresa: string; linha: LinhaContabilidade; ordem: string }> = [];
  for (const pessoa of lista.pessoas) {
    for (const periodo of pessoa.periodos) {
      for (const g of periodo.programacoes) {
        if (g.status !== "PROGRAMADA" || !g.gozoInicio) continue;
        const fim = somaDias(g.gozoInicio, g.dias - 1);
        itens.push({
          empresa: empresaDe(pessoa),
          ordem: g.gozoInicio,
          linha: {
            chave: g.id, nome: pessoa.nome, periodo: periodoBr(periodo),
            inicio: dataBr(g.gozoInicio), fim: dataBr(fim), retorno: dataBr(somaDias(fim, 1)),
            dias: g.dias, abono: g.diasAbono, avisarAte: `${dataBr(prazoParaAvisar(g.gozoInicio))}${g.avisadoEm ? " ✓" : ""}`, pagarAte: dataBr(prazoParaPagar(g.gozoInicio)),
            observacao: periodo.foraDoPrazo ? "Fora do prazo (pagar em dobro)" : g.observacao ?? "",
          },
        });
      }
    }
  }
  return agrupar(itens.sort((a, b) => a.ordem.localeCompare(b.ordem) || a.linha.nome.localeCompare(b.linha.nome, "pt-BR"))
    .map(({ empresa, linha }) => ({ empresa, linha })));
}
