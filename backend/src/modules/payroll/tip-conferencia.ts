// Conferência do extrato da contabilidade × apuração da gorjeta, e a folha de
// líquidos (lista de pagamento no banco). Só regra, sem banco: testável.
//
// A contabilidade lança a gorjeta LÍQUIDA (rateio − vales + créditos). Para quem
// tem salário combinado, a gorjeta do extrato completa o salário e não precisa
// bater com a apuração; o líquido dele na folha é (combinado − adiantamento) + gorjeta.

const round2 = (v: number) => Math.round(v * 100) / 100;

export type PessoaApurada = {
  employeeId: string;
  nome: string;
  semRegistro: boolean;
  noPeriodo: boolean;          // tipoCalculo ≠ FORA_DO_PERIODO
  pagoNaRescisao: boolean;
  gorjetaLiquida: number;      // netCommission
  totalAPagar: number;         // sem registro: salário + gorjeta − vales
  cnpjEmpresa: string | null;  // da empresa do cadastro
  pix: string | null;
};

export type LinhaExtrato = {
  employeeId: string | null;
  nome: string;
  liquido: number;
  gorjeta: number | null;
  adiantamento: number | null;
  situacao: string | null;
};

export type ExtratoEmpresa = { empresa: string; cnpj: string; linhas: LinhaExtrato[] };

export type StatusConferencia =
  | "OK" | "DIVERGE" | "ACEITA" | "SALARIO_COMBINADO"
  | "FALTA_NO_EXTRATO" | "SO_NO_EXTRATO" | "SEM_EXTRATO_DA_EMPRESA" | "NAO_PARTICIPA";

export type LinhaConferencia = {
  chave: string;               // employeeId ou "extrato:<nome>"
  employeeId: string | null;
  nome: string;
  empresa: string | null;
  apuracao: number | null;
  extrato: number | null;
  diferenca: number | null;
  status: StatusConferencia;
  justificativa: string | null;
};

const PENDENTES: StatusConferencia[] = ["DIVERGE", "FALTA_NO_EXTRATO", "SO_NO_EXTRATO", "SEM_EXTRATO_DA_EMPRESA"];
export const ehPendente = (s: StatusConferencia) => PENDENTES.includes(s);
const digitos = (t: string | null) => (t ?? "").replace(/\D/g, "");

// Salário combinado vale para a pessoa, esteja ou não na apuração da gorjeta.
export type Combinados = Map<string, number>;

export function conferir(
  apuracao: PessoaApurada[], extratos: ExtratoEmpresa[], aceites: Map<string, string>, combinados: Combinados = new Map(),
): LinhaConferencia[] {
  const saida: LinhaConferencia[] = [];
  const noExtrato = new Map<string, { linha: LinhaExtrato; empresa: string }>();
  for (const e of extratos) for (const l of e.linhas) if (l.employeeId) noExtrato.set(l.employeeId, { linha: l, empresa: e.empresa });
  const cnpjsCarregados = new Set(extratos.map((e) => digitos(e.cnpj)));
  const aceita = (chave: string, status: StatusConferencia) =>
    (ehPendente(status) && aceites.has(chave) ? { status: "ACEITA" as const, justificativa: aceites.get(chave)! } : { status, justificativa: null });

  // CLT da apuração: a gorjeta líquida tem de aparecer no extrato da empresa.
  const clt = apuracao.filter((p) => p.noPeriodo && !p.semRegistro && !p.pagoNaRescisao);
  for (const p of clt) {
    const ex = noExtrato.get(p.employeeId);
    if (!ex) {
      const semExtrato = !p.cnpjEmpresa || !cnpjsCarregados.has(digitos(p.cnpjEmpresa));
      const st = semExtrato ? "SEM_EXTRATO_DA_EMPRESA" : "FALTA_NO_EXTRATO";
      saida.push({ chave: p.employeeId, employeeId: p.employeeId, nome: p.nome, empresa: null,
        apuracao: p.gorjetaLiquida, extrato: null, diferenca: null, ...aceita(p.employeeId, st) });
      continue;
    }
    const valor = ex.linha.gorjeta ?? 0;
    const dif = round2(valor - p.gorjetaLiquida);
    const base: StatusConferencia = combinados.has(p.employeeId) ? "SALARIO_COMBINADO" : Math.abs(dif) < 0.01 ? "OK" : "DIVERGE";
    saida.push({ chave: p.employeeId, employeeId: p.employeeId, nome: p.nome, empresa: ex.empresa,
      apuracao: p.gorjetaLiquida, extrato: valor, diferenca: dif, ...aceita(p.employeeId, base) });
  }

  // No extrato e fora da apuração: com gorjeta é divergência; sem gorjeta, só não participa.
  const naApuracao = new Set(clt.map((p) => p.employeeId));
  for (const e of extratos) {
    for (const l of e.linhas) {
      if (l.employeeId && naApuracao.has(l.employeeId)) continue;
      const chave = l.employeeId ?? `extrato:${l.nome}`;
      const comGorjeta = (l.gorjeta ?? 0) > 0;
      const st: StatusConferencia = l.employeeId && combinados.has(l.employeeId) ? "SALARIO_COMBINADO"
        : comGorjeta ? "SO_NO_EXTRATO" : "NAO_PARTICIPA";
      saida.push({ chave, employeeId: l.employeeId, nome: l.nome, empresa: e.empresa,
        apuracao: null, extrato: l.gorjeta, diferenca: null, ...aceita(chave, st) });
    }
  }
  return saida;
}

