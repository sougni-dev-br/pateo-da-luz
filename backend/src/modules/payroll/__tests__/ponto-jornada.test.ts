import { describe, expect, test } from "vitest";
import { entradaDoDia, jornadaDiariaMin, type JornadaCadastro } from "../ponto-jornada.js";
import { apurarDia } from "../ponto-calc.js";

const jornada: JornadaCadastro = { jornadaInicio: "08:00", jornadaFim: "17:00", intervaloInicio: "12:00", intervaloFim: "13:00" };

describe("jornadaDiariaMin", () => {
  test("jornada menos o intervalo", () => {
    expect(jornadaDiariaMin(jornada)).toBe(480);
  });
  test("jornada que vira a meia-noite (sem intervalo cadastrado, turno acima de 6h leva 1h de pausa)", () => {
    expect(jornadaDiariaMin({ jornadaInicio: "18:00", jornadaFim: "02:00", intervaloInicio: null, intervaloFim: null })).toBe(420);
  });
  test("turno 08:00–16:20 sem intervalo cadastrado vale 07:20 (a jornada do restaurante, 6x1)", () => {
    expect(jornadaDiariaMin({ jornadaInicio: "08:00", jornadaFim: "16:20", intervaloInicio: null, intervaloFim: null })).toBe(440);
  });
  test("turno de até 6h não leva intervalo padrão", () => {
    expect(jornadaDiariaMin({ jornadaInicio: "18:00", jornadaFim: "23:00", intervaloInicio: null, intervaloFim: null })).toBe(300);
    expect(jornadaDiariaMin({ jornadaInicio: "08:00", jornadaFim: "14:00", intervaloInicio: null, intervaloFim: null })).toBe(360);
  });
  test("sem horário cadastrado devolve null", () => {
    expect(jornadaDiariaMin({ jornadaInicio: null, jornadaFim: null, intervaloInicio: null, intervaloFim: null })).toBeNull();
    expect(jornadaDiariaMin({ ...jornada, jornadaFim: "abc" })).toBeNull();
  });
});

describe("entradaDoDia — o que a escala diz sobre o dia", () => {
  const dia = (tipo: Parameters<typeof entradaDoDia>[0]["tipoEscala"], marcacoes: string[] = [], extra = {}) =>
    entradaDoDia({ data: "2026-10-06", marcacoes, jornada, tipoEscala: tipo, ...extra });

  test("TURNO e EVENTO usam a jornada do cadastro", () => {
    expect(dia("TURNO").entrada?.previstoMin).toBe(480);
    expect(dia("EVENTO").entrada?.previstoMin).toBe(480);
  });

  test.each(["FOLGA", "FOLGA_FERIADO", "FERIAS", "AFASTAMENTO"] as const)("%s não tem jornada prevista", (tipo) => {
    const r = dia(tipo, ["10:00", "14:00"]);
    expect(r.entrada?.previstoMin).toBe(0);
    expect(r.entrada?.abonado).toBeUndefined();
  });

  test("ATESTADO abona o dia", () => {
    const r = dia("ATESTADO");
    expect(r.entrada?.abonado).toBe(true);
    expect(apurarDia(r.entrada!).falta).toBe(false);
  });

  test("FALTA lançada na escala sem batida é falta", () => {
    expect(apurarDia(dia("FALTA").entrada!).falta).toBe(true);
  });

  test("folga contra o banco de horas debita a jornada do dia do banco", () => {
    const r = dia("FOLGA_BANCO_HORAS");
    expect(r.entrada?.previstoMin).toBe(0);
    expect(r.debitoBancoMin).toBe(480);
  });

  test("dia sem lançamento na escala e sem batida não vira falta, só avisa", () => {
    const r = dia(null);
    expect(apurarDia(r.entrada!).falta).toBe(false);
    expect(r.avisos).toContain("Dia sem lançamento na escala.");
  });

  test("dia sem lançamento na escala mas com batida é apurado pela jornada", () => {
    const r = dia(null, ["08:00", "12:00", "13:00", "18:00"]);
    expect(apurarDia(r.entrada!).extraMin).toBe(60);
  });

  test("sem jornada cadastrada não dá para apurar", () => {
    const r = entradaDoDia({
      data: "2026-10-06",
      marcacoes: ["08:00", "17:00"],
      jornada: { jornadaInicio: null, jornadaFim: null, intervaloInicio: null, intervaloFim: null },
      tipoEscala: "TURNO",
    });
    expect(r.entrada).toBeNull();
    expect(r.avisos).toContain("Jornada não cadastrada.");
  });

  test("feriado trabalhado passa adiante", () => {
    expect(dia("FOLGA", ["10:00", "14:00"], { feriado: true }).entrada?.feriado).toBe(true);
  });
});

