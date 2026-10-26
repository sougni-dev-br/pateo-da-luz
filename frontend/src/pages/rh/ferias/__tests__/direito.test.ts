import { describe, expect, test } from "vitest";
import type { PeriodoFerias, PessoaFerias } from "../../../../api/client";
import { ciclosCompletos, contarPorSituacao, decidirHoje, quemTemDireito } from "../direito";

const HOJE = "2026-10-26";
const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 96, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], solicitacao: null, ...o,
});
const pessoa = (nome: string, admissao: string | null, periodos: PeriodoFerias[]): PessoaFerias =>
  ({ employeeId: nome, nome, empresa: null, setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao, nivel: "ok", periodos });

describe("ciclos completos", () => {
  test("conta os ciclos de 12 meses cujo último dia já passou", () => {
    expect(ciclosCompletos("2026-10-01", HOJE)).toBe(0);
    expect(ciclosCompletos("2025-10-01", HOJE)).toBe(1); // 01/10/2025 a 30/09/2026
    expect(ciclosCompletos("2025-10-27", HOJE)).toBe(0); // o ciclo termina em 26/10/2026: hoje ainda é o último dia
    expect(ciclosCompletos("2007-03-01", HOJE)).toBe(19);
    expect(ciclosCompletos(null, HOJE)).toBe(0);
  });

  test("admissão em 29/02 termina o ciclo em 28/02", () => {
    expect(ciclosCompletos("2024-02-29", "2025-03-01")).toBe(1);
    expect(ciclosCompletos("2024-02-29", "2025-02-28")).toBe(0);
  });
});

describe("quem tem direito", () => {
  const completa = pessoa("Ana", "2025-03-01", [periodo(), periodo({ aquisitivoInicio: "2026-03-01", situacao: "EM_AQUISICAO", diasPendentes: 0, diasParaCompletar: 125 })]);
  const perto = pessoa("Bia", "2025-02-01", [periodo({ aquisitivoInicio: "2025-02-01", situacao: "A_VENCER", nivel: "atencao", diasParaLimite: 60, limiteInicioGozo: "2026-12-26" })]);
  const vencida = pessoa("Caio", "2024-01-01", [periodo({ aquisitivoInicio: "2024-01-01", situacao: "VENCIDA", nivel: "perigo", diasParaLimite: -10, limiteInicioGozo: "2026-10-16" })]);
  const semDireito = pessoa("Duda", "2026-06-01", [periodo({ situacao: "EM_AQUISICAO", diasPendentes: 0, diasParaCompletar: 200 })]);
  const programada = pessoa("Edu", "2025-03-01", [periodo({ situacao: "PROGRAMADA", diasPendentes: 0 })]);

  test("só entra quem tem ciclo completo com dias a gozar, do limite mais curto ao mais longo", () => {
    const linhas = quemTemDireito([completa, semDireito, vencida, programada, perto], HOJE);
    expect(linhas.map((l) => l.pessoa.nome)).toEqual(["Caio", "Bia", "Ana"]);
    expect(linhas.map((l) => l.situacao)).toEqual(["vencido", "perto", "tempo"]);
    expect(contarPorSituacao(linhas)).toEqual({ vencido: 1, perto: 1, tempo: 1 });
  });

  test("traz os ciclos completos desde a admissão e os dias a gozar", () => {
    const [linha] = quemTemDireito([completa], HOJE);
    expect(linha).toMatchObject({ ciclosCompletos: 1, diasPendentes: 30, limite: "2027-01-30", completoEm: "2026-02-28" });
  });

  test("com dois ciclos pendentes, o prazo é o do mais antigo e os dias somam", () => {
    const dois = pessoa("Fabi", "2024-03-01", [
      periodo({ aquisitivoInicio: "2024-03-01", aquisitivoFim: "2025-02-28", limiteInicioGozo: "2026-01-30", situacao: "VENCIDA", nivel: "perigo", diasParaLimite: -269 }),
      periodo({ aquisitivoInicio: "2025-03-01" }),
    ]);
    const [linha] = quemTemDireito([dois], HOJE);
    expect(linha).toMatchObject({ aGozar: expect.any(Array), diasPendentes: 60, limite: "2026-01-30", situacao: "vencido", ciclosCompletos: 2 });
    expect(linha.aGozar).toHaveLength(2);
  });

  test("decidir hoje: atraso (vencido ou programado depois do prazo) separado de quem ainda pode programar", () => {
    const dois = pessoa("Fabi", "2024-03-01", [
      periodo({ aquisitivoInicio: "2024-03-01", aquisitivoFim: "2025-02-28", limiteInicioGozo: "2026-01-30", situacao: "VENCIDA", nivel: "perigo", diasParaLimite: -269 }),
      periodo({ aquisitivoInicio: "2025-03-01" }),
    ]);
    const foraDoPrazo = pessoa("Gil", "2025-03-01", [periodo({ situacao: "PROGRAMADA", diasPendentes: 0, foraDoPrazo: true })]);
    const { atraso, podeProgramar } = decidirHoje([completa, dois, foraDoPrazo, semDireito], HOJE);
    expect(atraso.map((i) => i.pessoa.nome)).toEqual(["Fabi", "Gil"]);
    expect(atraso[0]).toMatchObject({ destaque: "venceu há 269 dias", tom: "vencido", prazo: "o prazo era 30/01/2026" });
    expect(atraso[1]).toMatchObject({ destaque: "programada fora do prazo", tom: "vencido" });
    expect(podeProgramar.map((i) => i.pessoa.nome)).toEqual(["Ana", "Fabi"]); // Fabi: o ciclo seguinte ainda tem tempo
    expect(podeProgramar[0]).toMatchObject({ destaque: "faltam 96 dias", tom: "calmo", prazo: "começar até 30/01/2027", detalhe: "ciclo completo em 28/02/2026 · 30 dias a gozar" });
  });
});
