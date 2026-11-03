import { describe, expect, test } from "vitest";
import { MAX_AVISOS, agruparBatidasPorDia, lerAfd671 } from "../afd-parser.js";

// Monta uma linha de marcação (tipo 7) da Portaria 671 com dados fictícios.
const linha7 = (nsr: number, cpf: string, quando: string, flag = "0") =>
  `${String(nsr).padStart(9, "0")}7${quando}-0300${cpf.padStart(12, "0")}${quando}-0300` + `04${flag}` + "a".repeat(64);

const CPF_A = "11144477735";
const CPF_B = "52998224725";

describe("lerAfd671", () => {
  test("lê só os registros de marcação (tipo 7) e ignora cabeçalho, rodapé e assinatura", () => {
    const texto = [
      "0000000001" + "1".padEnd(40, "0"),
      linha7(1, CPF_A, "2026-10-01T08:00:00"),
      "999999999" + "9".padEnd(20, "0"),
      "ASSINATURA_DIGITAL_EM_ARQUIVO_P7S",
      linha7(2, CPF_B, "2026-10-01T09:30:00"),
    ].join("\r\n");
    const r = lerAfd671(texto);
    expect(r.batidas).toHaveLength(2);
    expect(r.batidas[0]).toMatchObject({ nsr: 1, cpf: CPF_A, data: "2026-10-01", hora: "08:00" });
    expect(r.batidas[1].cpf).toBe(CPF_B);
  });

  test("CPF vem com zero à esquerda (12 dígitos) e sai com 11", () => {
    const r = lerAfd671(linha7(1, CPF_A, "2026-10-01T08:00:00"));
    expect(r.batidas[0].cpf).toHaveLength(11);
  });

  test("linha de marcação com tamanho errado vira aviso, não derruba a leitura", () => {
    const texto = [linha7(1, CPF_A, "2026-10-01T08:00:00"), "000000002" + "7" + "lixo"].join("\n");
    const r = lerAfd671(texto);
    expect(r.batidas).toHaveLength(1);
    expect(r.avisos).toHaveLength(1);
  });

  test("guarda o indicador final da origem para conferência", () => {
    const r = lerAfd671(linha7(1, CPF_A, "2026-10-01T08:00:00", "1"));
    expect(r.batidas[0].origem).toBe("041");
  });
});

describe("lerAfd671 — dados ruins", () => {
  test("data inexistente vira aviso e não entra", () => {
    const r = lerAfd671(linha7(1, CPF_A, "2026-13-45T08:00:00"));
    expect(r.batidas).toHaveLength(0);
    expect(r.avisos).toHaveLength(1);
  });

  test("hora inexistente vira aviso e não entra", () => {
    const r = lerAfd671(linha7(1, CPF_A, "2026-10-05T99:99:00"));
    expect(r.batidas).toHaveLength(0);
    expect(r.avisos).toHaveLength(1);
  });

  test("dia 31 de um mês de 30 dias é recusado", () => {
    expect(lerAfd671(linha7(1, CPF_A, "2026-11-31T08:00:00")).batidas).toHaveLength(0);
  });

  test("linha repetida (mesmo CPF e NSR) conta uma vez", () => {
    const linha = linha7(1, CPF_A, "2026-10-05T08:00:00");
    expect(lerAfd671([linha, linha].join("\n")).batidas).toHaveLength(1);
  });

  test("a lista de avisos tem teto e diz quantos foram omitidos", () => {
    const ruins = Array.from({ length: 50 }, (_, i) => linha7(i + 1, CPF_A, "2026-13-45T08:00:00")).join("\n");
    const r = lerAfd671(ruins);
    expect(r.avisos).toHaveLength(MAX_AVISOS + 1);
    expect(r.avisos[MAX_AVISOS]).toContain("30");
  });
});

