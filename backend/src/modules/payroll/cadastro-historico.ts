// Histórico do cadastro de funcionários — regras puras (sem banco).
//
// Cada alteração de salário, vínculo, empresa, cargo etc. vira uma linha com o valor de
// antes, o de depois e a data a partir da qual vale (vigenteDesde). Cálculo de mês
// passado (gorjeta, folha, rescisão) usa o valor VIGENTE naquele mês, não o atual
// (decisão do Eli, "Opção A", 30/09/2026).

export const CAMPOS_HISTORICO = [
  "baseSalary", "salarioCombinado", "modality", "companyId", "position", "recebeAdiantamento", "pagamentoQuinzenal",
] as const;
export type CampoHistorico = (typeof CAMPOS_HISTORICO)[number];

// Sim/não do cadastro: gravados no histórico como "true"/"false".
const CAMPOS_BOOLEANOS: ReadonlySet<CampoHistorico> = new Set(["recebeAdiantamento", "pagamentoQuinzenal"]);

// Salário só aparece para quem pode ver Funcionários.
export const CAMPOS_SALARIO: ReadonlySet<CampoHistorico> = new Set(["baseSalary", "salarioCombinado"]);

export const ROTULO_CAMPO: Record<CampoHistorico, string> = {
  baseSalary: "Salário base",
  salarioCombinado: "Salário combinado",
  modality: "Vínculo",
  companyId: "Empresa",
  position: "Cargo",
  recebeAdiantamento: "Adiantamento salarial",
  pagamentoQuinzenal: "Pagamento por quinzena",
};

export type LinhaHistorico = {
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  vigenteDesde: Date;
  createdAt: Date;
};

export type Alteracao = { campo: CampoHistorico; valorAnterior: string | null; valorNovo: string | null };

// Valor do cadastro em texto: dinheiro com 2 casas (Decimal do Prisma e número comparam
// igual), booleano "true"/"false", vazio vira null.
export function serializar(campo: CampoHistorico, valor: unknown): string | null {
  if (valor == null || valor === "") return null;
  if (campo === "baseSalary" || campo === "salarioCombinado") {
    const n = Number(valor);
    return Number.isFinite(n) ? n.toFixed(2) : null;
  }
  if (CAMPOS_BOOLEANOS.has(campo)) return valor === true || valor === "true" ? "true" : "false";
  const s = String(valor).trim();
  return s === "" ? null : s;
}

export type ValorCadastro = {
  baseSalary: number | null;
  salarioCombinado: number | null;
  modality: string;
  companyId: string | null;
  position: string | null;
  recebeAdiantamento: boolean;
  pagamentoQuinzenal: boolean;
};

// Texto do histórico de volta ao tipo do cadastro.
export function desserializar<C extends CampoHistorico>(campo: C, texto: string | null): ValorCadastro[C] {
  if (campo === "baseSalary" || campo === "salarioCombinado") return (texto == null ? null : Number(texto)) as ValorCadastro[C];
  if (CAMPOS_BOOLEANOS.has(campo)) return (texto === "true") as ValorCadastro[C];
  if (campo === "modality") return (texto ?? "CLT") as ValorCadastro[C];
  return texto as ValorCadastro[C];
}

