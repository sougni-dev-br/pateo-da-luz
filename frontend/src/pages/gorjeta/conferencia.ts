import type { TipComputation, TipComputedParticipant } from "../../api/client";
import { compararComAnterior } from "./comparacaoMesAnterior";
import { MONTHS, fmtDate, money, ordenar, pts } from "./gorjetaUtils";

// O papel de conferência da apuração: de onde veio o valor do ponto, o que está pendente e o que
// cada pessoa recebe, na ordem em que quem confere lê. Serve ao PDF e à planilha: os dois saem
// do mesmo conteúdo, para nunca divergirem. Só números da gorjeta (nada de salário nem de banco).
export type Conferencia = {
  titulo: string;
  competencia: string;
  ciclo: string;
  codigo: string | null;
  fechado: boolean;
  fechadoEm: string | null;
  resumo: Array<[rotulo: string, valor: string]>;
  formacao: Array<[rotulo: string, valor: string]>;
  pendencias: string[];
  avisos: string[];
  cabecalho: string[];
  linhas: string[][];
  total: string[];
  soSalario: string[];
  anteriorLabel: string | null;
};

const num = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
// Sem espaço depois do sinal: "-R$ 50,00" o Excel lê como moeda; com espaço, ele estranha.
const sinal = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${money(Math.abs(v))}`;
const menos = (v: number) => `-${money(v)}`;

// Texto livre (nome, função, motivo) que abra com um destes caracteres o Excel trata como fórmula.
const seguroCsv = (t: string) => (/^[=+\-@\t\r]/.test(t) ? `'${t}` : t);
const nomeDe = (p: TipComputedParticipant) => p.apelido ? `${p.apelido} (${p.employeeName})` : p.employeeName;

// Texto simples de cada situação, no lugar de símbolos que o PDF e o Excel desenham diferente.
function situacaoDaLinha(p: TipComputedParticipant): string {
  if (p.rescisaoPendente) return "rescisão pendente";
  if (p.tipoCalculo === "RESCISAO_QUITADA") return "quitada na rescisão";
  if (p.tipoCalculo === "RESCISAO") return "saiu no ciclo";
  if (p.kind === "FIXO") return "cota fixa";
  if (p.gorjetaReal) return "gorjeta real";
  return "";
}

// As rescisões saem do líquido antes do ponto do mês; no modo "sobra ao livre" são pagas à parte.
function rescisoes(comp: TipComputation): Array<[string, string]> {
  if (!(comp.rescisoes.valor > 0 || comp.rescisoes.pontos > 0)) return [];
  return comp.sobraRescisaoParaSaldo === true
    ? [["Rescisões (pagas à parte, não saem do ponto do mês)", money(comp.rescisoes.valor)]]
    : [["Rescisões (saem do líquido antes do ponto)", menos(comp.rescisoes.valor)]];
}

// O que sobra (ou estoura) do líquido e para onde vai, como a tela de Apuração explica.
function rotuloDoSaldo(comp: TipComputation): string {
  if (comp.saldo < -0.005) return "Excesso (passa do líquido)";
  const destino = comp.destinoEfetivo ?? comp.destinoSobra ?? "FUNDO";
  if (destino === "LIVRE") return "Livre no período (não vai ao fundo)";
  if (destino === "REDISTRIBUIR") return "Arredondamento (pontos redistribuídos)";
  return "Sobra (vai ao fundo)";
}

const soma = (v: number[]) => Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100;