import { decidirFolgaBanco } from "../ponto-jornada.js";

describe("decidirFolgaBanco — folga tirada contra o banco de horas", () => {
  test.each([null, "TURNO", "EVENTO"] as const)("marca em dia %s sem batidas e guarda o tipo de antes", (tipoAtual) => {
    expect(decidirFolgaBanco({ ativo: true, tipoAtual, temBatidas: false })).toEqual({ acao: "marcar", antes: tipoAtual });
  });

  test("já é folga do banco: não faz nada", () => {
    expect(decidirFolgaBanco({ ativo: true, tipoAtual: "FOLGA_BANCO_HORAS", temBatidas: false })).toEqual({ acao: "nada" });
  });

  test("dia com batidas é recusado", () => {
    const r = decidirFolgaBanco({ ativo: true, tipoAtual: "TURNO", temBatidas: true });
    expect(r).toMatchObject({ acao: "recusar" });
  });

  test.each(["FOLGA", "FOLGA_FERIADO", "FERIAS", "ATESTADO", "AFASTAMENTO", "FALTA"] as const)("dia de %s é recusado", (tipoAtual) => {
    expect(decidirFolgaBanco({ ativo: true, tipoAtual, temBatidas: false })).toMatchObject({ acao: "recusar" });
  });

  test("desmarcar só vale para folga do banco", () => {
    expect(decidirFolgaBanco({ ativo: false, tipoAtual: "FOLGA_BANCO_HORAS", temBatidas: false })).toEqual({ acao: "desmarcar" });
    expect(decidirFolgaBanco({ ativo: false, tipoAtual: "TURNO", temBatidas: false })).toEqual({ acao: "nada" });
    expect(decidirFolgaBanco({ ativo: false, tipoAtual: null, temBatidas: false })).toEqual({ acao: "nada" });
  });
});

import { jornadaDaPessoa, rotuloTurno } from "../ponto-jornada.js";

describe("entradaDoDia — mês montado na Escala (sem marca = dia trabalhado)", () => {
  test("com o mês montado, dia sem marca e sem batida é falta (como a gorjeta e a folha leem)", () => {
    const r = entradaDoDia({ data: "2026-10-06", marcacoes: [], jornada, tipoEscala: null, mesMontado: true });
    expect(r.entrada?.previstoMin).toBe(480);
    expect(r.entrada?.abonado).toBeUndefined();
    expect(r.avisos).toEqual([]);
    expect(apurarDia(r.entrada!).falta).toBe(true);
  });

  test("com o mês montado, dia sem marca e com batida é apurado pela jornada", () => {
    const r = entradaDoDia({ data: "2026-10-06", marcacoes: ["08:00", "12:00", "13:00", "18:00"], jornada, tipoEscala: null, mesMontado: true });
    expect(apurarDia(r.entrada!).extraMin).toBe(60);
  });
});

describe("jornadaDaPessoa — o turno real da Escala manda; o contrato é reserva", () => {
  const contrato = { jornadaInicio: "09:00", jornadaFim: "18:00", intervaloInicio: "12:00", intervaloFim: "13:00" };

  test("usa shiftStart/shiftEnd da Escala quando existem e mantém o intervalo do contrato", () => {
    const r = jornadaDaPessoa({ shiftStart: "08:00", shiftEnd: "17:00", ...contrato });
    expect(r.fonte).toBe("escala");
    expect(r.jornada).toMatchObject({ jornadaInicio: "08:00", jornadaFim: "17:00", intervaloInicio: "12:00", intervaloFim: "13:00" });
    expect(jornadaDiariaMin(r.jornada)).toBe(480);
  });

  test("sem turno na Escala, cai para a jornada do contrato", () => {
    const r = jornadaDaPessoa({ shiftStart: null, shiftEnd: null, ...contrato });
    expect(r.fonte).toBe("contrato");
    expect(r.jornada.jornadaInicio).toBe("09:00");
  });

  test("turno da Escala incompleto ou ilegível não vale", () => {
    expect(jornadaDaPessoa({ shiftStart: "08:00", shiftEnd: null, ...contrato }).fonte).toBe("contrato");
    expect(jornadaDaPessoa({ shiftStart: "oito", shiftEnd: "17:00", ...contrato }).fonte).toBe("contrato");
  });

  test("rotuloTurno mostra início e fim", () => {
    expect(rotuloTurno({ jornadaInicio: "08:00", jornadaFim: "17:00", intervaloInicio: null, intervaloFim: null })).toBe("08:00–17:00");
    expect(rotuloTurno({ jornadaInicio: null, jornadaFim: null, intervaloInicio: null, intervaloFim: null })).toBeNull();
  });
});

