import { describe, expect, test } from "vitest";
import { decidirEscala } from "../cartao-ponto.service.js";
import { ehCartaoPonto, lerCartaoPonto } from "../cartao-ponto-parser.js";

const CABECALHO =
  "Nome da empresa;CNPJ da empresa;Nome do funcionário;CPF do funcionário;PIS do funcionário;Dia;Previsto;Entrada 1;Saída 1;Entrada 2;Saída 2;Total Normais;Justificativas";
const CPF = "11144477735";

const linha = (dia: string, e1: string, s1: string, e2: string, s2: string, just = "") =>
  `EMPRESA;00000000000191;PESSOA EXEMPLO;${CPF};12345678901;${dia}; 08:00-12:00 13:00-16:20;${e1};${s1};${e2};${s2}; 07:20; ${just}`;

const arquivo = (...linhas: string[]) => ["﻿" + CABECALHO, ...linhas].join("\r\n");

describe("lerCartaoPonto", () => {
  test("reconhece o formato pelas colunas", () => {
    expect(ehCartaoPonto(arquivo())).toBe(true);
    expect(ehCartaoPonto("Nome;Idade\nA;1")).toBe(false);
  });

  test("dia com batidas coletadas e incluídas à mão vale pelas batidas", () => {
    const r = lerCartaoPonto(arquivo(linha("05/10/2026 SEG", "12:12 (C)", "15:27 (C)", "16:21 (C)", "20:40 (I)")));
    expect(r.dias).toHaveLength(1);
    expect(r.dias[0]).toMatchObject({ cpf: CPF, data: "2026-10-05", marcacoes: ["12:12", "15:27", "16:21", "20:40"], tipo: null });
  });

  test("traduz Folga, Falta, Feriado e Justificado Banco quando o dia não tem batida", () => {
    const r = lerCartaoPonto(
      arquivo(
        linha("03/10/2026 SAB", "Folga", "Folga", "Folga", "Folga"),
        linha("07/10/2026 QUA", "Falta", "Falta", "Falta", "Falta"),
        linha("12/10/2026 SEG", "Feriado: Nossa Senhora da Aparecida", "Feriado: Nossa Senhora da Aparecida", "Feriado: Nossa Senhora da Aparecida", "Feriado: Nossa Senhora da Aparecida"),
        linha("19/10/2026 SEG", "Justificado Banco", "Justificado Banco", "Justificado Banco", "Justificado Banco", "Banco"),
      ),
    );
    expect(r.dias.map((d) => d.tipo)).toEqual(["FOLGA", "FALTA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS"]);
    expect(r.desconhecidos).toEqual([]);
  });

  test("traduz as justificativas de atestado, férias e licença", () => {
    const j = (nome: string) => linha("08/10/2026 QUI", `Justificado ${nome}`, `Justificado ${nome}`, `Justificado ${nome}`, `Justificado ${nome}`);
    const r = lerCartaoPonto(arquivo(j("Atestado Médico"), j("Férias"), j("Licença Casamento"), j("Abonar ausência no período")));
    expect(r.dias.map((d) => d.tipo)).toEqual(["ATESTADO", "FERIAS", "AFASTAMENTO", "AFASTAMENTO"]);
  });

  test("dia com banco só na segunda metade e batidas na primeira vale pelas batidas", () => {
    const r = lerCartaoPonto(arquivo(linha("18/10/2026 DOM", "11:51 (C)", "17:02 (C)", "Justificado Banco", "Justificado Banco", "Banco")));
    expect(r.dias[0]).toMatchObject({ marcacoes: ["11:51", "17:02"], tipo: null });
  });

  test("rótulo que o ERP não conhece é listado e não vira tipo", () => {
    const r = lerCartaoPonto(arquivo(linha("09/10/2026 SEX", "Compensação especial", "Compensação especial", "Compensação especial", "Compensação especial")));
    expect(r.dias[0].tipo).toBeNull();
    expect(r.desconhecidos).toEqual(["Compensação especial"]);
  });

  test("batida com indicador que não é C nem I não conta", () => {
    const r = lerCartaoPonto(arquivo(linha("05/10/2026 SEG", "08:00 (C)", "12:00 (P)", "13:00 (C)", "17:00 (C)")));
    expect(r.dias[0].marcacoes).toEqual(["08:00", "13:00", "17:00"]);
  });

  test("linha com CPF ou data ilegível é ignorada com aviso", () => {
    const r = lerCartaoPonto(arquivo(linha("31/02/2026 SEG", "08:00 (C)", "12:00 (C)", "", ""), linha("05/10/2026 SEG", "08:00 (C)", "12:00 (C)", "", "")));
    expect(r.dias).toHaveLength(1);
    expect(r.avisos[0]).toContain("ilegível");
  });

  test("arquivo sem as colunas esperadas não devolve dias", () => {
    const r = lerCartaoPonto("Nome;Idade\nA;1");
    expect(r.dias).toEqual([]);
    expect(r.avisos[0]).toContain("Cartão de Ponto");
  });
});