export function montarConferencia(comp: TipComputation): Conferencia {
  const pessoas = ordenar(comp.participants).filter((p) => !p.foraDaGorjeta);
  const mes = MONTHS[comp.month - 1];
  const temAnterior = Boolean(comp.anterior);

  const formacao: Array<[string, string]> = [
    ["Serviço do faturamento", money(comp.servicoFaturamento)],
    ...(comp.ajusteServico ? [[`Ajuste do serviço${comp.ajusteServicoMotivo ? ` (${comp.ajusteServicoMotivo})` : ""}`, sinal(comp.ajusteServico)] as [string, string]] : []),
    [`Retenção de ${num(comp.deductionPercent)}%`, menos(comp.grossPool - comp.netPool - (comp.quebraValor ?? 0))],
    ...(comp.quebraValor ? [[`Quebra (${num(comp.quebraPercent ?? 0)}%)`, menos(comp.quebraValor)] as [string, string]] : []),
    ["Líquido do período", money(comp.netPool)],
    ...rescisoes(comp),
    ["Cotas fixas", money(comp.fixedTotal)],
    ["Pontos disponíveis", num(comp.pontosDisponiveis)],
    ["Pontos distribuídos", num(comp.totalPoints)],
    ["Valor do ponto", money(comp.pointValue)],
  ];
  if (comp.reservaTotal) formacao.push(["Reserva da casa", money(comp.reservaTotal)]);

  const cabecalho = ["Funcionário", "Função", "Pontos", "Presença", "Pontos finais", "Gorjeta", ...(temAnterior ? ["Mês anterior", "Diferença"] : []), "Vales", "Líquido", "Obs."];
  const linhas = pessoas.map((p) => {
    const c = compararComAnterior(p, comp.pointValue, comp.anterior);
    const antes = comp.anterior?.porPessoa[p.employeeId];
    const diferenca = c ? (c.tipo === "novo" ? "novo" : c.tipo === "igual" ? "igual" : sinal(c.delta)) : "";
    return [
      nomeDe(p),
      p.functionName ?? "",
      p.kind === "PONTOS" ? pts(p.basePoints) : "-",
      p.kind === "PONTOS" ? `${p.diasComputados}/${p.diasReferencia}` : "-",
      p.kind === "PONTOS" ? pts(p.points) : "-",
      p.rescisaoPendente ? "pendente" : money(p.rateioAmount),
      ...(temAnterior ? [antes ? money(antes.gorjeta) : "", diferenca] : []),
      p.descontos - p.creditos ? money(p.descontos - p.creditos) : "",
      p.rescisaoPendente ? "pendente" : money(p.netCommission),
      situacaoDaLinha(p),
    ];
  });
  const vazios = temAnterior ? ["", ""] : [];
  // O total é a soma das linhas da tabela (a reserva da casa e quem só recebe salário ficam de fora).
  const valesTotal = soma(pessoas.map((p) => p.descontos - p.creditos));
  const total = [
    "Total", "", "", "", pts(soma(pessoas.map((p) => (p.kind === "PONTOS" ? p.points : 0)))),
    money(soma(pessoas.map((p) => (p.rescisaoPendente ? 0 : p.rateioAmount)))), ...vazios,
    valesTotal ? money(valesTotal) : "", money(soma(pessoas.map((p) => (p.rescisaoPendente ? 0 : p.netCommission)))), "",
  ];

  const fechado = comp.status === "CLOSED" && Boolean(comp.fechamento);
  return {
    titulo: "Conferência da gorjeta",
    competencia: `${mes}/${comp.year}`,
    ciclo: `${fmtDate(comp.periodStart)} a ${fmtDate(comp.periodEnd)}`,
    codigo: comp.code,
    fechado,
    fechadoEm: fechado ? fmtDate(comp.fechamento!.closedAt) : null,
    resumo: [
      ["Líquido do período", money(comp.netPool)],
      ["Distribuído", money(comp.distribuido)],
      [rotuloDoSaldo(comp), money(Math.abs(comp.saldo))],
      ["Valor do ponto", money(comp.pointValue)],
      ["Pessoas", String(pessoas.length)],
    ],
    formacao,
    pendencias: comp.pendencias,
    avisos: comp.warnings,
    cabecalho,
    linhas,
    total,
    soSalario: ordenar(comp.participants).filter((p) => p.foraDaGorjeta).map(nomeDe),
    anteriorLabel: comp.anterior?.label ?? null,
  };
}

export function linhasCsvConferencia(c: Conferencia): string[][] {
  return [
    [c.titulo, c.competencia, `Ciclo ${c.ciclo}`, c.codigo ?? "", c.fechado ? `Fechado em ${c.fechadoEm}` : "Prévia - gorjeta em aberto"],
    [],
    ...c.resumo.map(([r, v]) => [r, v]),
    [],
    ["Como o valor foi formado"],
    ...c.formacao.map(([r, v]) => [r, v]),
    [],
    [c.pendencias.length ? `Pendências que impedem o fechamento (${c.pendencias.length})` : "Nenhuma pendência"],
    ...c.pendencias.map((t) => [seguroCsv(t)]),
    ...(c.avisos.length ? [[`Para conferir (${c.avisos.length})`], ...c.avisos.map((t) => [seguroCsv(t)])] : []),
    [],
    c.cabecalho,
    ...c.linhas.map((l) => l.map((t, i) => (i <= 1 || i === l.length - 1 ? seguroCsv(t) : t))),
    c.total,
    ...(c.soSalario.length ? [[], ["Só salário (fora do rateio)", seguroCsv(c.soSalario.join(", "))]] : []),
  ];
}