describe("jornadaDiariaMin — o intervalo do contrato não entra: turno acima de 6h leva 1h de pausa, como no RHiD", () => {
  const ij = (a: string, b: string, i1: string | null, i2: string | null) => ({ jornadaInicio: a, jornadaFim: b, intervaloInicio: i1, intervaloFim: i2 });

  test("turno das 18h às 23h não perde o intervalo do meio-dia", () => {
    expect(jornadaDiariaMin(ij("18:00", "23:00", "12:00", "13:00"))).toBe(300);
  });
  test("turno da manhã (08–12) com intervalo das 12h às 13h não perde nada", () => {
    expect(jornadaDiariaMin(ij("08:00", "12:00", "12:00", "13:00"))).toBe(240);
  });
  test("turno que vira a meia-noite desconta o intervalo só se ele cair no turno", () => {
    expect(jornadaDiariaMin(ij("22:00", "06:00", "02:00", "03:00"))).toBe(420);
    expect(jornadaDiariaMin(ij("22:00", "06:00", "12:00", "13:00"))).toBe(420);
  });
  test("intervalo parcialmente dentro do turno também vale só a pausa padrão", () => {
    expect(jornadaDiariaMin(ij("08:00", "12:30", "12:00", "13:00"))).toBe(270); // turno de 4h30: sem pausa
  });
  test("intervalo do contrato fora do turno (contrato 15:00–00:00, turno 08:00–16:20) cai na pausa padrão de 1h", () => {
    expect(jornadaDiariaMin(ij("08:00", "16:20", "19:00", "20:00"))).toBe(440);
  });
  test("intervalo de duração zero não desconta nada", () => {
    // intervalo de duração zero = não cadastrado: vale a pausa padrão de 1h (turno de 9h → 8h)
    expect(jornadaDiariaMin(ij("08:00", "17:00", "12:00", "12:00"))).toBe(480);
  });
  test("entrada igual à saída é jornada inválida (não 24h)", () => {
    expect(jornadaDiariaMin(ij("08:00", "08:00", null, null))).toBeNull();
  });
});

describe("entradaDoDia — batida que contradiz a escala não é apurada em silêncio", () => {
  const dia = (tipoEscala: Parameters<typeof entradaDoDia>[0]["tipoEscala"], marcacoes: string[]) =>
    entradaDoDia({ data: "2026-10-06", marcacoes, jornada, tipoEscala, mesMontado: true });
  const batidas = ["08:00", "12:00", "13:00", "17:00"];

  test.each(["FOLGA_BANCO_HORAS", "FERIAS", "AFASTAMENTO"] as const)("%s com batida: sem apuração, sem débito do banco e com aviso", (tipo) => {
    const r = dia(tipo, batidas);
    expect(r.entrada?.semApuracao).toBe(true);
    expect(r.debitoBancoMin).toBe(0);
    expect(r.avisos[0]).toContain("batida");
    const apurado = apurarDia(r.entrada!);
    expect([apurado.extraMin, apurado.extraDescansoMin, apurado.atrasoMin, apurado.pendente]).toEqual([0, 0, 0, true]);
  });

  test("FALTA na escala com batida: sem apuração e com aviso", () => {
    const r = dia("FALTA", batidas);
    expect(r.entrada?.semApuracao).toBe(true);
    expect(r.avisos[0]).toContain("falta");
  });

  test("FOLGA comum com batida continua sendo trabalho em dia de folga (extra)", () => {
    const r = dia("FOLGA", ["10:00", "14:00"]);
    expect(r.entrada?.semApuracao).toBeUndefined();
    expect(apurarDia(r.entrada!).extraMin).toBe(240);
  });

  test("folga do banco SEM batida continua debitando a jornada", () => {
    expect(dia("FOLGA_BANCO_HORAS", []).debitoBancoMin).toBe(480);
  });
});