describe("decidirEscala — quem manda é o RHiD, com proteções", () => {
  test("sem marca na Escala: cria", () => {
    expect(decidirEscala("FOLGA", null)).toEqual({ acao: "criar", para: "FOLGA" });
  });

  test("mesma marca: não muda nada", () => {
    expect(decidirEscala("FOLGA_BANCO_HORAS", "FOLGA_BANCO_HORAS")).toEqual({ acao: "igual" });
  });

  test("turno na Escala e folga no RHiD: o RHiD vale (troca)", () => {
    expect(decidirEscala("FOLGA", "TURNO")).toEqual({ acao: "trocar", de: "TURNO", para: "FOLGA" });
    expect(decidirEscala("FOLGA_BANCO_HORAS", "FOLGA")).toMatchObject({ acao: "trocar", para: "FOLGA_BANCO_HORAS" });
  });

  test("férias, atestado e afastamento lançados no ERP não são trocados por folga", () => {
    for (const atual of ["FERIAS", "ATESTADO", "AFASTAMENTO"]) {
      expect(decidirEscala("FOLGA", atual)).toMatchObject({ acao: "manter", atual });
      expect(decidirEscala("FOLGA_BANCO_HORAS", atual)).toMatchObject({ acao: "manter", atual });
    }
  });

  test("atestado ou férias vindo do RHiD substituem turno e folga", () => {
    expect(decidirEscala("ATESTADO", "TURNO")).toMatchObject({ acao: "trocar", para: "ATESTADO" });
    expect(decidirEscala("FERIAS", "FOLGA")).toMatchObject({ acao: "trocar", para: "FERIAS" });
  });

  test("falta só entra onde a Escala dizia turno ou evento; nos outros casos fica para conferir", () => {
    expect(decidirEscala("FALTA", "TURNO")).toMatchObject({ acao: "trocar", para: "FALTA" });
    expect(decidirEscala("FALTA", "EVENTO")).toMatchObject({ acao: "trocar", para: "FALTA" });
    expect(decidirEscala("FALTA", "FOLGA")).toMatchObject({ acao: "manter" });
    expect(decidirEscala("FALTA", "ATESTADO")).toMatchObject({ acao: "manter" });
    expect(decidirEscala("FALTA", null)).toEqual({ acao: "criar", para: "FALTA" });
  });
});

// ─── Serviço: prévia e confirmação (banco de mentira) ───────────────────────────
import { beforeEach as antesDeCada, vi } from "vitest";

vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findMany: vi.fn() },
    pontoDia: { findMany: vi.fn(), upsert: vi.fn() },
    employeeScheduleDay: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    pontoFechamento: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForRange: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { assertPeriodWritableForRange } from "../../cmv-real/cmv-real.service.js";
import { importarCartaoPonto } from "../cartao-ponto.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ana = { id: "e1", cpf: "111.444.777-35", firstName: "Ana", lastName: "Souza", displayName: null, admissionDate: dia("2025-01-10"), terminationDate: null };

const CSV = arquivo(
  linha("03/10/2026 SAB", "Folga", "Folga", "Folga", "Folga"),
  linha("05/10/2026 SEG", "12:12 (C)", "15:27 (C)", "16:21 (C)", "20:40 (I)"),
  linha("07/10/2026 QUA", "Falta", "Falta", "Falta", "Falta"),
  linha("19/10/2026 SEG", "Justificado Banco", "Justificado Banco", "Justificado Banco", "Justificado Banco", "Banco"),
);