describe("agruparBatidasPorDia", () => {
  const batidas = (cpf: string, momentos: string[]) =>
    lerAfd671(momentos.map((m, i) => linha7(i + 1, cpf, m)).join("\n")).batidas;

  test("agrupa as quatro batidas do dia por pessoa", () => {
    const g = agruparBatidasPorDia(
      batidas(CPF_A, ["2026-10-05T08:00:00", "2026-10-05T12:00:00", "2026-10-05T13:00:00", "2026-10-05T17:00:00"]),
    );
    expect(g.get(CPF_A)).toEqual([{ data: "2026-10-05", marcacoes: ["08:00", "12:00", "13:00", "17:00"] }]);
  });

  test("turno que vira a meia-noite fica no dia em que começou", () => {
    const g = agruparBatidasPorDia(batidas(CPF_A, ["2026-10-05T20:00:00", "2026-10-06T02:00:00"]));
    expect(g.get(CPF_A)).toEqual([{ data: "2026-10-05", marcacoes: ["20:00", "02:00"] }]);
  });

  test("turno partido (almoço e jantar) continua sendo um dia só", () => {
    const g = agruparBatidasPorDia(
      batidas(CPF_A, ["2026-10-05T11:00:00", "2026-10-05T15:00:00", "2026-10-05T18:00:00", "2026-10-05T23:00:00"]),
    );
    expect(g.get(CPF_A)).toHaveLength(1);
  });

  test("dois dias seguidos viram dois grupos e as pessoas ficam separadas", () => {
    const g = agruparBatidasPorDia([
      ...batidas(CPF_A, ["2026-10-05T08:00:00", "2026-10-05T17:00:00", "2026-10-06T08:00:00", "2026-10-06T17:00:00"]),
      ...batidas(CPF_B, ["2026-10-05T09:00:00", "2026-10-05T18:00:00"]),
    ]);
    expect(g.get(CPF_A)).toHaveLength(2);
    expect(g.get(CPF_B)).toHaveLength(1);
  });

  test("ordena por data e hora mesmo com o arquivo embaralhado", () => {
    const g = agruparBatidasPorDia(batidas(CPF_A, ["2026-10-05T17:00:00", "2026-10-05T08:00:00"]));
    expect(g.get(CPF_A)?.[0].marcacoes).toEqual(["08:00", "17:00"]);
  });
});

describe("agruparBatidasPorDia — pareamento entrada e saída (achados da auditoria)", () => {
  const lote = (cpf: string, momentos: string[]) => lerAfd671(momentos.map((m, i) => linha7(i + 1, cpf, m)).join("\n")).batidas;

  test("turno de 12h só com entrada e saída (lacuna maior que 11h) NÃO é partido em dois dias", () => {
    const g = agruparBatidasPorDia(lote(CPF_A, ["2026-11-03T14:00:00", "2026-11-04T02:00:00"]));
    expect(g.get(CPF_A)).toEqual([{ data: "2026-11-03", marcacoes: ["14:00", "02:00"] }]);
  });

  test("jornada de exatamente 11h com duas batidas não gera duas entradas com a mesma data", () => {
    const g = agruparBatidasPorDia(lote(CPF_A, ["2026-11-03T08:00:00", "2026-11-03T19:00:00"]));
    expect(g.get(CPF_A)).toEqual([{ data: "2026-11-03", marcacoes: ["08:00", "19:00"] }]);
  });

  test("fechar de madrugada e abrir no dia seguinte com menos de 11h de descanso NÃO junta os dois dias", () => {
    const g = agruparBatidasPorDia(lote(CPF_A, ["2026-11-03T16:00:00", "2026-11-04T02:00:00", "2026-11-04T12:30:00", "2026-11-04T21:00:00"]));
    expect(g.get(CPF_A)).toEqual([
      { data: "2026-11-03", marcacoes: ["16:00", "02:00"] },
      { data: "2026-11-04", marcacoes: ["12:30", "21:00"] },
    ]);
  });

  test("entrada sem saída fica sozinha no dia dela e não rouba a batida do dia seguinte", () => {
    const g = agruparBatidasPorDia(lote(CPF_A, ["2026-11-03T08:00:00", "2026-11-04T08:00:00", "2026-11-04T17:00:00"]));
    expect(g.get(CPF_A)).toEqual([
      { data: "2026-11-03", marcacoes: ["08:00"] },
      { data: "2026-11-04", marcacoes: ["08:00", "17:00"] },
    ]);
  });

  test("toque duplo no mesmo minuto vale uma batida", () => {
    const g = agruparBatidasPorDia(lote(CPF_A, ["2026-11-03T08:00:00", "2026-11-03T08:00:00", "2026-11-03T12:00:00", "2026-11-03T13:00:00", "2026-11-03T17:00:00"]));
    expect(g.get(CPF_A)).toEqual([{ data: "2026-11-03", marcacoes: ["08:00", "12:00", "13:00", "17:00"] }]);
  });
});

describe("lerAfd671 — fuso", () => {
  const linhaComFuso = (quando: string, fuso: string) =>
    "000000001" + "7" + `${quando}${fuso}` + CPF_A.padStart(12, "0") + `${quando}${fuso}` + "040" + "a".repeat(64);

  test("marcação em UTC é convertida para o horário local (-0300)", () => {
    const r = lerAfd671(linhaComFuso("2026-11-03T23:00:00", "+0000"));
    expect(r.batidas[0]).toMatchObject({ data: "2026-11-03", hora: "20:00" });
  });

  test("conversão que muda o dia (00:30 UTC = 21:30 do dia anterior)", () => {
    const r = lerAfd671(linhaComFuso("2026-11-04T00:30:00", "+0000"));
    expect(r.batidas[0]).toMatchObject({ data: "2026-11-03", hora: "21:30" });
  });

  test("fuso -0300 não muda nada", () => {
    const r = lerAfd671(linhaComFuso("2026-11-03T08:00:00", "-0300"));
    expect(r.batidas[0]).toMatchObject({ data: "2026-11-03", hora: "08:00" });
  });
});
