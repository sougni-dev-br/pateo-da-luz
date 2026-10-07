import { beforeEach, describe, expect, test, vi } from "vitest";

// Lote de pagamento da folha, com o banco de mentira: liberar (um título por empresa),
// retirar para a folha à parte, devolver, dar baixa no lote (baixa cada membro e marca a
// FOLHA_PAGA quando todos estão pagos), estornar e as travas.
const { banco } = vi.hoisted(() => ({ banco: { atual: null as null | ReturnType<typeof import("./apoio/banco-falso-lote.js")["criarBanco"]> } }));
vi.mock("../../../config/database.js", () => ({
  get prisma() { return banco.atual!.prisma; },
}));
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(async () => undefined) }));

import { assertPeriodWritableForDate } from "../../cmv-real/cmv-real.service.js";
import { auditLog } from "../../security/security-utils.js";
import { criarBanco } from "./apoio/banco-falso-lote.js";
import { gravarBaixaDoItem } from "../folha-baixa.js";
import {
  devolverAoLote, estornarLote, liberarLotes, lotesDaCompetencia, pagarLote, recusaPorLote, retirarDoLote,
} from "../folha-lote.service.js";

const eli = { id: "u1", name: "Eli", ipAddress: "10.0.0.7", userAgent: "teste" };
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const EXTRATOS = [
  { empresa: "PATEO EXEMPLO LTDA", cnpj: "11.111.111/0001-11" },
  { empresa: "CANECA EXEMPLO LTDA", cnpj: "22.222.222/0001-22" },
];
type Linha = { employeeId: string | null; nome: string; grupo: string; origem: "EXTRATO" | "SALARIO_COMBINADO" | "SEM_REGISTRO"; valor: number };
const LINHAS: Linha[] = [
  { employeeId: "e1", nome: "Ana Exemplo", grupo: "PATEO EXEMPLO LTDA", origem: "EXTRATO", valor: 1500 },
  { employeeId: "e2", nome: "Bruno Exemplo", grupo: "PATEO EXEMPLO LTDA", origem: "SALARIO_COMBINADO", valor: 1200 },
  { employeeId: "e3", nome: "Carla Exemplo", grupo: "CANECA EXEMPLO LTDA", origem: "EXTRATO", valor: 1800 },
  { employeeId: "e4", nome: "Davi Exemplo", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 900 },
];
const entrada = (linhas: Linha[] = LINHAS) => ({ ano: 2026, mes: 9, linhas, extratos: EXTRATOS });

const salario = (id: string, employeeId: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id, employeeId, type: "SALARIO", competenceYear: 2026, competenceMonth: 9, periodLabel: "Extrato 09/2026", periodStart: null,
  details: null, status: "PENDING", deletedAt: null, paymentDate: null, paidAmount: null, amount, dueDate: d("2026-10-06"),
  folhaLoteId: null, folhaLoteOrigemId: null, ...extra,
});

let b: ReturnType<typeof criarBanco>;
const item = (id: string) => b.dados.payrollItem.find((i) => i.id === id)!;
const lote = (rotulo: string) => b.dados.folhaLote.find((l) => l.rotulo === rotulo && l.status !== "CANCELADO");
const etapas = () => b.dados.tipPeriodEtapa.filter((e) => e.etapa === "FOLHA_PAGA").map((e) => `${e.acao}:${e.por}`);
const baixa = { paymentDate: "2026-10-01", paidPaymentMethodName: "PIX" };

