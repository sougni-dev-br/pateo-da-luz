// Conferência do extrato da contabilidade × apuração da gorjeta, e a folha de
// líquidos (lista de pagamento no banco). Só regra, sem banco: testável.
//
// A contabilidade lança a gorjeta LÍQUIDA (rateio − vales + créditos). Para quem
// tem salário combinado, a gorjeta do extrato completa o salário e não precisa
// bater com a apuração; o líquido dele na folha é (combinado − adiantamento) + gorjeta.
// Quem tem teto do IR para a gorjeta (CLT) vai à contabilidade com a gorjeta INFORMADA
// (teto − salário registrado): o extrato tem de bater com ela, com ou sem salário
// combinado. Na folha de líquidos ele continua recebendo a gorjeta real.

import { valorIntegralCombinado } from "./salario-combinado-folha.js";

const round2 = (v: number) => Math.round(v * 100) / 100;

export type PessoaApurada = {
  employeeId: string;
  nome: string;
  semRegistro: boolean;
  noPeriodo: boolean;          // tipoCalculo ≠ FORA_DO_PERIODO
  pagoNaRescisao: boolean;
  gorjetaLiquida: number;      // netCommission
  gorjetaInformada?: number;   // o que foi enviado à contabilidade (= gorjetaLiquida sem teto)
  peloTeto?: boolean;          // gorjeta informada pelo teto do IR
  totalAPagar: number;         // sem registro: salário − adiantamento − 1ª quinzena + gorjeta − vales + hora extra/noturno
  adiantamentoSalarial?: number; // sem registro: já pago no dia do adiantamento (0/ausente = não recebeu)
  primeiraQuinzena?: number;   // sem registro por quinzena: já pago no dia 15 (0/ausente = não recebeu)
  comHoraExtra?: boolean;      // sem registro: o total leva hora extra ou adicional noturno
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
  // Como a pessoa foi achada no cadastro: CPF é seguro; NOME precisa de confirmação
  // antes de a folha usar PIX e salário combinado do cadastro.
  vinculo?: "CPF" | "NOME" | "CONFIRMADO";
};

export type ExtratoEmpresa = { id?: string; empresa: string; cnpj: string; linhas: LinhaExtrato[] };

export type StatusConferencia =
  | "OK" | "DIVERGE" | "ACEITA" | "SALARIO_COMBINADO"
  | "FALTA_NO_EXTRATO" | "SO_NO_EXTRATO" | "SEM_EXTRATO_DA_EMPRESA" | "NAO_PARTICIPA" | "VINCULO_A_CONFIRMAR";

export type LinhaConferencia = {
  chave: string;               // employeeId ou "extrato:<nome>"
  employeeId: string | null;
  nome: string;
  // Apelido do cadastro (null sem vínculo, sem apelido ou igual ao nome).
  apelido: string | null;
  empresa: string | null;
  apuracao: number | null;
  extrato: number | null;
  diferenca: number | null;
  status: StatusConferencia;
  justificativa: string | null;
  extratoId?: string;          // de qual extrato veio (para confirmar o vínculo)
  nomeNoExtrato?: string;      // como a pessoa está escrita no extrato
  peloTeto?: boolean;          // a apuração é a gorjeta informada pelo teto do IR
};

const PENDENTES: StatusConferencia[] = ["DIVERGE", "FALTA_NO_EXTRATO", "SO_NO_EXTRATO", "SEM_EXTRATO_DA_EMPRESA", "VINCULO_A_CONFIRMAR"];
const aConfirmar = (l: LinhaExtrato) => l.vinculo === "NOME";
export const ehPendente = (s: StatusConferencia) => PENDENTES.includes(s);
const digitos = (t: string | null) => (t ?? "").replace(/\D/g, "");

// Salário combinado vale para a pessoa, esteja ou não na apuração da gorjeta.
export type Combinados = Map<string, number>;
// Apelido por employeeId (só quem tem).
export type Apelidos = Map<string, string | null>;

