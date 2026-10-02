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
  totalAPagar: number;         // sem registro: salário − adiantamento − 1ª quinzena + gorjeta − vales + hora extra/noturno + DSR
  adiantamentoSalarial?: number; // sem registro: já pago no dia do adiantamento (0/ausente = não recebeu)
  primeiraQuinzena?: number;   // sem registro por quinzena: já pago no dia 15 (0/ausente = não recebeu)
  comHoraExtra?: boolean;      // sem registro: o total leva hora extra ou adicional noturno
  comDsr?: boolean;            // sem registro: o total leva o DSR sobre a hora extra/noturno
  cnpjEmpresa: string | null;  // da empresa do cadastro
  pix: string | null;
  pixTipo?: string | null;
  contaBancaria?: string | null; // textoContaBancaria do cadastro
};

// PIX e conta da pessoa para a folha de líquidos (sem a pessoa no cadastro: nada).
const pagamentoDe = (p: PessoaApurada | undefined) => ({
  pix: p?.pix ?? null, pixTipo: p?.pixTipo ?? null, contaBancaria: p?.contaBancaria ?? null,
});

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
  naRescisao?: boolean;        // CLT desligado: a gorjeta do mês foi paga na rescisão
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
  // CLT desligado no mês: a gorjeta saiu na rescisão. Fora do extrato não é falta;
  // estando nele, confere com a apuração como os demais.
  const naRescisao = new Map(apuracao.filter((p) => p.noPeriodo && !p.semRegistro && p.pagoNaRescisao).map((p) => [p.employeeId, p]));
  const conferidosNaRescisao = new Set<string>();
  const outroExtratoComGorjeta = (id: string, atual: ExtratoEmpresa) =>
    extratos.some((x) => x !== atual && x.linhas.some((l) => l.employeeId === id && !aConfirmar(l) && (l.gorjeta ?? 0) > 0));
  for (const e of extratos) {
    for (const l of e.linhas) {
      if (l.employeeId && naApuracao.has(l.employeeId)) continue;
      const resc = l.employeeId && !aConfirmar(l) ? naRescisao.get(l.employeeId) : undefined;
      if (resc) {
        // Uma linha por pessoa: se ela aparece em dois extratos, vale o primeiro com gorjeta.
        if (conferidosNaRescisao.has(resc.employeeId)) continue;
        if ((l.gorjeta ?? 0) <= 0 && outroExtratoComGorjeta(resc.employeeId, e)) continue;
        conferidosNaRescisao.add(resc.employeeId);
        const valor = l.gorjeta ?? 0;
        const dif = round2(valor - resc.gorjetaLiquida);
        // Com salário combinado a gorjeta do extrato completa o salário: não se compara, como nos demais CLT.
        const st: StatusConferencia = combinados.has(resc.employeeId) ? "SALARIO_COMBINADO" : Math.abs(dif) < 0.01 ? "OK" : "DIVERGE";
        saida.push({ chave: resc.employeeId, employeeId: resc.employeeId, nome: resc.nome, empresa: e.empresa,
          apuracao: resc.gorjetaLiquida, extrato: valor, diferenca: dif, ...aceita(resc.employeeId, st), naRescisao: true });
        continue;
      }
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
// para a tela: a linha mantém o status (bate ou não) sem o valor da apuração, o do extrato
// (que, batendo, é o próprio teto − salário) nem a diferença.
export function esconderTeto<T extends { peloTeto?: boolean; apuracao: number | null; extrato: number | null; diferenca: number | null }>(linhas: T[], veDados: boolean): T[] {
  return veDados ? linhas : linhas.map((l) => (l.peloTeto ? { ...l, apuracao: null, extrato: null, diferenca: null } : l));
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
  pixTipo: string | null;
  contaBancaria: string | null;  // "Banco · Ag. 0001 · C/C 123-4" (null sem banco nem conta)
  aviso: string | null;
};

const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type DadosBancarios = {
  bankName: string | null; bankAgency: string | null; bankAccount: string | null; bankAccountDigit: string | null; bankAccountType: string;
};
const TIPO_CONTA: Record<string, string> = { CONTA_CORRENTE: "C/C", POUPANCA: "Poupança" };

/** Conta do cadastro numa linha só, para quem paga no banco. Sem banco e sem conta: null. */
export function textoContaBancaria(d: DadosBancarios): string | null {
  const limpo = (s: string | null) => (s ?? "").trim();
  const banco = limpo(d.bankName);
  const conta = limpo(d.bankAccount);
  if (!banco && !conta) return null;
  const digito = limpo(d.bankAccountDigit);
  const agencia = limpo(d.bankAgency);
  return [
    banco || null,
    agencia ? `Ag. ${agencia}` : null,
    conta ? `${TIPO_CONTA[d.bankAccountType] ?? "Conta"} ${conta}${digito ? `-${digito}` : ""}` : null,
  ].filter(Boolean).join(" · ");
}

/**
 * Sem registro com o acerto da lista ajustado à mão no Contas a Pagar (details.editadoAMao):
 * a folha paga o valor do acerto, não o recalculado pela apuração.
 */
export function aplicarAcertosAjustados(linhas: LinhaFolha[], ajustados: Map<string, number>): LinhaFolha[] {
  return linhas.map((l) => {
    const valor = l.origem === "SEM_REGISTRO" && l.employeeId ? ajustados.get(l.employeeId) : undefined;
    if (valor == null) return l;
    const msg = `Acerto ajustado à mão no Contas a Pagar (a apuração dava R$ ${reais(l.valor)}).`;
    return { ...l, valor: round2(valor), composicao: "acerto ajustado à mão no Contas a Pagar", aviso: l.aviso ? `${l.aviso} ${msg}` : msg };
  });
}

// Sem registro: o adiantamento salarial e a 1ª quinzena já saíram no dia deles, então
// aparecem na conta quando houve; a hora extra e o noturno, quando há horas no período; o
// DSR, quando entrou no total (a partir de setembro/2026).
export function composicaoSemRegistro(p: PessoaApurada): string {
  const salario = ["salário",
    ...((p.adiantamentoSalarial ?? 0) > 0 ? ["adiantamento"] : []),
    ...((p.primeiraQuinzena ?? 0) > 0 ? ["1ª quinzena"] : []),
  ].join(" − ");
  return `${salario} + gorjeta − vales${p.comHoraExtra ? " + hora extra/noturno" : ""}${p.comDsr ? " + DSR" : ""}`;
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
        // Gorjeta paga no termo de rescisão (pagoNaRescisao) não soma de novo.
        const gorjeta = p?.noPeriodo && !p.pagoNaRescisao ? p.gorjetaLiquida : 0;
        const valor = valorIntegralCombinado({ combinado, adiantamento: adiant, gorjeta });
        linhas.push({ employeeId: l.employeeId, nome: p?.nome ?? l.nome, grupo: e.empresa, origem: "SALARIO_COMBINADO", valor,
          composicao: `(${reais(combinado)} − adiant. ${reais(adiant)}) + gorjeta ${reais(gorjeta)}`,
          ...pagamentoDe(p), aviso: l.adiantamento == null ? "Adiantamento não lido no extrato: considerado zero." : null });
        continue;
      }
      if (l.liquido <= 0) continue;
      linhas.push({ employeeId: l.employeeId, nome: p?.nome ?? l.nome, grupo: e.empresa, origem: "EXTRATO", valor: round2(l.liquido),
        composicao: "líquido do extrato", ...pagamentoDe(p),
        aviso: !seguro ? "Reconhecido pelo nome: confirme a pessoa na conferência antes de pagar."
          : l.employeeId ? null : "Não achado no cadastro: confira o PIX." });
    }
  }
  for (const p of apuracao) {
    if (!p.semRegistro || !p.noPeriodo || p.totalAPagar <= 0) continue;
    linhas.push({ employeeId: p.employeeId, nome: p.nome, grupo: "Sem registro", origem: "SEM_REGISTRO", valor: round2(p.totalAPagar),
      composicao: composicaoSemRegistro(p), ...pagamentoDe(p), aviso: null });
  }
  return linhas;
}