beforeEach(() => {
  vi.clearAllMocks();
  b = criarBanco();
  banco.atual = b;
  b.dados.company.push({ cnpj: "11.111.111/0001-11", tradeName: "Pateo Exemplo" }, { cnpj: "22.222.222/0001-22", tradeName: "Caneca Exemplo" });
  for (const [id, firstName] of [["e1", "Ana"], ["e2", "Bruno"], ["e3", "Carla"], ["e4", "Davi"], ["e5", "Eva"], ["e6", "Fabio"]]) {
    b.dados.employee.push({ id, firstName, lastName: "Exemplo" });
  }
  b.dados.payrollItem.push(
    salario("p1", "e1", 1500), salario("p2", "e2", 1200), salario("p3", "e3", 1800), salario("p4", "e4", 900),
    // Eva já recebeu: a folha de líquidos já a tirou, e o salário dela não entra em lote.
    salario("p5", "e5", 700, { paymentDate: d("2026-09-30"), paidAmount: 700, status: "PAID" }),
  );
  b.dados.tipPeriod.push({ id: "tp9", competenceYear: 2026, competenceMonth: 9 });
});

describe("liberar para pagamento", () => {
  test("cria um título por empresa e um dos sem registro, com os membros, o total e o 5º dia útil", async () => {
    const r = await liberarLotes(entrada(), eli);
    expect(r.criados.map((c) => c.rotulo)).toEqual(["Folha 09/2026 · Pateo Exemplo", "Folha 09/2026 · Caneca Exemplo", "Folha 09/2026 · Sem registro"]);
    expect(r.lotes.map((l) => [l.rotulo, l.total, l.pessoas, l.dueDate, l.status])).toEqual([
      ["Folha 09/2026 · Pateo Exemplo", 2700, 2, "2026-10-06", "ABERTO"],
      ["Folha 09/2026 · Caneca Exemplo", 1800, 1, "2026-10-06", "ABERTO"],
      ["Folha 09/2026 · Sem registro", 900, 1, "2026-10-06", "ABERTO"],
    ]);
    expect(item("p1").folhaLoteId).toBe(lote("Folha 09/2026 · Pateo Exemplo")!.id);
    expect(item("p4").folhaLoteId).toBe(lote("Folha 09/2026 · Sem registro")!.id);
    expect(lote("Folha 09/2026 · Pateo Exemplo")!.grupo).toBe("11111111000111");
  });

  test("quem já está pago fica de fora", async () => {
    await liberarLotes(entrada([...LINHAS, { employeeId: "e5", nome: "Eva Exemplo", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 700 }]), eli);
    expect(item("p5").folhaLoteId).toBeNull();
    expect((await lotesDaCompetencia(2026, 9)).find((l) => l.rotulo.endsWith("Sem registro"))!.total).toBe(900);
  });

  test("liberar duas vezes não duplica; um acerto lançado depois entra no título que já existe, com aviso", async () => {
    await liberarLotes(entrada(), eli);
    const segunda = await liberarLotes(entrada(), eli);
    expect(segunda.criados).toEqual([]);
    expect(segunda.acrescentados).toBe(0);
    expect(b.dados.folhaLote).toHaveLength(3);

    b.dados.payrollItem.push(salario("p6", "e6", 650, { periodLabel: "Acerto (lista de pagamento)" }));
    const terceira = await liberarLotes(entrada([...LINHAS, { employeeId: "e6", nome: "Fabio Exemplo", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 650 }]), eli);
    expect(terceira.jaLiberada).toBe(true);
    expect(terceira.acrescentados).toBe(1);
    expect(terceira.avisos[0]).toMatch(/já tinha sido liberada: 1 lançamento/);
    expect(b.dados.folhaLote).toHaveLength(3);
    expect(terceira.lotes.find((l) => l.rotulo.endsWith("Sem registro"))!.total).toBe(1550);
  });

  test("avisa quem está na folha sem salário em aberto e o valor diferente do Contas a Pagar", async () => {
    item("p3").amount = 1750;
    const r = await liberarLotes(entrada([...LINHAS, { employeeId: "e6", nome: "Fabio Exemplo", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 500 }]), eli);
    expect(r.avisos.some((a) => a.startsWith("Fabio Exemplo: sem salário de 09/2026 em aberto"))).toBe(true);
    expect(r.avisos.some((a) => a.startsWith("Carla Exemplo: no Contas a Pagar"))).toBe(true);
    expect(r.lotes.find((l) => l.rotulo.includes("Caneca"))!.total).toBe(1750);
  });

  test("nada a liberar: recusa", async () => {
    await expect(liberarLotes(entrada([]), eli)).rejects.toMatchObject({ status: 409 });
    expect(b.dados.folhaLote).toHaveLength(0);
  });
});

