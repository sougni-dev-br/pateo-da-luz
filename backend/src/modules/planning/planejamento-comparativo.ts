/**
 * Comparativo ano × ano do Salão por turno (Planejamento > Comparativo).
 *
 * Substitui as abas "Clientes e TM", "Almoço x Jantar", "Vendas líquidas" e "Painel executivo" da planilha
 * de planejamento. As regras seguem a aba Metodologia dela:
 *   - venda = Mesas SEM serviço (o serviço/Doceira é informação separada);
 *   - TC = clientes (pessoas) do turno; almoço = 1º turno, jantar = 2º;
 *   - ticket médio = vendas ÷ clientes do mesmo período, nunca média de percentuais;
 *   - o acumulado soma só os meses comparáveis: com dado nos dois anos e já encerrados.
 */

export type FonteDoMes = "ERP" | "HISTORICO";

export type MesDoSalao = {
  ano: number;
  mes: number;
  vendasAlmoco: number;
  vendasJantar: number;
  clientesAlmoco: number;
  clientesJantar: number;
  servico: number;
  fonte: FonteDoMes;
  /** Dias distintos com venda no faturamento diário (só para fonte ERP): mede se o mês está completo. */
  diasComVenda?: number;
  /** Há venda sem "pessoas" registradas em algum dia: o ticket do mês sairia inflado, então clientes e ticket ficam sem dado. */
  clientesIncompletos?: boolean;
  /** Mês do ERP que não cobre ao menos 90% dos dias (e não há histórico para substituí-lo): não serve de comparação nem de base. */
  parcial?: boolean;
};

export type Turnos = { almoco: number | null; jantar: number | null; total: number | null };

export type MesComparado = {
  mes: number;
  /** Mês ainda em andamento: aparece na tabela, mas não entra no acumulado. */
  emAndamento: boolean;
  /** Dado nos dois anos, mês encerrado, clientes completos e nenhum lado parcial: é o que entra no acumulado. */
  comparavel: boolean;
  /** Algum dos lados tem venda sem clientes registrados (o mês fica fora do acumulado). */
  incompleto: boolean;
  base: { vendas: Turnos; clientes: Turnos; ticket: Turnos; servico: number | null; fonte: FonteDoMes | null; parcial: boolean };
  comparado: { vendas: Turnos; clientes: Turnos; ticket: Turnos; servico: number | null; fonte: FonteDoMes | null; parcial: boolean };
  variacao: { vendas: Turnos; clientes: Turnos; ticket: Turnos };
};

export type Acumulado = {
  base: { vendas: Turnos; clientes: Turnos; ticket: Turnos; servico: number };
  comparado: { vendas: Turnos; clientes: Turnos; ticket: Turnos; servico: number };
  variacao: { vendas: Turnos; clientes: Turnos; ticket: Turnos };
  mesesComparados: number[];
};

export type Comparativo = {
  anoBase: number;
  anoComparado: number;
  meses: MesComparado[];
  acumulado: Acumulado;
};

const SEM_DADO: Turnos = { almoco: null, jantar: null, total: null };

const arredondar = (n: number, casas = 2): number => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Variação em fração (0,05 = +5%). Sem base positiva não há comparação. */
export function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior <= 0) return null;
  return arredondar(atual / anterior - 1, 6);
}

// Quatro casas: a tela mostra duas, mas a variação do ticket sai do valor sem arredondar (a planilha faz o mesmo).
function razao(valor: number | null, divisor: number | null): number | null {
  if (valor === null || divisor === null || divisor <= 0) return null;
  return arredondar(valor / divisor, 4);
}

function turnosDe(mes: MesDoSalao | undefined, almoco: keyof MesDoSalao, jantar: keyof MesDoSalao): Turnos {
  if (!mes) return SEM_DADO;
  const a = Number(mes[almoco]);
  const j = Number(mes[jantar]);
  return { almoco: arredondar(a), jantar: arredondar(j), total: arredondar(a + j) };
}

function ticketDe(vendas: Turnos, clientes: Turnos): Turnos {
  return {
    almoco: razao(vendas.almoco, clientes.almoco),
    jantar: razao(vendas.jantar, clientes.jantar),
    total: razao(vendas.total, clientes.total)
  };
}

function variacaoDeTurnos(atual: Turnos, anterior: Turnos): Turnos {
  return {
    almoco: variacao(atual.almoco, anterior.almoco),
    jantar: variacao(atual.jantar, anterior.jantar),
    total: variacao(atual.total, anterior.total)
  };
}

function lado(mes: MesDoSalao | undefined) {
  const vendas = turnosDe(mes, "vendasAlmoco", "vendasJantar");
  const clientes = mes?.clientesIncompletos ? SEM_DADO : turnosDe(mes, "clientesAlmoco", "clientesJantar");
  return { vendas, clientes, ticket: ticketDe(vendas, clientes), servico: mes ? arredondar(mes.servico) : null, fonte: mes?.fonte ?? null, parcial: Boolean(mes?.parcial) };
}

function somar(meses: MesDoSalao[]) {
  const soma = (campo: keyof MesDoSalao) => meses.reduce((s, m) => s + Number(m[campo]), 0);
  const vendas: Turnos = {
    almoco: arredondar(soma("vendasAlmoco")),
    jantar: arredondar(soma("vendasJantar")),
    total: arredondar(soma("vendasAlmoco") + soma("vendasJantar"))
  };
  const clientes: Turnos = {
    almoco: soma("clientesAlmoco"),
    jantar: soma("clientesJantar"),
    total: soma("clientesAlmoco") + soma("clientesJantar")
  };
  return { vendas, clientes, ticket: ticketDe(vendas, clientes), servico: arredondar(soma("servico")) };
}

