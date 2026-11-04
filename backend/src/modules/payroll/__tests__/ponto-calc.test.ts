import { describe, expect, test } from "vitest";
import { apurarDia, apurarPeriodo, TOLERANCIA_DIA_MIN } from "../ponto-calc.js";

// 2026-10-05 é segunda; 2026-10-04 é domingo.
const dia = (data: string, marcacoes: string[], previstoMin = 8 * 60, extra: object = {}) => ({ data, marcacoes, previstoMin, ...extra });

describe("apurarDia — jornada normal", () => {
  test("jornada cumprida: sem extra, atraso nem falta", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "12:00", "13:00", "17:00"]));
    expect(r.trabalhadoMin).toBe(480);
    expect(r.extraMin).toBe(0);
    expect(r.atrasoMin).toBe(0);
    expect(r.falta).toBe(false);
    expect(r.avisos).toEqual([]);
  });

  test("passou da jornada além da tolerância vira extra", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "12:00", "13:00", "18:00"]));
    expect(r.extraMin).toBe(60);
    expect(r.atrasoMin).toBe(0);
  });

  test("tolerância da CLT: até 10 min no dia não conta nem como extra nem como atraso", () => {
    expect(TOLERANCIA_DIA_MIN).toBe(10);
    expect(apurarDia(dia("2026-10-05", ["08:00", "12:00", "13:00", "17:10"])).extraMin).toBe(0);
    expect(apurarDia(dia("2026-10-05", ["08:05", "12:00", "13:00", "17:00"])).atrasoMin).toBe(0);
  });

  test("11 min de diferença já conta inteiro (não só o excedente)", () => {
    expect(apurarDia(dia("2026-10-05", ["08:00", "12:00", "13:00", "17:11"])).extraMin).toBe(11);
    expect(apurarDia(dia("2026-10-05", ["08:11", "12:00", "13:00", "17:00"])).atrasoMin).toBe(11);
  });

  test("atraso vai para o banco de horas, não vira falta", () => {
    const r = apurarDia(dia("2026-10-05", ["09:00", "12:00", "13:00", "17:00"]));
    expect(r.atrasoMin).toBe(60);
    expect(r.falta).toBe(false);
  });
});

describe("apurarDia — falta e abono", () => {
  test("dia previsto sem nenhuma marcação é falta", () => {
    const r = apurarDia(dia("2026-10-05", []));
    expect(r.falta).toBe(true);
    expect(r.atrasoMin).toBe(0);
  });

  test("dia abonado (atestado) não conta falta nem atraso", () => {
    const r = apurarDia(dia("2026-10-05", [], 480, { abonado: true }));
    expect(r.falta).toBe(false);
    expect(r.atrasoMin).toBe(0);
  });

  test("folga sem marcação não é falta", () => {
    expect(apurarDia(dia("2026-10-04", [], 0)).falta).toBe(false);
  });
});

describe("apurarDia — folga, domingo e feriado", () => {
  test("trabalho em dia sem jornada prevista é todo extra", () => {
    const r = apurarDia(dia("2026-10-06", ["10:00", "14:00"], 0));
    expect(r.extraMin).toBe(240);
    expect(r.extraDescansoMin).toBe(0);
  });

  test("domingo trabalhado conta como dia comum (extra comum)", () => {
    const r = apurarDia(dia("2026-10-04", ["10:00", "14:00"], 0));
    expect(r.extraMin).toBe(240);
    expect(r.extraDescansoMin).toBe(0);
  });

  test("feriado trabalhado não é extra a pagar: o dia todo vira crédito no banco (folga compensatória)", () => {
    const r = apurarDia(dia("2026-10-12", ["10:00", "14:00"], 0, { feriado: true }));
    expect([r.extraMin, r.extraDescansoMin, r.creditoFeriadoMin, r.atrasoMin]).toEqual([0, 0, 240, 0]);
  });

  test("feriado com jornada prevista: trabalhar menos não gera atraso e trabalhar mais não gera extra; tudo é crédito", () => {
    const curto = apurarDia(dia("2026-10-12", ["12:00", "16:00"], 440, { feriado: true }));
    expect([curto.atrasoMin, curto.extraMin, curto.creditoFeriadoMin, curto.falta]).toEqual([0, 0, 240, false]);
    const longo = apurarDia(dia("2026-10-12", ["08:00", "12:00", "13:00", "19:46"], 440, { feriado: true }));
    expect([longo.extraMin, longo.creditoFeriadoMin]).toEqual([0, 646]);
  });

  test("domingo trabalhado segue como dia comum (extra comum)", () => {
    const r = apurarDia(dia("2026-10-11", ["10:00", "14:00"], 0));
    expect([r.extraMin, r.creditoFeriadoMin]).toEqual([240, 0]);
  });
});