export function conferir(
  apuracao: PessoaApurada[], extratos: ExtratoEmpresa[], aceites: Map<string, string>, combinados: Combinados = new Map(),
  apelidos: Apelidos = new Map(),
): LinhaConferencia[] {
  const saida: Array<Omit<LinhaConferencia, "apelido">> = [];
  const noExtrato = new Map<string, { linha: LinhaExtrato; empresa: string; id?: string }>();
  for (const e of extratos) for (const l of e.linhas) if (l.employeeId) noExtrato.set(l.employeeId, { linha: l, empresa: e.empresa, id: e.id });
  const cnpjsCarregados = new Set(extratos.map((e) => digitos(e.cnpj)));
  const aceita = (chave: string, status: StatusConferencia) =>
    (ehPendente(status) && aceites.has(chave) ? { status: "ACEITA" as const, justificativa: aceites.get(chave)! } : { status, justificativa: null });

  // CLT da apuração: a gorjeta líquida tem de aparecer no extrato da empresa.
  const clt = apuracao.filter((p) => p.noPeriodo && !p.semRegistro && !p.pagoNaRescisao);
  for (const p of clt) {
    // O que foi enviado à contabilidade: com teto, a gorjeta informada; sem, a líquida.
    const teto = p.peloTeto && p.gorjetaInformada != null ? { peloTeto: true } : {};
    const enviada = teto.peloTeto ? p.gorjetaInformada! : p.gorjetaLiquida;
    const ex = noExtrato.get(p.employeeId);
    if (!ex) {
      const semExtrato = !p.cnpjEmpresa || !cnpjsCarregados.has(digitos(p.cnpjEmpresa));
      const st = semExtrato ? "SEM_EXTRATO_DA_EMPRESA" : "FALTA_NO_EXTRATO";
      saida.push({ chave: p.employeeId, employeeId: p.employeeId, nome: p.nome, empresa: null,
        apuracao: enviada, extrato: null, diferenca: null, ...aceita(p.employeeId, st), ...teto });
      continue;
    }
    const valor = ex.linha.gorjeta ?? 0;
    const dif = round2(valor - enviada);
    if (aConfirmar(ex.linha)) {
      saida.push({ chave: p.employeeId, employeeId: p.employeeId, nome: p.nome, empresa: ex.empresa,
        apuracao: enviada, extrato: ex.linha.gorjeta, diferenca: null, status: "VINCULO_A_CONFIRMAR", justificativa: null, extratoId: ex.id, nomeNoExtrato: ex.linha.nome, ...teto });
      continue;
    }
    // Com teto a gorjeta do extrato é conhecida e confere, mesmo com salário combinado.
    const base: StatusConferencia = !teto.peloTeto && combinados.has(p.employeeId) ? "SALARIO_COMBINADO" : Math.abs(dif) < 0.01 ? "OK" : "DIVERGE";
    saida.push({ chave: p.employeeId, employeeId: p.employeeId, nome: p.nome, empresa: ex.empresa,
      apuracao: enviada, extrato: valor, diferenca: dif, ...aceita(p.employeeId, base), ...teto });
  }

  // No extrato e fora da apuração: com gorjeta é divergência; sem gorjeta, só não participa.
  const naApuracao = new Set(clt.map((p) => p.employeeId));
  for (const e of extratos) {
    for (const l of e.linhas) {
      if (l.employeeId && naApuracao.has(l.employeeId)) continue;
      const chave = l.employeeId ?? `extrato:${l.nome}`;
      const comGorjeta = (l.gorjeta ?? 0) > 0;
      if (aConfirmar(l)) {
        saida.push({ chave, employeeId: l.employeeId, nome: l.nome, empresa: e.empresa,
          apuracao: null, extrato: l.gorjeta, diferenca: null, status: "VINCULO_A_CONFIRMAR", justificativa: null, extratoId: e.id, nomeNoExtrato: l.nome });
        continue;
      }
      const st: StatusConferencia = l.employeeId && combinados.has(l.employeeId) ? "SALARIO_COMBINADO"
        : comGorjeta ? "SO_NO_EXTRATO" : "NAO_PARTICIPA";
      saida.push({ chave, employeeId: l.employeeId, nome: l.nome, empresa: e.empresa,
        apuracao: null, extrato: l.gorjeta, diferenca: null, ...aceita(chave, st) });
    }
  }
  return saida.map((l) => ({ ...l, apelido: l.employeeId ? apelidos.get(l.employeeId) ?? null : null }));
}