antesDeCada(() => {
  vi.clearAllMocks();
  db.employee.findMany.mockResolvedValue([ana]);
  db.pontoDia.findMany.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([
    { id: "m1", employeeId: "e1", date: dia("2026-10-03"), type: "TURNO", notes: null },
    { id: "m2", employeeId: "e1", date: dia("2026-10-07"), type: "TURNO", notes: null },
    { id: "m3", employeeId: "e1", date: dia("2026-10-19"), type: "FERIAS", notes: null },
  ]);
  db.pontoFechamento.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  vi.mocked(assertPeriodWritableForRange).mockResolvedValue(undefined);
});

describe("importarCartaoPonto", () => {
  test("sem confirmar: só a prévia, nada é gravado", async () => {
    const r = await importarCartaoPonto(CSV, "u1", false);
    expect(r.gravado).toBe(false);
    expect(r.pessoas).toBe(1);
    expect(r.batidas).toEqual({ gravar: 1, iguais: 0, conflitos: 0 });
    // folga no lugar do turno e falta no lugar do turno trocam; folga do banco sobre férias fica mantida
    expect(r.escala).toEqual({ criar: 0, trocar: 2, iguais: 0, mantidos: 1 });
    expect(r.mudancas.map((m) => `${m.data} ${m.de}->${m.para}`)).toEqual(["2026-10-03 TURNO->FOLGA", "2026-10-07 TURNO->FALTA"]);
    expect(r.mantidos[0]).toMatchObject({ data: "2026-10-19", de: "FERIAS", para: "FOLGA_BANCO_HORAS" });
    expect(db.pontoDia.upsert).not.toHaveBeenCalled();
    expect(db.employeeScheduleDay.upsert).not.toHaveBeenCalled();
  });

  test("confirmando: grava as batidas e troca só o que a regra manda", async () => {
    const r = await importarCartaoPonto(CSV, "u1", true);
    expect(r.gravado).toBe(true);
    expect(db.pontoDia.upsert).toHaveBeenCalledTimes(1);
    expect(db.pontoDia.upsert.mock.calls[0][0].create).toMatchObject({ employeeId: "e1", origem: "RELOGIO", marcacoes: ["12:12", "15:27", "16:21", "20:40"] });
    const tipos = db.employeeScheduleDay.upsert.mock.calls.map((c: [{ create: { type: string; notes: string } }]) => [c[0].create.type, c[0].create.notes]);
    expect(tipos).toEqual([["FOLGA", "ponto antes:TURNO"], ["FALTA", "ponto antes:TURNO"]]);
    expect(assertPeriodWritableForRange).toHaveBeenCalled();
  });

  test("dia de papel ou ajuste manual não é sobrescrito pelo relógio", async () => {
    db.pontoDia.findMany.mockResolvedValue([{ employeeId: "e1", date: dia("2026-10-05"), origem: "PAPEL", editadoManual: false, marcacoes: ["08:00", "17:00"] }]);
    const r = await importarCartaoPonto(CSV, "u1", true);
    expect(r.batidas).toMatchObject({ gravar: 0, conflitos: 1 });
    expect(db.pontoDia.upsert).not.toHaveBeenCalled();
  });

  test("mês com ponto fechado da pessoa não recebe nada", async () => {
    db.pontoFechamento.findMany.mockResolvedValue([{ employeeId: "e1", year: 2026, month: 10 }]);
    const r = await importarCartaoPonto(CSV, "u1", true);
    expect(r.mesesFechados).toBe(4);
    expect(db.pontoDia.upsert).not.toHaveBeenCalled();
    expect(db.employeeScheduleDay.upsert).not.toHaveBeenCalled();
  });

  test("CPF que não está no cadastro é listado e não importa", async () => {
    db.employee.findMany.mockResolvedValue([]);
    const r = await importarCartaoPonto(CSV, "u1", false);
    expect(r.pessoas).toBe(0);
    expect(r.cpfsSemCadastro).toEqual(["PESSOA EXEMPLO"]);
  });

  test("período financeiro fechado recusa a confirmação (a prévia continua funcionando)", async () => {
    vi.mocked(assertPeriodWritableForRange).mockRejectedValue(new Error("Período fechado."));
    await expect(importarCartaoPonto(CSV, "u1", true)).rejects.toMatchObject({ status: 409 });
    expect(db.pontoDia.upsert).not.toHaveBeenCalled();
    await expect(importarCartaoPonto(CSV, "u1", false)).resolves.toMatchObject({ gravado: false });
  });
});