describe("apurarDia — adicional noturno (22h às 5h)", () => {
  test("conta só os minutos dentro da janela noturna", () => {
    const r = apurarDia(dia("2026-10-05", ["18:00", "23:30"], 330));
    expect(r.noturnoMin).toBe(90);
  });

  test("turno que vira a meia-noite soma antes e depois", () => {
    const r = apurarDia(dia("2026-10-05", ["20:00", "02:00"], 360));
    expect(r.trabalhadoMin).toBe(360);
    expect(r.noturnoMin).toBe(240);
  });

  test("madrugada até as 5h conta, depois das 5h não", () => {
    const r = apurarDia(dia("2026-10-05", ["04:00", "08:00"], 240));
    expect(r.noturnoMin).toBe(60);
  });
});

describe("apurarDia — avisos de conferência", () => {
  test("marcação ímpar sinaliza e só soma pares completos", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "12:00", "13:00"]));
    expect(r.trabalhadoMin).toBe(240);
    expect(r.avisos.some((a) => a.startsWith("Marcação ímpar: a última batida foi ignorada"))).toBe(true);
  });

  test("intervalo menor que 1h em jornada acima de 6h", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "12:00", "12:30", "17:00"]));
    expect(r.avisos).toContain("Intervalo menor que 1h em jornada acima de 6h.");
  });

  test("mais de 2h extras no dia", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "12:00", "13:00", "20:30"]));
    expect(r.extraMin).toBe(210);
    expect(r.avisos).toContain("Mais de 2h extras no dia.");
  });

  test("horário ilegível sinaliza e ignora a marcação", () => {
    const r = apurarDia(dia("2026-10-05", ["8h", "12:00"]));
    expect(r.avisos.some((a) => a.startsWith("Horário inválido"))).toBe(true);
  });
});

describe("apurarPeriodo", () => {
  test("soma o período e separa o que paga, o que desconta e o que vai ao banco", () => {
    const r = apurarPeriodo([
      dia("2026-10-05", ["08:00", "12:00", "13:00", "18:00"]), // +60 extra
      dia("2026-10-06", ["09:00", "12:00", "13:00", "17:00"]), // 60 atraso
      dia("2026-10-07", []), // falta
      dia("2026-10-08", ["20:00", "02:00"], 360), // 240 noturno
    ]);
    expect(r.extraMin).toBe(60);
    expect(r.atrasoMin).toBe(60);
    expect(r.faltas).toBe(1);
    expect(r.noturnoMin).toBe(240);
    expect(r.dias).toHaveLength(4);
  });

  test("batida repetida no mesmo minuto não vira turno de 24h", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "08:00", "12:00", "13:00", "17:00"]));
    expect(r.trabalhadoMin).toBe(480);
    expect(r.avisos).toContain("Batida repetida no mesmo minuto.");
  });

  test("turno de mais de 16h é ignorado e avisado", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "07:00"], 480));
    expect(r.trabalhadoMin).toBe(0);
    expect(r.avisos).toContain("Turno de mais de 16h: confira as batidas.");
  });

  test("dia com só duas batidas avisa que o intervalo não foi descontado", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "17:00"]));
    expect(r.avisos).toContain("Só duas batidas em jornada longa: o intervalo não foi descontado.");
  });

  test("turno que vira a meia-noite em quatro batidas não gera aviso de intervalo falso", () => {
    const r = apurarDia(dia("2026-10-05", ["19:00", "23:00", "00:00", "04:00"], 480));
    expect(r.trabalhadoMin).toBe(480);
    expect(r.noturnoMin).toBe(300);
    expect(r.avisos.some((a) => a.startsWith("Intervalo menor"))).toBe(false);
  });

  test("mais de 12h no dia avisa que pode faltar batida", () => {
    const r = apurarDia(dia("2026-10-05", ["17:00", "01:00", "10:00", "18:00"], 480));
    expect(r.avisos).toContain("Mais de 12h trabalhadas no dia: confira se falta uma batida.");
  });

});