describe("retirar e devolver", () => {
  test("retirar cria a folha à parte; a segunda retirada usa a mesma; o total muda", async () => {
    await liberarLotes(entrada(), eli);
    const pateo = lote("Folha 09/2026 · Pateo Exemplo")!;
    const r = await retirarDoLote(pateo.id as string, "p1", eli);
    expect(r.aParte.rotulo).toBe("Folha à parte 09/2026");
    expect(item("p1")).toMatchObject({ folhaLoteId: r.aParte.id, folhaLoteOrigemId: pateo.id });
    await retirarDoLote(lote("Folha 09/2026 · Sem registro")!.id as string, "p4", eli);
    const lotes = await lotesDaCompetencia(2026, 9);
    expect(lotes.filter((l) => l.grupo === "A_PARTE")).toHaveLength(1);
    expect(lotes.find((l) => l.grupo === "A_PARTE")!.total).toBe(2400);
    expect(lotes.find((l) => l.id === pateo.id)!.total).toBe(1200);
  });

  test("título que fica sem ninguém é cancelado; devolver volta ao título de origem e a folha à parte vazia some", async () => {
    await liberarLotes(entrada(), eli);
    const caneca = lote("Folha 09/2026 · Caneca Exemplo")!;
    const r = await retirarDoLote(caneca.id as string, "p3", eli);
    expect(r.loteCancelado).toBe(true);
    expect(b.dados.folhaLote.find((l) => l.id === caneca.id)!.status).toBe("CANCELADO");

    const volta = await devolverAoLote(r.aParte.id, "p3", eli);
    expect(volta.folhaAParteCancelada).toBe(true);
    expect(volta.destino.rotulo).toBe("Folha 09/2026 · Caneca Exemplo");
    expect(item("p3").folhaLoteOrigemId).toBeNull();
    const lotes = await lotesDaCompetencia(2026, 9);
    expect(lotes.map((l) => l.rotulo).sort()).toEqual(["Folha 09/2026 · Caneca Exemplo", "Folha 09/2026 · Pateo Exemplo", "Folha 09/2026 · Sem registro"]);
  });

  test("devolver ao título de origem ainda aberto", async () => {
    await liberarLotes(entrada(), eli);
    const pateo = lote("Folha 09/2026 · Pateo Exemplo")!;
    const { aParte } = await retirarDoLote(pateo.id as string, "p2", eli);
    await devolverAoLote(aParte.id, "p2", eli);
    expect(item("p2").folhaLoteId).toBe(pateo.id);
  });

  test("não retira de título pago nem quem não está nele", async () => {
    await liberarLotes(entrada(), eli);
    const pateo = lote("Folha 09/2026 · Pateo Exemplo")!;
    await expect(retirarDoLote(pateo.id as string, "p3", eli)).rejects.toMatchObject({ status: 404 });
    await pagarLote(pateo.id as string, baixa, eli);
    await expect(retirarDoLote(pateo.id as string, "p1", eli)).rejects.toMatchObject({ status: 409 });
  });
});

