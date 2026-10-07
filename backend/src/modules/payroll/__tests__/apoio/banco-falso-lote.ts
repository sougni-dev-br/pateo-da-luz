// Banco de mentira, em memória, para os testes do lote de pagamento da folha: só o que o
// serviço usa (where com igualdade, null, in, not; transação que desfaz tudo no erro).
type Linha = Record<string, unknown>;
type Where = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !(v instanceof Date);
const igual = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

function combina(linha: Linha, where: Where = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "competenceYear_competenceMonth" && ehObjeto(v)) return combina(linha, v);
    const atual = linha[k] ?? null;
    if (v === null) return atual === null;
    if (ehObjeto(v)) {
      if ("in" in v) return (v.in as unknown[]).includes(atual);
      if ("not" in v) return v.not === null ? atual !== null : !igual(atual, v.not);
      return true;
    }
    return igual(atual, v);
  });
}

function tabela(nome: string, banco: Banco, padrao: () => Linha = () => ({})) {
  const linhas = () => banco.dados[nome];
  const comInclude = (l: Linha, include?: Record<string, unknown>) =>
    include?.employee ? { ...l, employee: banco.dados.employee.find((e) => e.id === l.employeeId) } : { ...l };
  const ordenar = (lista: Linha[], orderBy?: unknown) => {
    const o = (Array.isArray(orderBy) ? orderBy[0] : orderBy) as Record<string, "asc" | "desc"> | undefined;
    if (!o) return lista;
    const [campo, dir] = Object.entries(o)[0];
    return [...lista].sort((a, b) => {
      const x = a[campo] instanceof Date ? (a[campo] as Date).getTime() : (a[campo] as number);
      const y = b[campo] instanceof Date ? (b[campo] as Date).getTime() : (b[campo] as number);
      return dir === "desc" ? y - x : x - y;
    });
  };
  return {
    findMany: async (a: { where?: Where; include?: Record<string, unknown>; orderBy?: unknown } = {}) =>
      ordenar(linhas().filter((l) => combina(l, a.where)), a.orderBy).map((l) => comInclude(l, a.include)),
    findFirst: async (a: { where?: Where; include?: Record<string, unknown>; orderBy?: unknown } = {}) => {
      const l = ordenar(linhas().filter((x) => combina(x, a.where)), a.orderBy)[0];
      return l ? comInclude(l, a.include) : null;
    },
    findUnique: async (a: { where: Where }) => {
      const l = linhas().find((x) => combina(x, a.where));
      return l ? { ...l } : null;
    },
    count: async (a: { where?: Where } = {}) => linhas().filter((l) => combina(l, a.where)).length,
    create: async (a: { data: Linha }) => {
      const nova = { ...padrao(), ...a.data, createdAt: banco.relogio(), em: banco.relogio() };
      linhas().push(nova);
      return { ...nova };
    },
    update: async (a: { where: Where; data: Linha }) => {
      const l = linhas().find((x) => combina(x, a.where));
      // Como o Prisma: update com condições que não batem é P2025 (registro não encontrado).
      if (!l) throw Object.assign(new Error(`${nome}: não achei ${JSON.stringify(a.where)}`), { code: "P2025" });
      Object.assign(l, a.data);
      return { ...l };
    },
    delete: async (a: { where: Where }) => {
      const i = linhas().findIndex((x) => combina(x, a.where));
      if (i < 0) throw Object.assign(new Error(`${nome}: não achei`), { code: "P2025" });
      return linhas().splice(i, 1)[0];
    },
    updateMany: async (a: { where: Where; data: Linha }) => {
      const alvo = linhas().filter((x) => combina(x, a.where));
      for (const l of alvo) Object.assign(l, a.data);
      return { count: alvo.length };
    },
  };
}

export type Banco = ReturnType<typeof criarBanco>;

export function criarBanco() {
  let tique = 0;
  const banco = {
    dados: { folhaLote: [] as Linha[], payrollItem: [] as Linha[], tipPeriod: [] as Linha[], tipPeriodEtapa: [] as Linha[],
      company: [] as Linha[], employee: [] as Linha[], paymentMethod: [] as Linha[], companyBankAccount: [] as Linha[] },
    relogio: () => new Date(Date.UTC(2026, 9, 1, 12, 0, tique++)),
  } as { dados: Record<string, Linha[]>; relogio: () => Date };
  const prisma: Record<string, unknown> = {
    folhaLote: tabela("folhaLote", banco, () => ({ paymentDate: null, paidPaymentMethodName: null })),
    payrollItem: tabela("payrollItem", banco),
    tipPeriod: tabela("tipPeriod", banco),
    tipPeriodEtapa: tabela("tipPeriodEtapa", banco),
    company: tabela("company", banco),
    employee: tabela("employee", banco),
    paymentMethod: tabela("paymentMethod", banco),
    companyBankAccount: tabela("companyBankAccount", banco),
    $executeRaw: async () => 1,
  };
  // Transação: roda sobre o mesmo banco e, se der erro, devolve tudo como estava.
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const copia = Object.fromEntries(Object.entries(banco.dados).map(([k, v]) => [k, v.map((l) => ({ ...l }))]));
    try {
      return await fn(prisma);
    } catch (err) {
      for (const k of Object.keys(banco.dados)) banco.dados[k] = copia[k];
      throw err;
    }
  };
  return { ...banco, prisma };
}
