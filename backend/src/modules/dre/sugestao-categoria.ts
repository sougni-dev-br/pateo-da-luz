// Regras de sugestão automática de categoria por nome do fornecedor
const CATEGORY_SUGGESTIONS: Array<{ patterns: string[]; name: string }> = [
  { patterns: ["enel ", "cpfl", "energisa", "cemig", "celpe", "coelba", "eletropaulo"], name: "Energia Elétrica" },
  { patterns: ["sabesp", "sanepar", "copasa", "aegea", "embasa"], name: "Água e Esgoto" },
  { patterns: ["comgas", "comgás", "ultragaz", "supergasbras", "liquigas", "liqgás"], name: "Gás" },
  { patterns: ["claro", "vivo", "tim ", "oi ", "sky ", "algar", "net cabo", "brisanet", "vero "], name: "Telefonia / Internet" },
  { patterns: ["ifood", "99food", "keeta", "rappi", "uber eats", "ubereats"], name: "Marketing e Delivery" },
  { patterns: ["contabilidade", "escritorio de contab", "assessoria contab"], name: "Contador" },
  // ISS não tem categoria própria no DRE: sem sugestão, quem classifica escolhe.
  { patterns: ["simples nacional", " das "], name: "Simples Nacional" },
  { patterns: ["irrf", "darf", "receita federal"], name: "IRRF / DARF" },
  { patterns: ["gare", "icms"], name: "GARE / ICMS" },
  { patterns: ["inss patronal", "inss "], name: "INSS" },
  { patterns: ["fgts"], name: "FGTS" },
  { patterns: ["aluguel", "locacao", "locação"], name: "Aluguel" },
  { patterns: ["condominio", "condomínio", "fundo de promocao", "fundo de promoção"], name: "Condomínio" },
  { patterns: ["iptu"], name: "IPTU" },
  { patterns: ["seguro"], name: "Seguro" },
  { patterns: ["folha de pagamento", "folha pagamento", "rescisao", "rescisão", "ferias ", "férias "], name: "Folha de Pagamento" },
  { patterns: ["vale transporte", "vale-transporte"], name: "Vale-Transporte" },
  { patterns: ["plano de saude", "plano de saúde", "unimed", "sulamerica", "bradesco saude", "amil", "hapvida"], name: "Plano de Saúde" },
  { patterns: ["mr clean", "kativa", "limpeza", "higienizacao", "higienização", "descartav"], name: "Material de Limpeza" },
  { patterns: ["software", "sistema", "licenca", "licença", "saas", "chatgpt", "chat- gpt", "wix", "totvs", "linx"], name: "Sistema / Software" },
  { patterns: ["globo play", "netflix", "streaming", "spotify", "amazon prime", "disney"], name: "Streaming / TV" },
  { patterns: ["manutencao", "manutenção", "reparo", "reforma", "assistencia tecnica", "assistência técnica"], name: "Manutenção" },
  { patterns: ["marketing", "publicidade", "propaganda", "locacao de site", "locação de site"], name: "Marketing" },
  { patterns: ["frigo utensil", "equipamento", "eletrodomest"], name: "Equipamentos" },
  { patterns: ["papel plastico", "prafesta", "ricapel", "quality papel", "embalagen", "shopee", "kalunga"], name: "Descartáveis" },
  { patterns: ["banco", "tarifa bancaria", "tarifa bancária", "juros bancarios", "juros bancários", "iof bancario"], name: "Tarifa PIX / TEF" },
  { patterns: ["prolabore", "pró-labore", "pro-labore"], name: "Pró-labore" },
];

function normalizeSup(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function suggestCategory(supplierName: string): string | null {
  const n = normalizeSup(supplierName);
  for (const rule of CATEGORY_SUGGESTIONS) {
    if (rule.patterns.some((p) => n.includes(p))) return rule.name;
  }
  return null;
}
