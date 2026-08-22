const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export type Pagination = {
  page: number;
  /** null quando a resposta nao e paginada. */
  pageSize: number | null;
  skip: number;
  /** undefined devolve tudo — e o que o Prisma espera para "sem limite". */
  take: number | undefined;
};

function positiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : null;
}

/**
 * Paginacao opcional: so entra quando "page" ou "pageSize" vem na query.
 *
 * Sem parametro a resposta continua completa de proposito — Compras monta o
 * autocomplete de produto offline e Estoque precisa de todos os itens do setor.
 * Forcar pagina nessas telas quebraria as duas.
 */
export function resolvePagination(query: { page?: unknown; pageSize?: unknown }): Pagination {
  const pedidoPage = positiveInt(query.page);
  const pedidoPageSize = positiveInt(query.pageSize);

  if (pedidoPage === null && pedidoPageSize === null) {
    const pediuAlgo = query.page !== undefined || query.pageSize !== undefined;
    // Valor invalido ("abc", "0", "-5") pagina no padrao em vez de devolver
    // a base inteira sem querer.
    if (!pediuAlgo) return { page: 1, pageSize: null, skip: 0, take: undefined };
  }

  const pageSize = Math.min(pedidoPageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = pedidoPage ?? 1;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