export type OrigemFolha = "EXTRATO" | "SALARIO_COMBINADO" | "SEM_REGISTRO";
export type LinhaFolha = {
  employeeId: string | null;
  nome: string;
  grupo: string;           // empresa do extrato ou "Sem registro"
  origem: OrigemFolha;
  valor: number;
  composicao: string;
  pix: string | null;
  aviso: string | null;
};

const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Folha salarial líquidos: o que o banco paga. CLT pelo extrato (ou pela regra do
// salário combinado); sem registro pelo total da apuração. Valor zero fica de fora.
export function montarFolhaLiquidos(apuracao: PessoaApurada[], extratos: ExtratoEmpresa[], combinados: Combinados = new Map()): LinhaFolha[] {
  const porId = new Map(apuracao.map((p) => [p.employeeId, p]));
  const linhas: LinhaFolha[] = [];
  for (const e of extratos) {
    for (const l of e.linhas) {
      const p = l.employeeId ? porId.get(l.employeeId) : undefined;
      const combinado = l.employeeId ? combinados.get(l.employeeId) : undefined;
      if (combinado != null) {
        const adiant = l.adiantamento ?? 0;
        const gorjeta = p?.noPeriodo ? p.gorjetaLiquida : 0;
        const valor = round2(combinado - adiant + gorjeta);
        linhas.push({ employeeId: l.employeeId, nome: p?.nome ?? l.nome, grupo: e.empresa, origem: "SALARIO_COMBINADO", valor,
          composicao: `(${reais(combinado)} − adiant. ${reais(adiant)}) + gorjeta ${reais(gorjeta)}`,
          pix: p?.pix ?? null, aviso: l.adiantamento == null ? "Adiantamento não lido no extrato: considerado zero." : null });
        continue;
      }
      if (l.liquido <= 0) continue;
      linhas.push({ employeeId: l.employeeId, nome: p?.nome ?? l.nome, grupo: e.empresa, origem: "EXTRATO", valor: round2(l.liquido),
        composicao: "líquido do extrato", pix: p?.pix ?? null,
        aviso: l.employeeId ? null : "Não achado no cadastro: confira o PIX." });
    }
  }
  for (const p of apuracao) {
    if (!p.semRegistro || !p.noPeriodo || p.totalAPagar <= 0) continue;
    linhas.push({ employeeId: p.employeeId, nome: p.nome, grupo: "Sem registro", origem: "SEM_REGISTRO", valor: round2(p.totalAPagar),
      composicao: "salário + gorjeta − vales", pix: p.pix, aviso: null });
  }
  return linhas;
}
