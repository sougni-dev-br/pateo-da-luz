// Demonstração da tela de Impostos e Guias (?mock-user=1). Empresa, CNPJ e valores são fictícios;
// as datas são relativas a hoje para a tela mostrar vencidas, a vencer e pagas sem manutenção.

const DIA = 86_400_000;

function iso(deslocamentoEmDias: number): string {
  const d = new Date(Date.now() + deslocamentoEmDias * DIA);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00.000Z`;
}

function mes(deslocamentoEmMeses: number): string {
  const d = new Date();
  const alvo = new Date(d.getFullYear(), d.getMonth() + deslocamentoEmMeses, 1);
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, "0")}`;
}

const CATEGORIAS = [
  { id: "cat-simples", name: "Simples Nacional", dreGroup: "IMPOSTOS" },
  { id: "cat-irrf", name: "IRRF / DARF", dreGroup: "IMPOSTOS" },
  { id: "cat-icms", name: "GARE / ICMS", dreGroup: "IMPOSTOS" },
  { id: "cat-fgts", name: "FGTS", dreGroup: "PESSOAL" },
  { id: "cat-inss", name: "INSS", dreGroup: "PESSOAL" },
];

type Guia = {
  id: string; documentType: string; description: string | null; competencia: string | null; vence: number; valor: number;
  pagaEm: number | null; status?: string; dre: string | null;
};

// competencia em meses relativos ao mês corrente (-1 = mês passado); vence/pagaEm em dias a partir de hoje.
const GUIAS: Guia[] = [
  { id: "g-1", documentType: "Simples Nacional / DAS", description: "DAS do mês", competencia: mes(-1), vence: 6, valor: 4312.9, pagaEm: null, dre: "cat-simples" },
  { id: "g-2", documentType: "FGTS", description: "FGTS mensal", competencia: mes(-1), vence: -2, valor: 1980, pagaEm: null, dre: "cat-fgts" },
  { id: "g-3", documentType: "GPS / INSS", description: "INSS patronal", competencia: mes(-1), vence: 0, valor: 2100.55, pagaEm: null, dre: "cat-inss" },
  { id: "g-4", documentType: "DARF", description: "IRRF sobre salários", competencia: mes(-1), vence: 21, valor: 612.3, pagaEm: null, dre: "cat-irrf" },
  { id: "g-5", documentType: "Simples Nacional / DAS", description: "DAS do mês", competencia: mes(-2), vence: -24, valor: 4105.1, pagaEm: -25, status: "PAID", dre: "cat-simples" },
  { id: "g-6", documentType: "FGTS", description: "FGTS mensal", competencia: mes(-2), vence: -28, valor: 1950, pagaEm: -29, status: "PAID", dre: "cat-fgts" },
  { id: "g-7", documentType: "GPS / INSS", description: "INSS patronal", competencia: mes(-2), vence: -10, valor: 2080, pagaEm: null, dre: "cat-inss" },
  { id: "g-8", documentType: "DARF", description: "IRRF sobre salários", competencia: null, vence: -40, valor: 480, pagaEm: -41, status: "PAID", dre: null },
  { id: "g-9", documentType: "GARE ICMS", description: "Cancelada: lançada em duplicidade", competencia: mes(-2), vence: -15, valor: 900, pagaEm: null, status: "CANCELED", dre: "cat-icms" },
];

const MESES_FIXOS = [-11, -10, -9, -8, -7, -6, -5, -4, -3];

// Composição dos documentos (valores fictícios): DAS com as seis linhas, FGTS e DARF previdenciário.
function itensDe(g: Guia) {
  const linha = (position: number, code: string | null, description: string, principal: number) =>
    ({ id: `${g.id}-i${position}`, position, code, description, principal: principal.toFixed(2), fine: "0.00", interest: "0.00" });
  if (g.documentType.startsWith("Simples")) {
    const partes = [["1001", "IRPJ - SIMPLES NACIONAL", 0.0607], ["1002", "CSLL - SIMPLES NACIONAL", 0.0386], ["1004", "COFINS - SIMPLES NACIONAL", 0.1406], ["1005", "PIS - SIMPLES NACIONAL", 0.0305], ["1006", "INSS - SIMPLES NACIONAL", 0.4634]] as const;
    const itens = partes.map(([c, d, p], i) => linha(i, c, d, Math.round(g.valor * p * 100) / 100));
    const resto = Math.round((g.valor - itens.reduce((s, i) => s + Number(i.principal), 0)) * 100) / 100;
    return [...itens, linha(5, "1007", "ICMS - SIMPLES NACIONAL SP", resto)];
  }
  if (g.documentType === "FGTS") return [linha(0, null, "FGTS Mensal", g.valor)];
  return [linha(0, "1082", "CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO", g.valor)];
}

function detalhe(g: Guia) {
  return {
    id: g.id, companyId: null, cnpj: "00000000000100", legalName: "Empresa Exemplo Ltda", tradeName: "Exemplo",
    documentType: g.documentType, description: g.description,
    competenceDate: g.competencia ? `${g.competencia}-01T00:00:00.000Z` : null,
    dueDate: iso(g.vence), amount: g.valor.toFixed(2),
    paymentDate: g.pagaEm == null ? null : iso(g.pagaEm), paidAmount: g.pagaEm == null ? null : g.valor.toFixed(2),
    status: g.status ?? "PENDING", comments: null, source: "MANUAL", importBatchId: null,
    dreCategoryId: g.dre, dreCategoryName: CATEGORIAS.find((c) => c.id === g.dre)?.name ?? null,
    createdById: "u-1", deletedAt: null, createdAt: iso(-60), updatedAt: iso(-1), company: null, dreCategory: null,
    documentNumber: g.id === "g-1" ? "07.20.26290.7165263-2" : null, items: itensDe(g), itemsCount: itensDe(g).length,
  };
}