describe("baixa do lote", () => {
  test("baixa cada membro pelo valor dele e só marca a FOLHA_PAGA quando todos os títulos estão pagos", async () => {
    await liberarLotes(entrada(), eli);
    const [pateo, caneca, sr] = ["Pateo Exemplo", "Caneca Exemplo", "Sem registro"].map((n) => lote(`Folha 09/2026 · ${n}`)!.id as string);
    const r = await pagarLote(pateo, baixa, eli);
    expect(r).toMatchObject({ status: "PAGO", membros: 2, folhaPaga: false });
    expect(item("p1")).toMatchObject({ status: "PAID", paidAmount: 1500, paidPaymentMethodName: "PIX" });
    expect(item("p2")).toMatchObject({ status: "PAID", paidAmount: 1200 });
    expect((item("p1").paymentDate as Date).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(etapas()).toEqual([]);
    await pagarLote(caneca, baixa, eli);
    const fim = await pagarLote(sr, baixa, { id: "u2", name: "Gerente Exemplo" });
    expect(fim.folhaPaga).toBe(true);
    expect(etapas()).toEqual(["MARCOU:Gerente Exemplo"]);
    // A auditoria leva de onde veio a ação (ip e navegador), como nas rotas individuais.
    const doEli = vi.mocked(auditLog).mock.calls.filter((c) => c[0].userId === "u1");
    expect(doEli.length).toBeGreaterThan(0);
    expect(doEli.every((c) => c[0].ipAddress === "10.0.0.7" && c[0].userAgent === "teste")).toBe(true);
    expect(vi.mocked(auditLog).mock.calls.map((c) => c[0].action)).toContain("PAY_FOLHA_LOTE");
  });

  test("com a folha à parte, a FOLHA_PAGA espera ela também", async () => {
    await liberarLotes(entrada(), eli);
    const { aParte } = await retirarDoLote(lote("Folha 09/2026 · Sem registro")!.id as string, "p4", eli);
    for (const n of ["Pateo Exemplo", "Caneca Exemplo"]) await pagarLote(lote(`Folha 09/2026 · ${n}`)!.id as string, baixa, eli);
    expect(etapas()).toEqual([]);
    await pagarLote(aParte.id, baixa, eli);
    expect(etapas()).toEqual(["MARCOU:Eli"]);
  });

  test("o lote só se paga pelo total; forma de pagamento obrigatória", async () => {
    await liberarLotes(entrada(), eli);
    const pateo = lote("Folha 09/2026 · Pateo Exemplo")!.id as string;
    await expect(pagarLote(pateo, { ...baixa, paidAmount: 2000 }, eli)).rejects.toMatchObject({ status: 400, corpo: { message: expect.stringMatching(/pago pelo total/) } });
    await expect(pagarLote(pateo, { paymentDate: "2026-10-01" }, eli)).rejects.toMatchObject({ corpo: { message: "Forma de pagamento é obrigatória." } });
    expect(item("p1").paymentDate).toBeNull();
  });

  test("mês travado: a baixa é recusada e nada muda", async () => {
    await liberarLotes(entrada(), eli);
    vi.mocked(assertPeriodWritableForDate).mockRejectedValueOnce(new Error("Mês 10/2026 fechado no CMV."));
    const pateo = lote("Folha 09/2026 · Pateo Exemplo")!.id as string;
    await expect(pagarLote(pateo, baixa, eli)).rejects.toMatchObject({ status: 400, corpo: { message: "Mês 10/2026 fechado no CMV." } });
    expect(b.dados.folhaLote.find((l) => l.id === pateo)!.status).toBe("ABERTO");
    expect(item("p1").status).toBe("PENDING");
  });

  test("pagamento em duplicidade de um membro: nada é baixado, nem o lote", async () => {
    b.dados.payrollItem.push(salario("p9", "e1", 1500, { periodLabel: "Salário", paymentDate: d("2026-09-30"), paidAmount: 1500, status: "PAID" }));
    await liberarLotes(entrada(), eli);
    const pateo = lote("Folha 09/2026 · Pateo Exemplo")!.id as string;
    await expect(pagarLote(pateo, baixa, eli)).rejects.toMatchObject({ status: 409, corpo: { code: "BAIXA_DUPLICADA" } });
    expect(b.dados.folhaLote.find((l) => l.id === pateo)!.status).toBe("ABERTO");
    expect(item("p2").paymentDate).toBeNull();
  });

  test("estornar o lote estorna os membros e desmarca a FOLHA_PAGA", async () => {
    await liberarLotes(entrada(), eli);
    const ids = ["Pateo Exemplo", "Caneca Exemplo", "Sem registro"].map((n) => lote(`Folha 09/2026 · ${n}`)!.id as string);
    for (const id of ids) await pagarLote(id, baixa, eli);
    await expect(estornarLote(ids[0], " ", eli)).rejects.toMatchObject({ status: 400 });
    const r = await estornarLote(ids[0], "Banco devolveu o lote", eli);
    expect(r).toMatchObject({ status: "ABERTO", membros: 2 });
    expect(item("p1")).toMatchObject({ paymentDate: null, paidAmount: null, paymentNotes: "Banco devolveu o lote" });
    expect(item("p3").status).toBe("PAID");
    expect(etapas()).toEqual(["MARCOU:Eli", "DESMARCOU:Eli"]);
  });

  test("estorno em mês travado é recusado", async () => {
    await liberarLotes(entrada(), eli);
    const pateo = lote("Folha 09/2026 · Pateo Exemplo")!.id as string;
    await pagarLote(pateo, baixa, eli);
    vi.mocked(assertPeriodWritableForDate).mockRejectedValueOnce(new Error("Mês 10/2026 fechado no CMV."));
    await expect(estornarLote(pateo, "engano", eli)).rejects.toMatchObject({ status: 400 });
    expect(item("p1").status).toBe("PAID");
  });
});

describe("membro do lote", () => {
  test("não se mexe sozinho: a recusa diz o lote", async () => {
    await liberarLotes(entrada(), eli);
    expect(await recusaPorLote(item("p1").folhaLoteId as string)).toBe('Este salário está no lote "Folha 09/2026 · Pateo Exemplo": retire do lote antes.');
    await pagarLote(item("p1").folhaLoteId as string, baixa, eli);
    expect(await recusaPorLote(item("p1").folhaLoteId as string)).toMatch(/foi pago no lote .*estorne o lote/);
    expect(await recusaPorLote(null)).toBeNull();
  });

  test("acerto atualizado (Lançar acertos) muda o total do título: é a soma viva", async () => {
    await liberarLotes(entrada(), eli);
    item("p4").amount = 950;
    expect((await lotesDaCompetencia(2026, 9)).find((l) => l.rotulo.endsWith("Sem registro"))!.total).toBe(950);
    await pagarLote(lote("Folha 09/2026 · Sem registro")!.id as string, baixa, eli);
    expect(item("p4").paidAmount).toBe(950);
  });
});

describe("corrida: baixa individual × liberar", () => {
  const dados = { paymentDate: d("2026-10-01"), paidAmount: 1500, paidPaymentMethodId: null, paidPaymentMethodName: "PIX",
    differenceReason: null, paymentNotes: null, payingCompanyId: null, companyBankAccountId: null };

  test("o item entrou no lote depois da leitura da rota: a baixa individual é recusada e o lote continua pagável", async () => {
    const lidoPelaRota = { ...item("p1") } as never; // leitura da rota: ainda solto
    await liberarLotes(entrada(), eli);
    await expect(b.prisma.$transaction((tx: never) => gravarBaixaDoItem(tx, lidoPelaRota, dados, "u1", false)))
      .rejects.toMatchObject({ status: 409, corpo: { message: 'Este salário está no lote "Folha 09/2026 · Pateo Exemplo": retire do lote antes.' } });
    expect(item("p1").paymentDate).toBeNull();
    const r = await pagarLote(item("p1").folhaLoteId as string, baixa, eli);
    expect(r.status).toBe("PAGO");
  });

  test("entrou no lote entre a releitura e a gravação: a gravação condicionada não pega (P2025) e recusa", async () => {
    const lidoPelaRota = { ...item("p1") } as never;
    await liberarLotes(entrada(), eli);
    const loteId = item("p1").folhaLoteId;
    item("p1").folhaLoteId = null; // a releitura ainda o vê solto…
    const tabela = b.prisma.payrollItem as { findFirst: (a: unknown) => Promise<unknown> };
    const original = tabela.findFirst;
    tabela.findFirst = async (a: unknown) => {
      const r = await original(a);
      tabela.findFirst = original;
      item("p1").folhaLoteId = loteId; // …e o liberar o põe no lote logo depois
      return r;
    };
    await expect(b.prisma.$transaction((tx: never) => gravarBaixaDoItem(tx, lidoPelaRota, dados, "u1", false)))
      .rejects.toMatchObject({ status: 409, corpo: { message: expect.stringMatching(/está no lote/) } });
    expect(item("p1").paymentDate).toBeNull();
  });
});

describe("estorno com outro título aberto da mesma empresa", () => {
  test("pago, depois liberado de novo (acerto novo): estornar o pago é 409 com a explicação, sem 500", async () => {
    await liberarLotes(entrada(), eli);
    const pago = lote("Folha 09/2026 · Pateo Exemplo")!.id as string;
    await pagarLote(pago, baixa, eli);
    b.dados.payrollItem.push(salario("p6", "e6", 650));
    await liberarLotes(entrada([...LINHAS, { employeeId: "e6", nome: "Fabio Exemplo", grupo: "PATEO EXEMPLO LTDA", origem: "EXTRATO", valor: 650 }]), eli);
    expect(b.dados.folhaLote.filter((l) => l.grupo === "11111111000111" && l.status === "ABERTO")).toHaveLength(1);
    await expect(estornarLote(pago, "banco devolveu", eli)).rejects.toMatchObject({
      status: 409,
      corpo: { message: 'Já existe um título aberto de "Folha 09/2026 · Pateo Exemplo" para 09/2026: pague ou cancele esse título antes de estornar.' },
    });
    expect(b.dados.folhaLote.find((l) => l.id === pago)!.status).toBe("PAGO");
    expect(item("p1").status).toBe("PAID");
  });

  test("rede de segurança: o índice único recusa (P2002) → 409, não 500", async () => {
    await liberarLotes(entrada(), eli);
    const pago = lote("Folha 09/2026 · Pateo Exemplo")!.id as string;
    await pagarLote(pago, baixa, eli);
    const tabela = b.prisma.folhaLote as { updateMany: (a: unknown) => Promise<unknown> };
    const original = tabela.updateMany;
    tabela.updateMany = async () => { tabela.updateMany = original; throw Object.assign(new Error("unique"), { code: "P2002" }); };
    await expect(estornarLote(pago, "banco devolveu", eli)).rejects.toMatchObject({ status: 409, corpo: { message: expect.stringMatching(/Já existe um título da folha em aberto/) } });
    expect(item("p1").status).toBe("PAID");
  });
});

describe("decisão por item (2º salário da mesma pessoa)", () => {
  test("complemento lançado depois da liberação entra no título da pessoa; liberar de novo não diz 'ninguém novo'", async () => {
    await liberarLotes(entrada(), eli);
    b.dados.payrollItem.push(salario("p7", "e1", 300, { periodLabel: "Complemento", details: { complemento: { motivo: "diferença do extrato" } } }));
    const r = await liberarLotes(entrada(), eli);
    expect(r.acrescentados).toBe(1);
    expect(r.avisos[0]).toMatch(/1 lançamento\(s\) acrescentado/);
    expect(r.avisos.some((a) => a.startsWith("Ana Exemplo: já está num título e tem outro salário"))).toBe(true);
    expect(item("p7").folhaLoteId).toBe(item("p1").folhaLoteId);
    expect(r.lotes.find((l) => l.rotulo.includes("Pateo"))!.total).toBe(3000);
  });

  test("salário solto da competência impede a FOLHA_PAGA de marcar sozinha, mesmo com todos os títulos pagos", async () => {
    await liberarLotes(entrada(), eli);
    b.dados.payrollItem.push(salario("p7", "e1", 300, { periodLabel: "Complemento", details: { complemento: { motivo: "diferença do extrato" } } }));
    for (const n of ["Pateo Exemplo", "Caneca Exemplo", "Sem registro"]) await pagarLote(lote(`Folha 09/2026 · ${n}`)!.id as string, baixa, eli);
    expect(etapas()).toEqual([]);
    // Liberando de novo e pagando o acréscimo, marca.
    await liberarLotes(entrada(), eli);
    const novo = b.dados.folhaLote.find((l) => l.status === "ABERTO")!;
    await pagarLote(novo.id as string, baixa, eli);
    expect(etapas()).toEqual(["MARCOU:Eli"]);
  });
});

describe("duplicidade no lote: todos os suspeitos, confirmação por id", () => {
  const jaPago = (id: string, employeeId: string) =>
    salario(id, employeeId, 100, { periodLabel: "Salário", paymentDate: d("2026-09-30"), paidAmount: 100, status: "PAID" });

  test("a recusa lista todos os membros suspeitos", async () => {
    b.dados.payrollItem.push(jaPago("x1", "e1"), jaPago("x2", "e2"));
    await liberarLotes(entrada(), eli);
    const pateo = lote("Folha 09/2026 · Pateo Exemplo")!.id as string;
    const erro = await pagarLote(pateo, baixa, eli).catch((e) => e);
    expect(erro).toMatchObject({ status: 409, corpo: { code: "BAIXA_DUPLICADA" } });
    expect(erro.corpo.suspeitos.map((s: { item: { id: string }; pessoa: string }) => [s.item.id, s.pessoa])).toEqual([["p1", "Ana Exemplo"], ["p2", "Bruno Exemplo"]]);
    expect(erro.corpo.message).toMatch(/2 pessoa\(s\).*Ana Exemplo, Bruno Exemplo/);
  });

  test("a confirmação vale só para os ids enviados; o booleano antigo não libera ninguém", async () => {
    b.dados.payrollItem.push(jaPago("x1", "e1"), jaPago("x2", "e2"));
    await liberarLotes(entrada(), eli);
    const pateo = lote("Folha 09/2026 · Pateo Exemplo")!.id as string;
    await expect(pagarLote(pateo, { ...baixa, confirmaDuplicidade: true }, eli)).rejects.toMatchObject({ status: 409 });
    const parcial = await pagarLote(pateo, { ...baixa, confirmaDuplicidadeIds: ["p1"] }, eli).catch((e) => e);
    expect(parcial.corpo.suspeitos.map((s: { item: { id: string } }) => s.item.id)).toEqual(["p2"]);
    expect(item("p1").paymentDate).toBeNull();
    const ok = await pagarLote(pateo, { ...baixa, confirmaDuplicidadeIds: ["p1", "p2"] }, eli);
    expect(ok.status).toBe("PAGO");
    expect(item("p2").status).toBe("PAID");
  });
});

describe("corrida na liberação", () => {
  test("título criado e ninguém mais livre: não fica título vazio", async () => {
    const tabela = b.prisma.payrollItem as { updateMany: (a: unknown) => Promise<{ count: number }> };
    const original = tabela.updateMany;
    // Simula outro processo pegando todos os salários entre o planejamento e a gravação.
    tabela.updateMany = async () => ({ count: 0 });
    const r = await liberarLotes(entrada(), eli);
    tabela.updateMany = original;
    expect(r.criados).toEqual([]);
    expect(b.dados.folhaLote).toHaveLength(0);
  });
});