export type JaPagoFolha = { employeeId: string; nome: string; grupo: string; valor: number; pagoEm: string };

const TOLERANCIA_PAGO = 0.01;
const diaMesBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export type SalarioPagoRow = { employeeId: string; paidAmount: unknown; amount: unknown; paymentDate: Date | null };

/**
 * Soma, por pessoa, todos os SALARIO pagos da competência (o acerto e um eventual complemento):
 * vale o paidAmount, ou o amount quando a baixa não registrou o valor. A data é a da última baixa.
 */
export function somarSalariosPagos(rows: SalarioPagoRow[]): Map<string, { valor: number; pagoEm: string }> {
  const pagos = new Map<string, { valor: number; pagoEm: string }>();
  for (const r of rows) {
    if (!r.paymentDate) continue;
    const valor = Number(r.paidAmount ?? r.amount);
    const data = r.paymentDate.toISOString().slice(0, 10);
    const atual = pagos.get(r.employeeId);
    pagos.set(r.employeeId, atual
      ? { valor: round2(atual.valor + valor), pagoEm: data > atual.pagoEm ? data : atual.pagoEm }
      : { valor: round2(valor), pagoEm: data });
  }
  return pagos;
}

/**
 * Quem já teve o salário da competência baixado no Contas a Pagar (ex.: acerto de quem recebe
 * por quinzena, pago no dia 30) sai da folha de líquidos e do total — mas só se o pago cobre o
 * valor da linha (tolerância de 1 centavo). Pago a menos: a linha fica com o saldo e um aviso.
 * Os que saíram voltam como "já pagos", com a soma paga e a data da última baixa.
 */
export function separarJaPagos(
  linhas: LinhaFolha[], pagos: Map<string, { valor: number; pagoEm: string }>,
): { linhas: LinhaFolha[]; jaPagos: JaPagoFolha[] } {
  const jaPagos: JaPagoFolha[] = [];
  const restantes: LinhaFolha[] = [];
  // O pago de uma pessoa é consumido linha a linha (raro, mas pode ter mais de uma).
  const saldoPago = new Map([...pagos].map(([id, p]) => [id, p.valor]));
  for (const l of linhas) {
    const p = l.employeeId ? pagos.get(l.employeeId) : undefined;
    const disponivel = l.employeeId ? saldoPago.get(l.employeeId) ?? 0 : 0;
    if (!p || disponivel <= 0) { restantes.push(l); continue; }
    if (disponivel >= l.valor - TOLERANCIA_PAGO) {
      saldoPago.set(l.employeeId!, round2(disponivel - l.valor));
      jaPagos.push({ employeeId: l.employeeId!, nome: l.nome, grupo: l.grupo, valor: p.valor, pagoEm: p.pagoEm });
      continue;
    }
    saldoPago.set(l.employeeId!, 0);
    const falta = round2(l.valor - disponivel);
    const msg = `Pago R$ ${reais(disponivel)} em ${diaMesBR(p.pagoEm)}; falta R$ ${reais(falta)}.`;
    restantes.push({ ...l, valor: falta, aviso: l.aviso ? `${l.aviso} ${msg}` : msg });
  }
  return { linhas: restantes, jaPagos };
}