describe("apurarDia — dia pendente não lança dívida nem crédito", () => {
  test("uma batida só: nada de atraso (batida faltando não prova que não trabalhou)", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00"]));
    expect([r.atrasoMin, r.extraMin, r.extraDescansoMin, r.falta, r.pendente]).toEqual([0, 0, 0, false, true]);
    expect(r.avisos).toContain("Marcação ímpar: falta uma batida.");
  });

  test("três batidas: como o RHiD, vale o par completo e a sobra é ignorada (atraso do que falta)", () => {
    // caso real do RHiD: 08:14, 14:50 e 19:22 → 6h36 trabalhadas, −44 min contra 440 previstos
    const r = apurarDia(dia("2026-10-29", ["08:14", "14:50", "19:22"], 440));
    expect([r.trabalhadoMin, r.atrasoMin, r.extraMin, r.pendente]).toEqual([396, 44, 0, false]);
  });

  test("turno acima de 16h (16h01) é pendente, não vira 480 min de atraso", () => {
    const r = apurarDia(dia("2026-10-05", ["06:00", "22:01"]));
    expect([r.trabalhadoMin, r.atrasoMin, r.pendente]).toEqual([0, 0, true]);
  });

  test("dia sem jornada prevista com batida ímpar: vale o par completo como extra", () => {
    const r = apurarDia(dia("2026-10-06", ["10:00", "14:00", "15:00"], 0));
    expect([r.extraMin, r.extraDescansoMin, r.pendente]).toEqual([240, 0, false]);
  });

  test("batidas fora de ordem (segundo turno começa antes do primeiro acabar) são pendentes", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "12:00", "11:00", "17:00"]));
    expect(r.pendente).toBe(true);
    expect(r.avisos).toContain("Batidas fora de ordem: confira os horários.");
    expect([r.extraMin, r.atrasoMin]).toEqual([0, 0]);
  });

  test("turno que atravessa a meia-noite e recomeça logo depois NÃO é fora de ordem", () => {
    const r = apurarDia(dia("2026-10-05", ["22:00", "02:00", "03:00", "05:00"], 360));
    expect(r.pendente).toBe(false);
    expect(r.trabalhadoMin).toBe(360);
  });

  test("horário ilegível torna o dia pendente", () => {
    expect(apurarDia(dia("2026-10-05", ["8h", "12:00"])).pendente).toBe(true);
  });

  test("semApuracao (batida contradiz a escala) zera extra e atraso mas mantém o trabalhado", () => {
    const r = apurarDia({ ...dia("2026-10-05", ["08:00", "12:00", "13:00", "19:00"]), semApuracao: true });
    expect([r.trabalhadoMin, r.extraMin, r.atrasoMin, r.pendente]).toEqual([600, 0, 0, true]);
  });

  test("dia completo continua sendo apurado normalmente e não é pendente", () => {
    const r = apurarDia(dia("2026-10-05", ["08:00", "12:00", "13:00", "17:00"]));
    expect(r.pendente).toBe(false);
  });

  test("apurarPeriodo conta os dias pendentes", () => {
    const r = apurarPeriodo([dia("2026-10-05", ["08:00"]), dia("2026-10-06", ["08:00", "12:00", "13:00", "17:00"]), dia("2026-10-07", ["08:00", "12:00", "13:00"])]);
    expect(r.diasPendentes).toBe(1); // só a batida isolada; o dia de 3 batidas segue o RHiD
    expect(r.atrasoMin).toBe(240); // só o dia de 3 batidas (4h de 8h previstas); a batida isolada não lança nada
  });
});
