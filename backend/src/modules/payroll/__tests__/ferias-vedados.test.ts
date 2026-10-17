import { describe, expect, test } from "vitest";
import { feriadosEntre, motivoInicioVedado, repousoDaPessoa } from "../ferias-vedados.js";

const feriados = feriadosEntre("2026-01-01", "2027-12-31");

describe("dias em que as férias não podem começar", () => {
  test("o próprio feriado", () => {
    expect(motivoInicioVedado("2026-11-20", feriados)).toMatch(/Consciência Negra é feriado/);
  });

  test("domingo, e sexta e sábado (dois dias antes do repouso)", () => {
    expect(motivoInicioVedado("2026-11-08", feriados)).toMatch(/domingo é o dia de repouso/);
    expect(motivoInicioVedado("2026-12-12", feriados)).toMatch(/sábado está a 1 dia do repouso/);
    expect(motivoInicioVedado("2026-12-11", feriados)).toMatch(/sexta-feira está a 2 dias do repouso/);
  });

  test("os dois dias antes de um feriado em dia de semana", () => {
    // Quarta 2026-09-07 (Independência): segunda 05/09... 2026-09-07 é segunda; sábado e domingo já vedados.
    expect(motivoInicioVedado("2026-10-10", feriados)).not.toBeNull(); // sábado
    // Feriado numa quinta (25/12/2025 não está no intervalo): usa 12/10/2026 (segunda): dia antes é domingo.
    expect(motivoInicioVedado("2026-12-23", feriados)).toMatch(/2 dias para o feriado Natal/);
    expect(motivoInicioVedado("2026-12-24", feriados)).toMatch(/1 dia para o feriado Natal/);
  });

  test("dia comum pode", () => {
    expect(motivoInicioVedado("2026-11-16", feriados)).toBeNull(); // segunda
    expect(motivoInicioVedado("2026-11-17", feriados)).toBeNull();
  });

  test("feriados móveis entram (Carnaval, Sexta-feira Santa, Corpus Christi)", () => {
    expect(Object.values(feriados)).toEqual(expect.arrayContaining(["Carnaval", "Sexta-feira Santa", "Corpus Christi"]));
  });
});

describe("repouso semanal pela escala", () => {
  // Terças-feiras de folga nas últimas semanas (2026-09-01 e +7 dias...).
  const tercas = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"];

  test("o dia em que a pessoa mais folga vira o repouso", () => {
    expect(repousoDaPessoa(tercas, false)).toEqual({ repousos: [2], inferido: true });
  });

  test("poucas folgas ou nenhum padrão: volta ao domingo e diz que não leu da escala", () => {
    expect(repousoDaPessoa(tercas.slice(0, 2), false)).toEqual({ repousos: [0], inferido: false });
    expect(repousoDaPessoa([], false)).toEqual({ repousos: [0], inferido: false });
    const misturado = [...tercas, "2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"]; // terça e quarta empatadas
    expect(repousoDaPessoa(misturado, false).inferido).toBe(false);
  });

  test("no 5x2 vale o par de dias mais frequentes", () => {
    const sabados = ["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03"];
    const domingos = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"];
    expect(repousoDaPessoa([...sabados, ...domingos], true)).toEqual({ repousos: [0, 6], inferido: true });
  });

  test("com repouso na terça: a própria terça e segunda/domingo anteriores à terça são vedados, e o domingo comum passa", () => {
    expect(motivoInicioVedado("2026-12-08", feriados, [2])).toMatch(/terça-feira é o dia de repouso/);
    expect(motivoInicioVedado("2026-12-07", feriados, [2])).toMatch(/segunda-feira está a 1 dia do repouso semanal \(terça-feira\)/);
    expect(motivoInicioVedado("2026-12-06", feriados, [2])).toMatch(/domingo está a 2 dias do repouso semanal \(terça-feira\)/);
    expect(motivoInicioVedado("2026-12-11", feriados, [2])).toBeNull(); // sexta livre
  });
});