function aberta(g: Guia) { return g.pagaEm == null && g.status !== "CANCELED"; }

function panorama() {
  const abertas = GUIAS.filter(aberta);
  const faixa = (f: (g: Guia) => boolean) => ({ qtd: abertas.filter(f).length, valor: abertas.filter(f).reduce((s, g) => s + g.valor, 0) });
  const cobertura: Array<{ mes: string; grupo: string; qtd: number; pagas: number; vencidas: number; valor: number }> = [];
  // Histórico mensal de Simples e FGTS, com uma lacuna proposital (três meses atrás) para a grade mostrar o "!".
  for (const m of MESES_FIXOS) {
    if (m === -4) continue;
    cobertura.push({ mes: mes(m), grupo: "Simples Nacional", qtd: 1, pagas: 1, vencidas: 0, valor: 3900 });
    cobertura.push({ mes: mes(m), grupo: "FGTS", qtd: 1, pagas: 1, vencidas: 0, valor: 1900 });
  }
  for (const g of GUIAS.filter((x) => x.competencia && x.status !== "CANCELED")) {
    const grupo = CATEGORIAS.find((c) => c.id === g.dre)?.name ?? "Sem categoria";
    const ja = cobertura.find((c) => c.mes === g.competencia && c.grupo === grupo);
    const venc = aberta(g) && g.vence < 0 ? 1 : 0;
    if (ja) { ja.qtd += 0; continue; }
    cobertura.push({ mes: g.competencia as string, grupo, qtd: 1, pagas: g.pagaEm == null ? 0 : 1, vencidas: venc, valor: g.valor });
  }
  return {
    hoje: iso(0).slice(0, 10),
    situacoes: {
      todas: GUIAS.filter((g) => g.status !== "CANCELED").length,
      vencidas: abertas.filter((g) => g.vence < 0).length,
      aVencer: abertas.filter((g) => g.vence >= 0).length,
      pagas: GUIAS.filter((g) => g.pagaEm != null).length,
      canceladas: GUIAS.filter((g) => g.status === "CANCELED").length,
    },
    aPagar: {
      vencido: faixa((g) => g.vence < 0),
      ate7: faixa((g) => g.vence >= 0 && g.vence < 8),
      ate30: faixa((g) => g.vence >= 8 && g.vence < 31),
      depois: faixa((g) => g.vence >= 31),
    },
    meses: Array.from({ length: 12 }, (_, i) => mes(i - 11)),
    cobertura,
    semCompetencia: 1,
  };
}

/** Resposta mock para as rotas /tax-payments; undefined quando a URL não é de impostos. */
export function mockImpostos(url: string, method = "GET"): unknown | undefined {
  let caminho = url;
  let params = new URLSearchParams();
  try {
    const analisada = new URL(url, window.location.origin);
    caminho = analisada.pathname;
    params = analisada.searchParams;
  } catch { /* url relativa estranha: segue com o texto original */ }

  const marca = caminho.indexOf("/tax-payments");
  if (marca < 0) return undefined;
  const resto = caminho.slice(marca + "/tax-payments".length).replace(/^\/|\/$/g, "");

  if (method.toUpperCase() !== "GET") return { id: "g-1", ok: true, status: "PENDING", imported: 3, skipped: 0, total: 3, importBatchId: "demo" };
  if (resto === "panorama") return panorama();
  if (resto === "categorias-dre") return CATEGORIAS;
  if (resto === "categoria-sugerida") return { dreCategoryId: "cat-simples", nome: "Simples Nacional" };
  if (resto === "codigos") {
    const tipo = params.get("tipo") ?? "";
    const todos: Record<string, Array<{ code: string; description: string }>> = {
      "Simples Nacional / DAS": [
        { code: "1001", description: "IRPJ - SIMPLES NACIONAL" }, { code: "1002", description: "CSLL - SIMPLES NACIONAL" },
        { code: "1004", description: "COFINS - SIMPLES NACIONAL" }, { code: "1005", description: "PIS - SIMPLES NACIONAL" },
        { code: "1006", description: "INSS - SIMPLES NACIONAL" }, { code: "1007", description: "ICMS - SIMPLES NACIONAL SP" },
      ],
      DARF: [
        { code: "0561", description: "IRRF - RENDIMENTO DO TRABALHO ASSALARIADO" },
        { code: "1082", description: "CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO" }, { code: "1099", description: "CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL" },
      ],
    };
    return todos[tipo] ?? [];
  }

  if (resto) return detalhe(GUIAS.find((g) => g.id === resto) ?? GUIAS[0]);

  const situacao = params.get("status");
  const filtradas = GUIAS.filter((g) => {
    if (situacao === "OVERDUE") return aberta(g) && g.vence < 0;
    if (situacao === "PENDING") return aberta(g) && g.vence >= 0;
    if (situacao === "PAID") return g.pagaEm != null && g.status !== "CANCELED";
    if (situacao === "CANCELED") return g.status === "CANCELED";
    return true;
  });
  const abertasPrimeiro = [...filtradas].sort((a, b) => Number(!aberta(a)) - Number(!aberta(b)) || (aberta(a) ? a.vence - b.vence : b.vence - a.vence));
  return {
    data: abertasPrimeiro.map(detalhe),
    pagination: { page: 1, pageSize: 30, total: abertasPrimeiro.length, totalPages: 1 },
    summary: { total: "0", paid: "0", pending: "0", overdue: "0", withoutReceipt: "0" },
  };
}
