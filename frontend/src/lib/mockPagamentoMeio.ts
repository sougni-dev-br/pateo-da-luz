// Lista do adiantamento / 1ª quinzena para o modo ?mock-user=1 (só em dev, sem backend).
// Nomes e valores fictícios. Guarda estado: lançar pela tela muda "falta lançar" para
// "no Contas a Pagar", para dar para ver o fluxo inteiro.
import type { LinhaPagamentoMeio, PagamentoMeio, TipoPagamentoMeio } from "../api/client";

type Base = Omit<LinhaPagamentoMeio, "vencimento" | "pagoEm"> & { dia: number; pagoDia?: number };

const PIX = (pix: string, pixTipo: string) => ({ pix, pixTipo, contaBancaria: null });
const CONTA = (contaBancaria: string) => ({ pix: null, pixTipo: null, contaBancaria });
const SEM = { pix: null, pixTipo: null, contaBancaria: null };

const ALFA = "ALFA EXEMPLO COMERCIO DE ALIMENTOS LTDA";
const BETA = "BETA EXEMPLO BAR E FORNERIA LTDA";

const linhaBase = (o: Partial<Base> & Pick<Base, "employeeId" | "nome" | "valor">): Base => ({
  grupo: "Sem registro", origem: "SEM_REGISTRO", situacao: "LANCADO", valorPago: null, payrollItemId: `pi-${o.employeeId}`, aviso: null, dia: 20,
  ...SEM, ...o,
});

const ADIANTAMENTO: Base[] = [
  linhaBase({ employeeId: "m1", nome: "Ana Paula Exemplo", grupo: ALFA, origem: "EXTRATO", valor: 1034, ...PIX("ana@exemplo.com", "EMAIL") }),
  linhaBase({ employeeId: "m2", nome: "Bruno Exemplo", grupo: ALFA, origem: "EXTRATO", valor: 1096, ...CONTA("Banco Exemplo · Ag. 0001 · C/C 12345-6") }),
  linhaBase({ employeeId: "m3", nome: "Carla Exemplo", grupo: ALFA, origem: "EXTRATO", valor: 1283, situacao: "PAGO", valorPago: 1283, pagoDia: 18, ...PIX("(11) 90000-0001", "TELEFONE") }),
  linhaBase({ employeeId: "m4", nome: "Diego Exemplo", grupo: BETA, origem: "EXTRATO", valor: 897, ...PIX("diego@exemplo.com", "EMAIL") }),
  linhaBase({ employeeId: "m5", nome: "Elisa Exemplo", grupo: BETA, origem: "EXTRATO", valor: 1469, ...PIX("chave-aleatoria-exemplo", "ALEATORIA") }),
  linhaBase({ employeeId: "m6", nome: "Fabiana Exemplo", grupo: BETA, origem: "EXTRATO", valor: 880, aviso: "No cadastro está sem registro, mas veio da contabilidade: confira o vínculo em Funcionários.", ...PIX("fabi@exemplo.com", "EMAIL") }),
  linhaBase({ employeeId: "m7", nome: "Gisele Exemplo", grupo: BETA, origem: "EXTRATO", valor: 1040, aviso: "Sem empresa no cadastro (Funcionários → Trabalho).", ...SEM }),
  linhaBase({ employeeId: "m8", nome: "Helena Exemplo", valor: 920, situacao: "A_LANCAR", payrollItemId: null, aviso: "Ainda não está no Contas a Pagar: vence 20/10.", ...PIX("helena@exemplo.com", "EMAIL") }),
  linhaBase({ employeeId: "m9", nome: "Iara Exemplo", valor: 1040, situacao: "A_LANCAR", payrollItemId: null, aviso: "Ainda não está no Contas a Pagar: vence 20/10.", ...PIX("(11) 90000-0002", "TELEFONE") }),
  linhaBase({ employeeId: "m10", nome: "Joana Exemplo", valor: 880, ...SEM }),
];
const QUINZENA: Base[] = [
  linhaBase({ employeeId: "q1", nome: "Lucas Exemplo", valor: 1000, dia: 15, situacao: "A_LANCAR", payrollItemId: null, aviso: "Ainda não está no Contas a Pagar: vence 15/10.", ...PIX("lucas@exemplo.com", "EMAIL") }),
];

const lancadosAgora = new Set<string>();

function montar(tipo: TipoPagamentoMeio, ano: number, mes: number): PagamentoMeio {
  const iso = (d: number) => `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const linhas: LinhaPagamentoMeio[] = (tipo === "QUINZENA" ? QUINZENA : ADIANTAMENTO).map(({ dia, pagoDia, ...l }) => {
    const lancado = l.situacao === "A_LANCAR" && lancadosAgora.has(`${tipo}:${l.employeeId}`);
    return {
      ...l, vencimento: iso(dia), pagoEm: pagoDia ? iso(pagoDia) : null,
      ...(lancado ? { situacao: "LANCADO" as const, payrollItemId: `pi-${l.employeeId}`, aviso: null } : {}),
    };
  });
  const resumo = (s: LinhaPagamentoMeio["situacao"]) => {
    const d = linhas.filter((l) => l.situacao === s);
    return { pessoas: d.length, total: Math.round(d.reduce((a, l) => a + l.valor, 0) * 100) / 100 };
  };
  return {
    tipo, competencia: `${String(mes).padStart(2, "0")}/${ano}`, linhas, avisos: [],
    total: Math.round(linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100,
    aLancar: resumo("A_LANCAR"), lancado: resumo("LANCADO"), pago: resumo("PAGO"),
  };
}

/** GET /payroll/pagamento-meio e o POST /payroll/generate dos sem registro. */
export function mockPagamentoMeio(url: string, method = "GET", corpo?: unknown): unknown | undefined {
  const u = new URL(url, "http://localhost");
  if (u.pathname.endsWith("/payroll/pagamento-meio")) {
    const tipo = u.searchParams.get("tipo") === "QUINZENA" ? "QUINZENA" : "ADIANTAMENTO";
    return montar(tipo, Number(u.searchParams.get("year")), Number(u.searchParams.get("month")));
  }
  if (u.pathname.endsWith("/payroll/generate") && method.toUpperCase() === "POST" && typeof corpo === "string") {
    const kind = (JSON.parse(corpo) as { kind?: string }).kind;
    if (kind !== "ADIANTAMENTO_SR" && kind !== "QUINZENA_SR") return undefined;
    const tipo: TipoPagamentoMeio = kind === "QUINZENA_SR" ? "QUINZENA" : "ADIANTAMENTO";
    const novos = (tipo === "QUINZENA" ? QUINZENA : ADIANTAMENTO).filter((l) => l.situacao === "A_LANCAR" && !lancadosAgora.has(`${tipo}:${l.employeeId}`));
    for (const l of novos) lancadosAgora.add(`${tipo}:${l.employeeId}`);
    return { created: novos.length, skipped: 0, ajustados: 0, avisos: [] };
  }
  return undefined;
}