// Sem a permissão de Funcionários, a gorjeta informada pelo teto (teto − salário) não vai
// para a tela: a linha mantém o status (bate ou não) sem o valor da apuração nem a diferença.
export function esconderTeto<T extends { peloTeto?: boolean; apuracao: number | null; diferenca: number | null }>(linhas: T[], veDados: boolean): T[] {
  return veDados ? linhas : linhas.map((l) => (l.peloTeto ? { ...l, apuracao: null, diferenca: null } : l));
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

// Sem registro: o adiantamento salarial e a 1ª quinzena já saíram no dia deles, então
// aparecem na conta quando houve; a hora extra e o noturno, quando há horas no período.
export function composicaoSemRegistro(p: PessoaApurada): string {
  const salario = ["salário",
    ...((p.adiantamentoSalarial ?? 0) > 0 ? ["adiantamento"] : []),
    ...((p.primeiraQuinzena ?? 0) > 0 ? ["1ª quinzena"] : []),
  ].join(" − ");
  return `${salario} + gorjeta − vales${p.comHoraExtra ? " + hora extra/noturno" : ""}`;
}

// Folha salarial líquidos: o que o banco paga. CLT pelo extrato (ou pela regra do
// salário combinado); sem registro pelo total da apuração. Valor zero fica de fora.
export function montarFolhaLiquidos(apuracao: PessoaApurada[], extratos: ExtratoEmpresa[], combinados: Combinados = new Map()): LinhaFolha[] {
  const porId = new Map(apuracao.map((p) => [p.employeeId, p]));
  const linhas: LinhaFolha[] = [];
  for (const e of extratos) {
    for (const l of e.linhas) {
      // Vínculo pelo nome ainda não confirmado: não usa nada do cadastro (PIX, combinado).
      const seguro = !aConfirmar(l);
      const p = l.employeeId && seguro ? porId.get(l.employeeId) : undefined;
      const combinado = l.employeeId && seguro ? combinados.get(l.employeeId) : undefined;
      if (combinado != null) {
        const adiant = l.adiantamento ?? 0;
        const gorjeta = p?.noPeriodo ? p.gorjetaLiquida : 0;
        const valor = valorIntegralCombinado({ combinado, adiantamento: adiant, gorjeta });
        linhas.push({ employeeId: l.employeeId, nome: p?.nome ?? l.nome, grupo: e.empresa, origem: "SALARIO_COMBINADO", valor,
          composicao: `(${reais(combinado)} − adiant. ${reais(adiant)}) + gorjeta ${reais(gorjeta)}`,
          pix: p?.pix ?? null, aviso: l.adiantamento == null ? "Adiantamento não lido no extrato: considerado zero." : null });
        continue;
      }
      if (l.liquido <= 0) continue;
      linhas.push({ employeeId: l.employeeId, nome: p?.nome ?? l.nome, grupo: e.empresa, origem: "EXTRATO", valor: round2(l.liquido),
        composicao: "líquido do extrato", pix: p?.pix ?? null,
        aviso: !seguro ? "Reconhecido pelo nome: confirme a pessoa na conferência antes de pagar."
          : l.employeeId ? null : "Não achado no cadastro: confira o PIX." });
    }
  }
  for (const p of apuracao) {
    if (!p.semRegistro || !p.noPeriodo || p.totalAPagar <= 0) continue;
    linhas.push({ employeeId: p.employeeId, nome: p.nome, grupo: "Sem registro", origem: "SEM_REGISTRO", valor: round2(p.totalAPagar),
      composicao: composicaoSemRegistro(p), pix: p.pix, aviso: null });
  }
  return linhas;
}
