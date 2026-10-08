// Custo unitario de um item do inventario: o mesmo na conferencia (o que a tela
// mostra) e na aprovacao (o que vai para a base do CMV).
//
// Nao usa o custo medio do saldo (InventoryStock.averageCost): o saldo nunca
// baixa, entao a media mistura todas as compras desde sempre e herda erro de
// unidade (deu R$ 39 mil a 1.800 saches de palito). E em 09/2026 deixava 45
// itens contados a R$ 0 — produtos sem saldo no sistema, mas com custo
// conhecido em meses anteriores.

export const FONTES_DO_CUSTO = ["COMPRAS_DO_PERIODO", "ULTIMA_COMPRA", "BASE_ANTERIOR", "INFORMADO"] as const;
export type FonteDoCusto = (typeof FONTES_DO_CUSTO)[number];

export type CandidatosDoCusto = {
  /** Custo medio das compras entre a contagem anterior e esta. */
  periodo: number | null;
  /** Ultima compra do produto em qualquer data ate o dia da contagem. */
  ultimaCompra: { valor: number | null; data: Date | null } | null;
  /** Custo na ultima base oficial de estoque (mes anterior ou antes). */
  base: { valor: number | null; ano: number | null; mes: number | null } | null;
  /** Custo informado na conferencia por quem revisa, quando o sistema nao tem nenhum. */
  informado: { valor: number | null; por: string | null; em: Date | null } | null;
};

export type CustoDoItem = {
  valor: number;
  fonte: FonteDoCusto;
  /** Texto curto para a tela: "compras de 02/09 a 30/09", "base de 08/2026"... */
  detalhe: string | null;
};

const positivo = (valor: number | null | undefined): valor is number =>
  typeof valor === "number" && Number.isFinite(valor) && valor > 0;

function data(valor: Date | null): string | null {
  if (!valor) return null;
  const d = String(valor.getUTCDate()).padStart(2, "0");
  const m = String(valor.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${valor.getUTCFullYear()}`;
}

/** Primeiro custo positivo, do mais atual ao mais antigo; o informado so por ultimo. */
export function escolherCusto(c: CandidatosDoCusto): CustoDoItem | null {
  if (positivo(c.periodo)) return { valor: c.periodo, fonte: "COMPRAS_DO_PERIODO", detalhe: null };
  if (c.ultimaCompra && positivo(c.ultimaCompra.valor)) {
    const quando = data(c.ultimaCompra.data);
    return { valor: c.ultimaCompra.valor, fonte: "ULTIMA_COMPRA", detalhe: quando ? `compra de ${quando}` : null };
  }
  if (c.base && positivo(c.base.valor)) {
    const mes = c.base.mes && c.base.ano ? `${String(c.base.mes).padStart(2, "0")}/${c.base.ano}` : null;
    return { valor: c.base.valor, fonte: "BASE_ANTERIOR", detalhe: mes ? `base de ${mes}` : null };
  }
  if (c.informado && positivo(c.informado.valor)) {
    return { valor: c.informado.valor, fonte: "INFORMADO", detalhe: c.informado.por ? `informado por ${c.informado.por}` : null };
  }
  return null;
}

/** O sistema ja tem custo? Informar a mao so vale quando nao tem. */
export function temCustoDoSistema(c: CandidatosDoCusto): boolean {
  const semInformado = escolherCusto({ ...c, informado: null });
  return semInformado != null;
}

export const CUSTO_INFORMADO_MAXIMO = 100_000;

export type ValidacaoDoCusto = { ok: true; valor: number | null } | { ok: false; erro: string };

/** Valida o custo digitado (aceita "12,50"). `null` ou "" limpa o informado. */
export function validarCustoInformado(entrada: unknown): ValidacaoDoCusto {
  if (entrada == null || entrada === "") return { ok: true, valor: null };
  const texto = typeof entrada === "number" ? String(entrada) : typeof entrada === "string" ? entrada.trim().replace(/\./g, "").replace(",", ".") : "";
  const valor = typeof entrada === "number" ? entrada : Number(texto);
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, erro: "Informe um custo maior que zero." };
  if (valor > CUSTO_INFORMADO_MAXIMO) return { ok: false, erro: "Custo acima de R$ 100.000 por unidade: confira a unidade." };
  return { ok: true, valor: Math.round(valor * 10000) / 10000 };
}