// O que mudou entre o cadastro antes e o que vai ser gravado. Campo ausente em `depois`
// (undefined) não foi mexido e não entra.
export function alteracoes(antes: Record<string, unknown>, depois: Record<string, unknown>): Alteracao[] {
  const out: Alteracao[] = [];
  for (const campo of CAMPOS_HISTORICO) {
    if (!(campo in depois) || depois[campo] === undefined) continue;
    const valorAnterior = serializar(campo, antes[campo]);
    const valorNovo = serializar(campo, depois[campo]);
    if (valorAnterior !== valorNovo) out.push({ campo, valorAnterior, valorNovo });
  }
  return out;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

// Ordem em que as linhas foram registradas (o backfill grava a data do audit).
function porRegistro(a: LinhaHistorico, b: LinhaHistorico) {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

// Valor de UM campo vigente num dia. Regra:
//   1. Sem linha nenhuma: o valor atual do cadastro (nunca mudou desde que há registro).
//   2. Reproduz as linhas na ordem em que foram registradas; cada uma diz "a partir de
//      vigenteDesde vale valorNovo". Vale a última registrada com vigenteDesde <= dia.
//   3. Nenhuma com vigenteDesde <= dia (o dia é anterior a todas as mudanças): o valor
//      de antes da primeira mudança registrada — valorAnterior da primeira linha.
// Ordem de REGISTRO, não de vigência: um aumento retroativo lançado depois (vigente desde
// agosto, registrado em outubro) vale sobre uma mudança de setembro registrada antes
// dele — é o que o cadastro atual mostra. Quando as vigências seguem a ordem de registro
// (o caso comum), dá o mesmo que "a última linha com vigenteDesde <= dia".
export function valorVigenteEm(linhas: LinhaHistorico[], atual: string | null, data: Date): string | null {
  if (linhas.length === 0) return atual;
  const ordenadas = [...linhas].sort(porRegistro);
  const alvo = dia(data);
  const valendo = ordenadas.filter((l) => dia(l.vigenteDesde) <= alvo);
  if (valendo.length > 0) return valendo[valendo.length - 1].valorNovo;
  return ordenadas[0].valorAnterior;
}

// O cadastro inteiro (os campos rastreados) como estava num dia.
export function cadastroVigenteEm<T extends Partial<Record<CampoHistorico, unknown>>>(
  atual: T, linhas: LinhaHistorico[], data: Date,
): T {
  const out: Record<string, unknown> = { ...atual };
  for (const campo of CAMPOS_HISTORICO) {
    if (!(campo in atual)) continue;
    const doCampo = linhas.filter((l) => l.campo === campo);
    if (doCampo.length === 0) continue;
    out[campo] = desserializar(campo, valorVigenteEm(doCampo, serializar(campo, atual[campo]), data));
  }
  return out as T;
}

// Dia de referência do salário de um mês de competência: o último dia do mês civil, ou o
// dia da saída se a pessoa saiu antes dele (o salário daquele mês é o que valia na saída).
// Quem mudou no meio do mês recebe o mês inteiro pelo valor do fim — como o RH faz a folha.
export function diaDeReferencia(ano: number, mes: number, desligamento: Date | null | undefined): Date {
  const fim = new Date(Date.UTC(ano, mes, 0));
  if (desligamento && desligamento < new Date(fim.getTime() + 86_400_000)) {
    return new Date(Date.UTC(desligamento.getUTCFullYear(), desligamento.getUTCMonth(), desligamento.getUTCDate()));
  }
  return fim;
}

// "Vale a partir de": AAAA-MM-DD; padrão hoje em São Paulo. Não antes da admissão, nem
// mais de um ano à frente (aumento combinado para o mês que vem pode; ano digitado errado não).
const LIMITE_FUTURO_DIAS = 366;
export function lerVigenteDesde(
  valor: unknown, hojeIso: string, admissao: Date | null,
): { erro: string } | { data: Date } {
  const hoje = new Date(`${hojeIso}T00:00:00.000Z`);
  const admissaoDia = admissao ? dia(admissao) : null;
  if (valor == null || valor === "") {
    // Admissão futura (cadastro feito antes de a pessoa começar): vale desde a admissão.
    return { data: admissaoDia && admissaoDia > hojeIso ? new Date(`${admissaoDia}T00:00:00.000Z`) : hoje };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor).trim());
  const data = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`) : null;
  if (!data || isNaN(data.getTime()) || dia(data) !== `${m![1]}-${m![2]}-${m![3]}`) {
    return { erro: "Data de \"vale a partir de\" inválida." };
  }
  if (admissaoDia && dia(data) < admissaoDia) {
    return { erro: `"Vale a partir de" não pode ser antes da admissão (${admissaoDia.split("-").reverse().join("/")}).` };
  }
  if (data.getTime() - hoje.getTime() > LIMITE_FUTURO_DIAS * 86_400_000) {
    return { erro: "\"Vale a partir de\" não pode passar de um ano à frente." };
  }
  return { data };
}

// Salário e vínculo alterados valendo desde um mês ANTERIOR ao atual mudam a folha, a
// gorjeta e a rescisão de meses já calculados. Sem motivo, ninguém sabe depois por que o
// mês passado mudou: exige pelo menos 5 letras. Mudança no próprio mês (ou futura) não.
export const CAMPOS_RETROATIVO_EXIGE_MOTIVO: ReadonlySet<CampoHistorico> = new Set(["baseSalary", "salarioCombinado", "modality"]);
const MIN_LETRAS_MOTIVO = 5;

export function faltaMotivoRetroativo(
  campos: readonly CampoHistorico[], vigenteDesde: Date, hojeIso: string, motivo: string | null | undefined,
): string | null {
  if (!campos.some((c) => CAMPOS_RETROATIVO_EXIGE_MOTIVO.has(c))) return null;
  const mesVigencia = dia(vigenteDesde).slice(0, 7);
  if (mesVigencia >= hojeIso.slice(0, 7)) return null;
  const letras = (motivo ?? "").match(/\p{L}/gu)?.length ?? 0;
  if (letras >= MIN_LETRAS_MOTIVO) return null;
  return `Alteração valendo desde ${mesVigencia.slice(5, 7)}/${mesVigencia.slice(0, 4)} muda cálculos de meses passados: informe o motivo.`;
}
