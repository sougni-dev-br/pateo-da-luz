// Leitura COMPLETA do "Extrato Mensal" da contabilidade: por pessoa, cabeçalho
// (matrícula, cargo, salário base, admissão, situação), todas as rubricas e o rodapé
// (proventos, descontos, líquido, bases e FGTS). Fica separada de lerTextoExtrato, que
// alimenta o Contas a Pagar e continua com a interface de sempre.
//
// A pdf-parse embaralha as colunas; os padrões abaixo foram conferidos contra os
// extratos reais (folha mensal e adiantamento). A prova de leitura é a soma: rubricas
// P batem com Proventos e D com Descontos. Quem não bate é gravado com conferido=false,
// nunca descartado.
const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");

export type RubricaExtrato = {
  codigo: string;
  descricao: string;
  tipo: "P" | "D";
  referencia: number | null;
  valor: number;
};

export type PessoaExtrato = {
  matricula: string;
  nome: string;
  // Só para vincular ao cadastro; NUNCA é gravado junto dos detalhes.
  cpfNorm: string;
  situacao: string | null;
  vinculo: string | null;
  horasMes: number | null;
  cargoCodigo: string | null;
  cargo: string | null;
  cbo: string | null;
  salarioBase: number | null;
  admissao: string | null;        // AAAA-MM-DD
  demissao: string | null;        // AAAA-MM-DD
  demissaoMotivo: string | null;
  proventos: number;
  descontos: number;
  liquido: number;
  baseInss: number | null;
  baseFgts: number | null;
  baseIrrf: number | null;
  valorFgts: number | null;
  liquidoRescisao: number | null;
  rubricas: RubricaExtrato[];
  somaProventos: number;
  somaDescontos: number;
  conferido: boolean;
  // Linhas de rubrica que nenhum padrão reconheceu (explica um conferido=false).
  naoLidas: string[];
  // Bloco bruto da pessoa, já SEM o CPF.
  texto: string;
};

export type DetalhesExtrato = {
  emissao: string | null;          // AAAA-MM-DD
  totalProventos: number | null;
  totalDescontos: number | null;
  totalLiquido: number | null;
  pessoas: PessoaExtrato[];
};

const NUM = "-?[\\d.]+,\\d{2}";
const TOLERANCIA = 0.01;

function num(v: string | undefined | null): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

function dataIso(v: string | undefined | null): string | null {
  const m = v?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Tira do texto qualquer CPF (formatado ou só dígitos) antes de gravar.
export function semCpf(texto: string): string {
  return texto.replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, "***.***.***-**");
}

// Remove cabeçalho e rodapé de cada página: um bloco de pessoa pode atravessar a quebra.
function linhasDoCorpo(txt: string): string[] {
  const out: string[] = [];
  let noCabecalho = false;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.trimEnd();
    if (/^Página:\s*\d+\/\d+/.test(l)) { noCabecalho = true; continue; }
    if (noCabecalho) { if (/^CNPJ:\s*$/.test(l)) noCabecalho = false; continue; }
    if (/^Sistema licenciado/.test(l) || /^-- \d+ of \d+ --$/.test(l) || l.trim() === "") continue;
    out.push(l);
  }
  return out;
}

const INICIO_PESSOA = /^(\d+) (.+?)\s+(?:Empr\.|Contr):\s*(\d{2}\/\d{2}\/\d{4})?/;
// Depois do último funcionário vem o total e o resumo da empresa, que não são de ninguém.
const FIM_PESSOAS = /^(Total Geral|Resumo|Líquido Geral|umo das Bases)/;

const RE_DUPLA = new RegExp(`^(\\d+) (.+?) (\\d+) (${NUM}) D\\tP\\t(${NUM})\\t(${NUM}) (.+) (${NUM})$`);
const RE_SIMPLES = new RegExp(`^(\\d+) (.+?) ([PD])\\t(${NUM})\\t(${NUM})$`);
// Desconto sozinho na linha (a coluna do provento acabou antes): "998 110,25 D\tI.N.S.S. 7,50".
const RE_SO_DESCONTO = new RegExp(`^(\\d+) (${NUM}) D\\t(.+) (${NUM})$`);

export function lerRubrica(linha: string): RubricaExtrato[] | null {
  let m = RE_DUPLA.exec(linha);
  if (m) {
    return [
      { codigo: m[1], descricao: m[2].trim(), tipo: "P", valor: num(m[5])!, referencia: num(m[6]) },
      { codigo: m[3], descricao: m[7].trim(), tipo: "D", valor: num(m[4])!, referencia: num(m[8]) },
    ];
  }
  m = RE_SIMPLES.exec(linha);
  if (m) return [{ codigo: m[1], descricao: m[2].trim(), tipo: m[3] as "P" | "D", valor: num(m[4])!, referencia: num(m[5]) }];
  m = RE_SO_DESCONTO.exec(linha);
  if (m) return [{ codigo: m[1], descricao: m[3].trim(), tipo: "D", valor: num(m[2])!, referencia: num(m[4]) }];
  return null;
}

