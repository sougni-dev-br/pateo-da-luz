// Conversoes de unidade do produto vindas do formulario de cadastro.
//
// O formulario carrega as conversoes ao abrir e devolve a lista ao salvar. A
// gravacao antiga apagava todas e regravava a lista: conversao criada pela ficha
// tecnica ou pela revisao de embalagens enquanto o formulario estava aberto (ou
// numa listagem carregada antes) sumia no proximo salvar, e as compras daquele
// produto voltavam a entrar na unidade da nota.
//
// Aqui a regra e: so sai do banco o que o formulario carregou e o operador tirou.
// O resto e preservado. Toda unidade e gravada na forma canonica (UND -> UN,
// GR -> G), para "UND>G" e "UN>G" nao virarem duas linhas para a mesma coisa.

import { normalizarUnidade } from "../../shared/unidades/conversao.js";
import { parseDecimalInput as numero } from "../../shared/utils/parse-decimal.js";

/** A coluna `factor` e Decimal(12,6): fora disto o banco arredonda para 0 ou estoura. */
const FATOR_MINIMO = 0.000001;
const FATOR_MAXIMO = 999_999;
/** Folga para o produto de um par e seu inverso (arredondamento de 6 casas). */
const TOLERANCIA_INVERSO = 0.01;

export type ConversaoEnviada = {
  fromUnit?: string | null;
  toUnit?: string | null;
  factor?: string | number | null;
  averagePackageWeight?: string | number | null;
  notes?: string | null;
  isActive?: boolean;
};

export type ConversaoCanonica = {
  fromUnit: string;
  toUnit: string;
  factor: number;
  averagePackageWeight: number | null;
  notes: string | null;
  isActive: boolean;
};

export type ConversaoGravada = { id: string; fromUnit: string; toUnit: string };

function texto(valor: unknown): string | null {
  const t = String(valor ?? "").trim();
  return t || null;
}

export function chaveDaConversao(fromUnit: unknown, toUnit: unknown): string {
  return `${normalizarUnidade(fromUnit)}>${normalizarUnidade(toUnit)}`;
}

/** Vírgula, ponto e vírgula ou espaço no meio: é uma lista ("PCT, CX, FD"), não uma unidade. */
const UNIDADE_COM_LISTA = /[\s,;]/;

function formatar(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
}

/**
 * Valida e traz para a forma canonica o que o formulario mandou. Linha sem
 * origem, destino ou fator e ignorada (o formulario manda linha vazia); o resto
 * que nao faz sentido vira erro antes de qualquer gravacao.
 */
export function prepararConversoesEnviadas(
  enviadas: ConversaoEnviada[] | undefined | null
): { ok: true; conversoes: ConversaoCanonica[] } | { ok: false; erro: string } {
  const conversoes: ConversaoCanonica[] = [];
  const vistas = new Map<string, ConversaoCanonica>();

  for (const linha of enviadas ?? []) {
    const fromUnit = normalizarUnidade(linha.fromUnit);
    const toUnit = normalizarUnidade(linha.toUnit);
    const factor = numero(linha.factor);
    if (!fromUnit || !toUnit || factor == null) continue;

    const invalida = [fromUnit, toUnit].find((u) => UNIDADE_COM_LISTA.test(u));
    if (invalida) {
      return { ok: false, erro: `"${invalida}" não é uma unidade: informe uma só (CX, PCT, FD...), sem vírgula nem espaço.` };
    }
    if (fromUnit === toUnit) {
      return { ok: false, erro: `Conversão de ${fromUnit} para ${fromUnit} não existe: as duas pontas são a mesma unidade.` };
    }
    if (!(factor >= FATOR_MINIMO && factor <= FATOR_MAXIMO)) {
      return { ok: false, erro: `Fator de ${fromUnit} para ${toUnit} fora da faixa aceita (entre 0,000001 e 999.999).` };
    }
    const chave = `${fromUnit}>${toUnit}`;
    if (vistas.has(chave)) {
      return { ok: false, erro: `A conversão de ${fromUnit} para ${toUnit} aparece duas vezes. Deixe só uma.` };
    }
    const inversa = vistas.get(`${toUnit}>${fromUnit}`);
    if (inversa && Math.abs(inversa.factor * factor - 1) > TOLERANCIA_INVERSO) {
      return {
        ok: false,
        erro: `As conversões se contradizem: 1 ${toUnit} = ${formatar(inversa.factor)} ${fromUnit}, mas 1 ${fromUnit} = ${formatar(factor)} ${toUnit}. Deixe só uma das duas.`
      };
    }

    const canonica: ConversaoCanonica = {
      fromUnit,
      toUnit,
      factor,
      averagePackageWeight: numero(linha.averagePackageWeight),
      notes: texto(linha.notes),
      isActive: linha.isActive ?? true
    };
    vistas.set(chave, canonica);
    conversoes.push(canonica);
  }

  return { ok: true, conversoes };
}

/**
 * Quais linhas ja gravadas saem do banco.
 *
 * - O operador tirou: estava no que o formulario carregou e nao voltou.
 * - Mesma conversao gravada em grafia nao canonica ("UND>G" quando chega "UN>G"):
 *   sai para a canonica entrar no lugar.
 * - Inversa de uma conversao enviada ("G>UN" quando chega "UN>G"): a enviada
 *   define a relacao entre as duas unidades e a antiga poderia contradize-la.
 *
 * `carregadas` ausente (cliente antigo ou outra tela) = ninguem tirou nada:
 * nada e apagado alem das grafias duplicadas e das inversas substituidas.
 */
export function conversoesASairem(input: {
  gravadas: ConversaoGravada[];
  enviadas: ConversaoCanonica[];
  carregadas?: Array<{ fromUnit?: string | null; toUnit?: string | null }> | null;
}): string[] {
  const enviadas = new Set(input.enviadas.map((c) => `${c.fromUnit}>${c.toUnit}`));
  const inversasDasEnviadas = new Set(input.enviadas.map((c) => `${c.toUnit}>${c.fromUnit}`));
  const carregadas = new Set((input.carregadas ?? []).map((c) => chaveDaConversao(c.fromUnit, c.toUnit)));

  return input.gravadas
    .filter((gravada) => {
      const chave = chaveDaConversao(gravada.fromUnit, gravada.toUnit);
      const grafiaCanonica = gravada.fromUnit === normalizarUnidade(gravada.fromUnit) && gravada.toUnit === normalizarUnidade(gravada.toUnit);
      if (enviadas.has(chave)) return !grafiaCanonica;
      if (inversasDasEnviadas.has(chave)) return true;
      return carregadas.has(chave);
    })
    .map((gravada) => gravada.id);
}