/**
 * `mesesEncerrados` traz "AAAA-MM" de cada mês que já fechou. Um mês só entra no acumulado se estiver nessa
 * lista no ano de CADA lado: comparar o mês corrente (parcial) com um mês cheio do ano anterior faria a
 * variação parecer queda.
 */
export function montarComparativo(
  linhas: MesDoSalao[],
  anoBase: number,
  anoComparado: number,
  mesesEncerrados: ReadonlySet<string>,
  /** "AAAA-MM" do mês corrente. Só ele é "em andamento"; mês futuro sem movimento não é. */
  mesAtual: string
): Comparativo {
  const indice = new Map(linhas.map((l) => [`${l.ano}-${l.mes}`, l]));
  const chave = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`;

  const meses: MesComparado[] = [];
  const paraSomarBase: MesDoSalao[] = [];
  const paraSomarComparado: MesDoSalao[] = [];
  const mesesComparados: number[] = [];

  for (let mes = 1; mes <= 12; mes += 1) {
    const b = indice.get(`${anoBase}-${mes}`);
    const c = indice.get(`${anoComparado}-${mes}`);
    const encerrado = mesesEncerrados.has(chave(anoBase, mes)) && mesesEncerrados.has(chave(anoComparado, mes));
    const emAndamento = Boolean(b || c) && !encerrado && (chave(anoBase, mes) === mesAtual || chave(anoComparado, mes) === mesAtual);
    const incompleto = Boolean(b?.clientesIncompletos || c?.clientesIncompletos);
    const parcial = Boolean(b?.parcial || c?.parcial);
    const comparavel = Boolean(b && c) && encerrado && !incompleto && !parcial;
    const ladoBase = lado(b);
    const ladoComparado = lado(c);

    if (comparavel && b && c) {
      paraSomarBase.push(b);
      paraSomarComparado.push(c);
      mesesComparados.push(mes);
    }

    meses.push({
      mes,
      emAndamento,
      comparavel,
      incompleto,
      base: ladoBase,
      comparado: ladoComparado,
      // Mês parcial contra mês cheio pareceria queda: só há variação onde o mês entra no acumulado.
      variacao: comparavel
        ? {
            vendas: variacaoDeTurnos(ladoComparado.vendas, ladoBase.vendas),
            clientes: variacaoDeTurnos(ladoComparado.clientes, ladoBase.clientes),
            ticket: variacaoDeTurnos(ladoComparado.ticket, ladoBase.ticket)
          }
        : { vendas: SEM_DADO, clientes: SEM_DADO, ticket: SEM_DADO }
    });
  }

  const base = somar(paraSomarBase);
  const comparado = somar(paraSomarComparado);
  return {
    anoBase,
    anoComparado,
    meses,
    acumulado: {
      base,
      comparado,
      variacao: {
        vendas: variacaoDeTurnos(comparado.vendas, base.vendas),
        clientes: variacaoDeTurnos(comparado.clientes, base.clientes),
        ticket: variacaoDeTurnos(comparado.ticket, base.ticket)
      },
      mesesComparados
    }
  };
}

/** "AAAA-MM" de todos os meses anteriores ao mês corrente (data de hoje em Brasília, "AAAA-MM-DD"). */
export function mesesEncerradosAte(hojeIso: string, anos: readonly number[]): Set<string> {
  const atual = hojeIso.slice(0, 7);
  const encerrados = new Set<string>();
  for (const ano of anos) {
    for (let mes = 1; mes <= 12; mes += 1) {
      const chave = `${ano}-${String(mes).padStart(2, "0")}`;
      if (chave < atual) encerrados.add(chave);
    }
  }
  return encerrados;
}

/** Fração mínima de dias com venda para o faturamento diário valer como o mês inteiro (o salão fecha em alguns dias). */
export const COBERTURA_MINIMA_DO_MES = 0.9;

export function diasDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

export function erpCobreOMes(diasComVenda: number, ano: number, mes: number): boolean {
  return diasComVenda >= Math.ceil(diasDoMes(ano, mes) * COBERTURA_MINIMA_DO_MES);
}

/**
 * O ERP vence quando o faturamento diário cobre o mês. Um mês só parcial no ERP (o mês em que o PDV entrou, um
 * lançamento solto, uma sincronização que falhou) perderia para o histórico completo, se houver; sem histórico,
 * o parcial do ERP é o que existe e aparece.
 */
export function mesclarFontes(erp: MesDoSalao[], historico: MesDoSalao[]): MesDoSalao[] {
  const doHistorico = new Set(historico.map((m) => `${m.ano}-${m.mes}`));
  const erpValido = erp
    .filter((m) => erpCobreOMes(m.diasComVenda ?? 0, m.ano, m.mes) || !doHistorico.has(`${m.ano}-${m.mes}`))
    .map((m) => ({ ...m, parcial: !erpCobreOMes(m.diasComVenda ?? 0, m.ano, m.mes) }));
  const usadosDoErp = new Set(erpValido.map((m) => `${m.ano}-${m.mes}`));
  return [...erpValido, ...historico.filter((m) => !usadosDoErp.has(`${m.ano}-${m.mes}`)).map((m) => ({ ...m, parcial: false }))];
}
