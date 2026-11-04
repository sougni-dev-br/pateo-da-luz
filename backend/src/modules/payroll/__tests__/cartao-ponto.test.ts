import { describe, expect, test } from "vitest";
import { TRABALHOU, divergeDaEscala } from "../cartao-ponto.service.js";
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
    expect(r.dias.map((d) => d.tipo)).toEqual(["FOLGA", "FALTA", "FOLGA", "FOLGA_BANCO_HORAS"]);
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

describe("divergeDaEscala — a Escala manda, o RHiD só aponta diferença", () => {
  test("mesma marca nos dois lados: não diverge", () => {
    expect(divergeDaEscala("FOLGA", "FOLGA")).toBe(false);
    expect(divergeDaEscala("FOLGA_BANCO_HORAS", "FOLGA_BANCO_HORAS")).toBe(false);
    expect(divergeDaEscala("FALTA", "FALTA")).toBe(false);
  });

  test("RHiD diz folga, falta ou justificativa e a Escala diz turno ou nada: diverge", () => {
    expect(divergeDaEscala("FOLGA", "TURNO")).toBe(true);
    expect(divergeDaEscala("FOLGA", null)).toBe(true);
    expect(divergeDaEscala("FALTA", "TURNO")).toBe(true);
    expect(divergeDaEscala("ATESTADO", "FOLGA")).toBe(true);
  });

  test("tipos de folga diferentes divergem (muda o que sai do banco)", () => {
    expect(divergeDaEscala("FOLGA", "FOLGA_BANCO_HORAS")).toBe(true);
    expect(divergeDaEscala("FOLGA_BANCO_HORAS", "FOLGA")).toBe(true);
    expect(divergeDaEscala("FOLGA", "FOLGA_FERIADO")).toBe(true);
  });

  test("batida no RHiD diverge quando a Escala diz folga, falta, atestado, férias ou afastamento", () => {
    for (const atual of ["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS", "FALTA", "ATESTADO", "FERIAS", "AFASTAMENTO"]) {
      expect(divergeDaEscala(TRABALHOU, atual)).toBe(true);
    }
  });

  test("batida no RHiD não diverge quando a Escala diz turno, evento ou nada", () => {
    for (const atual of ["TURNO", "EVENTO", null]) expect(divergeDaEscala(TRABALHOU, atual)).toBe(false);
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
    // folga, falta e folga do banco divergem da Escala (turno, turno e férias); o dia com batida cai em Escala sem marca
    expect(r.escala).toEqual({ iguais: 1, divergentes: 3 });
    expect(r.divergencias.map((d) => `${d.data} ${d.escala}->${d.rhid}`)).toEqual([
      "2026-10-03 TURNO->FOLGA",
      "2026-10-07 TURNO->FALTA",
      "2026-10-19 FERIAS->FOLGA_BANCO_HORAS",
    ]);
    expect(db.pontoDia.upsert).not.toHaveBeenCalled();
    expect(db.employeeScheduleDay.upsert).not.toHaveBeenCalled();
  });

  test("confirmando: grava só as batidas; a Escala nunca é alterada", async () => {
    const r = await importarCartaoPonto(CSV, "u1", true);
    expect(r.gravado).toBe(true);
    expect(r.escala.divergentes).toBe(3);
    expect(db.pontoDia.upsert).toHaveBeenCalledTimes(1);
    expect(db.pontoDia.upsert.mock.calls[0][0].create).toMatchObject({ employeeId: "e1", origem: "RELOGIO", marcacoes: ["12:12", "15:27", "16:21", "20:40"] });
    expect(db.employeeScheduleDay.upsert).not.toHaveBeenCalled();
    expect(db.employeeScheduleDay.update).not.toHaveBeenCalled();
    expect(assertPeriodWritableForRange).toHaveBeenCalled();
  });

  test("batida do RHiD em dia de folga da Escala aparece como divergência", async () => {
    db.employeeScheduleDay.findMany.mockResolvedValue([{ id: "m5", employeeId: "e1", date: dia("2026-10-05"), type: "FOLGA", notes: null }]);
    const r = await importarCartaoPonto(arquivo(linha("05/10/2026 SEG", "12:12 (C)", "15:27 (C)", "16:21 (C)", "20:40 (I)")), "u1", false);
    expect(r.divergencias).toEqual([{ nome: "Ana Souza", data: "2026-10-05", escala: "FOLGA", rhid: "TRABALHOU" }]);
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