function lerPessoa(linhas: string[]): PessoaExtrato {
  const [l0] = linhas;
  const ini = INICIO_PESSOA.exec(l0)!;
  const cpf = l0.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/)?.[1] ?? "";
  const situacao = l0.match(/(Trabalhando|Demitid[oa]|Afastad[oa]|F[ée]rias)\s+CPF:/)?.[1] ?? null;

  const lVinculo = linhas.find((l) => /V[íi]nculo:/.test(l)) ?? "";
  const vinculo = lVinculo.split("\t")[0]?.replace(/V[íi]nculo:.*/, "").trim() || null;
  const horasMes = num(lVinculo.match(new RegExp(`V[íi]nculo:\\s*(${NUM})`))?.[1]);

  const lCargo = linhas.find((l) => /^Cargo:/.test(l)) ?? "";
  const cargoM = lCargo.match(new RegExp(`^Cargo:\\s*(\\d+)\\s+(.+?)\\s+(${NUM})\\s*\\tSal[áa]rio:`));
  const cbo = lCargo.match(/\t(\d+)\s*$/)?.[1] ?? null;

  const iNd = linhas.findIndex((l) => /^ND:/.test(l));
  const lNd = iNd >= 0 ? linhas[iNd] : "";
  const lNf = linhas.find((l) => /^NF:/.test(l)) ?? "";
  const iCargo = linhas.findIndex((l) => /^Cargo:/.test(l));

  const rubricas: RubricaExtrato[] = [];
  const naoLidas: string[] = [];
  const fimRubricas = iNd >= 0 ? iNd : linhas.length;
  for (const l of linhas.slice(Math.max(iCargo, 0) + 1, fimRubricas)) {
    const r = lerRubrica(l);
    if (r) rubricas.push(...r); else naoLidas.push(semCpf(l));
  }

  const proventos = num(lNd.match(new RegExp(`Proventos:\\s*(${NUM})`))?.[1]) ?? 0;
  const descontos = num(lNd.match(new RegExp(`Descontos:\\s*(${NUM})`))?.[1]) ?? 0;
  const liquido = num(lNd.match(new RegExp(`(${NUM})\\s*$`))?.[1]) ?? 0;
  // "Base INSS: X Base FGTS: Base IRRF:\tY Z" — Y é o FGTS e Z o IRRF (o pró-labore tem FGTS 0,00).
  const baseInss = num(lNf.match(new RegExp(`Base INSS:\\s*(${NUM})`))?.[1]);
  const bases = lNf.match(new RegExp(`Base IRRF:\\s*(${NUM})\\s+(${NUM})`));
  const valorFgts = num(lNf.match(new RegExp(`Valor FGTS:\\s*(${NUM})`))?.[1]);

  const lDem = linhas.find((l) => /^DEMITIDO EM/.test(l));
  const dem = lDem?.match(/^DEMITIDO EM (\d{2}\/\d{2}\/\d{4})(?:\s*-\s*MOTIVO\s*(.+))?/);

  const somaProventos = r2(rubricas.filter((r) => r.tipo === "P").reduce((a, r) => a + r.valor, 0));
  const somaDescontos = r2(rubricas.filter((r) => r.tipo === "D").reduce((a, r) => a + r.valor, 0));
  const liqResc = rubricas.find((r) => r.tipo === "D" && /L[ÍI]QUIDO RESCIS[ÃA]O/i.test(r.descricao));

  return {
    matricula: ini[1],
    nome: ini[2].replace(/\s+/g, " ").trim(),
    cpfNorm: onlyDigits(cpf),
    situacao,
    vinculo,
    horasMes,
    cargoCodigo: cargoM?.[1] ?? null,
    cargo: cargoM?.[2].trim() ?? null,
    cbo,
    salarioBase: num(cargoM?.[3]),
    admissao: dataIso(ini[3]),
    demissao: dataIso(dem?.[1]),
    demissaoMotivo: dem?.[2]?.trim() || null,
    proventos,
    descontos,
    liquido,
    baseInss,
    baseFgts: num(bases?.[1]),
    baseIrrf: num(bases?.[2]),
    valorFgts,
    liquidoRescisao: liqResc ? liqResc.valor : null,
    rubricas,
    somaProventos,
    somaDescontos,
    conferido: iNd >= 0 && naoLidas.length === 0
      && Math.abs(somaProventos - proventos) <= TOLERANCIA && Math.abs(somaDescontos - descontos) <= TOLERANCIA,
    naoLidas,
    texto: semCpf(linhas.join("\n")),
  };
}

export function lerDetalhesExtrato(txt: string): DetalhesExtrato {
  const linhas = linhasDoCorpo(txt);
  const pessoas: PessoaExtrato[] = [];
  let atual: string[] | null = null;
  for (const l of linhas) {
    if (INICIO_PESSOA.test(l)) {
      if (atual) pessoas.push(lerPessoa(atual));
      atual = [l];
    } else if (FIM_PESSOAS.test(l)) {
      if (atual) pessoas.push(lerPessoa(atual));
      atual = null;
    } else if (atual) {
      atual.push(l);
    }
  }
  if (atual) pessoas.push(lerPessoa(atual));

  const totais = txt.match(new RegExp(`Total Geral Proventos:\\s*Total Geral Descontos:\\s*(${NUM})\\s+(${NUM})`));
  return {
    emissao: dataIso(txt.match(/Emiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]),
    totalProventos: num(totais?.[1]),
    totalDescontos: num(totais?.[2]),
    totalLiquido: num(txt.match(new RegExp(`L[íi]quido Geral:\\s*(${NUM})`))?.[1]),
    pessoas,
  };
}
