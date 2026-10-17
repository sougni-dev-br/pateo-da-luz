import { describe, expect, test } from "vitest";
import type { PeriodoFerias, PessoaFerias } from "../../../../api/client";
import { motivoInicioVedado } from "../regrasFerias";
import {
  type Ausencia, type ContextoSugestao, ZOOMS, pxPorDiaDaEscala, colegasFora, trechosVedados, coberturaPorDia, criarEixo, diaDoX, mesesDoEixo, periodoAlvo, quemEstaFora, retangulo, sugerirInicio, trechosDeCobertura, xDoDia, zonasDaJanela,
} from "../eixoDoTempo";

const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 107, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], ...o,
});
const pessoa = (periodos: PeriodoFerias[]): PessoaFerias => ({ employeeId: "e1", nome: "Ana", empresa: null, setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos });
const HOJE = "2026-10-15";
const FERIADOS = { "2026-11-20": "Consciência Negra", "2026-12-25": "Natal", "2027-01-01": "Confraternização Universal" };
const px = 2.4;

describe("eixo", () => {
  test("começa dois meses antes de hoje e termina no fim de um mês", () => {
    const eixo = criarEixo(HOJE, [pessoa([periodo()])], px);
    expect(eixo.inicio).toBe("2026-08-01");
    expect(eixo.largura).toBe(Math.round(eixo.totalDias * px));
    const meses = mesesDoEixo(eixo);
    expect(meses[0]).toMatchObject({ iso: "2026-08-01", nome: "ago", x: 0 });
    expect(meses[meses.length - 1]?.largura).toBeGreaterThan(0);
    // A soma das larguras dos meses fecha com o eixo (sem frestas entre eles).
    expect(Math.round(meses.reduce((s, m) => s + m.largura, 0))).toBe(eixo.largura);
  });

  test("estende o eixo até o fim do prazo mais distante, mas nunca passa de ~30 meses", () => {
    const longe = periodo({ fimConcessivo: "2031-12-31" });
    const eixo = criarEixo(HOJE, [pessoa([longe])], px);
    expect(eixo.totalDias).toBeLessThanOrEqual(31 * 30);
  });

  test("x e dia andam juntos", () => {
    const eixo = criarEixo(HOJE, [], px);
    const x = xDoDia(eixo, "2026-10-15");
    expect(diaDoX(eixo, x + px / 2)).toBe("2026-10-15");
    expect(diaDoX(eixo, -50)).toBe(eixo.inicio);
    expect(diaDoX(eixo, 99999)).toBe(diaDoX(eixo, eixo.largura - 1));
  });

  test("retângulo corta nas pontas e ignora o que está fora", () => {
    const eixo = criarEixo(HOJE, [], px);
    expect(retangulo(eixo, "2020-01-01", "2020-02-01")).toBeNull();
    const r = retangulo(eixo, "2026-07-01", "2026-08-10");
    expect(r).toMatchObject({ x: 0, cortaEsquerda: true, cortaDireita: false });
    expect(r?.largura).toBeCloseTo(10 * px);
  });
});

describe("zonas da janela de gozo", () => {
  test("seguro, atenção, urgente e estouro, na ordem, sem buracos", () => {
    const zonas = zonasDaJanela(periodo());
    expect(zonas.map((z) => z.tom)).toEqual(["seguro", "atencao", "urgente", "estouro"]);
    expect(zonas[0].inicio).toBe("2026-03-01");
    expect(zonas[zonas.length - 1]).toMatchObject({ inicio: "2027-01-31", fim: "2027-02-28" });
  });

  test("sem dias a programar a janela é uma faixa neutra só", () => {
    expect(zonasDaJanela(periodo({ diasPendentes: 0, situacao: "PROGRAMADA" }))).toEqual([{ tom: "neutro", inicio: "2026-03-01", fim: "2027-02-28" }]);
  });

  test("prazo perto: não cria faixa segura antes do começo da janela", () => {
    const zonas = zonasDaJanela(periodo({ limiteInicioGozo: "2026-04-10", fimConcessivo: "2026-05-09" }));
    expect(zonas[0].tom).not.toBe("seguro");
    expect(zonas.every((z) => z.inicio >= "2026-03-01")).toBe(true);
  });
});

describe("quem está fora", () => {
  const aus = (employeeId: string, nome: string, inicio: string, fim: string, setor: string | null = null): Ausencia => ({ employeeId, nome, setor, inicio, fim, gozada: false });
  const eixo = criarEixo(HOJE, [], px);
  const todas = [aus("a", "Ana", "2026-11-02", "2026-11-04"), aus("b", "Bruno", "2026-11-03", "2026-11-06")];

  test("conta por dia e agrupa dias iguais em trechos", () => {
    const cob = coberturaPorDia(eixo, todas);
    expect(cob[xDoDia(eixo, "2026-11-02") / px]).toBe(1);
    expect(cob[xDoDia(eixo, "2026-11-03") / px]).toBe(2);
    expect(trechosDeCobertura(cob).map((t) => t.quantos)).toEqual([1, 2, 1]);
  });

  test("lista os nomes sem repetir e tira a própria pessoa", () => {
    expect(quemEstaFora(todas, "2026-11-04", "2026-11-10")).toEqual(["Ana", "Bruno"]);
    expect(quemEstaFora(todas, "2026-11-04", "2026-11-10", "a")).toEqual(["Bruno"]);
    expect(quemEstaFora(todas, "2026-12-01", "2026-12-10")).toEqual([]);
  });
});

describe("sugestão de datas", () => {
  const eixo = criarEixo(HOJE, [pessoa([periodo()])], px);
  const bruno: Ausencia = { employeeId: "b", nome: "Bruno", setor: "Cozinha", inicio: "2026-10-16", fim: "2026-12-31", gozada: false };
  const ctx = (extra: Partial<ContextoSugestao> = {}): ContextoSugestao => ({ feriados: FERIADOS, setor: null, dosOutros: [], proprias: [], ...extra });

  test("foge de quem já está fora e escolhe uma segunda-feira que não seja vedada", () => {
    const s = sugerirInicio(eixo, periodo(), HOJE, 10, ctx({ dosOutros: [bruno] }));
    expect(s).toMatchObject({ inicio: "2027-01-04", dias: 10, pico: 0 });
  });

  test("respeita o aviso de 30 dias quando o prazo permite", () => {
    const s = sugerirInicio(eixo, periodo(), HOJE, 30, ctx());
    expect(s?.inicio).toBe("2026-11-16"); // hoje + 30 = 14/11 (sábado): a primeira segunda depois é 16/11
  });

  test("nunca começa em dia vedado", () => {
    const s = sugerirInicio(eixo, periodo(), HOJE, 30, ctx());
    expect(s && motivoInicioVedado(s.inicio, FERIADOS)).toBeNull();
  });

  test("prefere o setor da pessoa livre, mesmo que a casa esteja cheia de outros setores", () => {
    const salao = { ...bruno, employeeId: "c", nome: "Carla", setor: "Salão", inicio: "2026-11-16", fim: "2026-12-06" };
    const cozinheiro = { ...bruno, inicio: "2026-12-07", fim: "2027-02-28" };
    const s = sugerirInicio(eixo, periodo(), HOJE, 10, ctx({ setor: "Cozinha", dosOutros: [salao, cozinheiro] }));
    expect(s?.picoSetor).toBe(0);
    expect(s !== null && s.inicio >= "2026-11-16" && s.inicio <= "2026-11-27").toBe(true);
  });

  test("não bate nas férias da própria pessoa", () => {
    const propria: Ausencia = { employeeId: "e1", nome: "Ana", setor: null, inicio: "2026-11-16", fim: "2026-12-15", gozada: false };
    const s = sugerirInicio(eixo, periodo(), HOJE, 10, ctx({ proprias: [propria] }));
    expect(s !== null && s.inicio > "2026-12-15").toBe(true);
  });

  test("com o prazo curto aceita menos de 30 dias de aviso, procurando o quanto antes", () => {
    const urgente = periodo({ limiteInicioGozo: "2026-10-30", fimConcessivo: "2026-11-28", nivel: "perigo", situacao: "A_VENCER" });
    const s = sugerirInicio(eixo, urgente, HOJE, 30, ctx());
    expect(s?.inicio).toBe("2026-10-19");
  });

  test("com o prazo vencido procura só nos próximos 60 dias", () => {
    const vencida = periodo({ limiteInicioGozo: "2026-09-01", fimConcessivo: "2026-09-30", situacao: "VENCIDA", nivel: "perigo" });
    const s = sugerirInicio(eixo, vencida, HOJE, 30, ctx());
    expect(s?.inicio).toBe("2026-10-19");
  });

  test("não sugere nada sem dias", () => {
    expect(sugerirInicio(eixo, periodo(), HOJE, 0, ctx())).toBeNull();
  });
});

describe("colegas fora e setores", () => {
  const a = (employeeId: string, nome: string, setor: string | null): Ausencia => ({ employeeId, nome, setor, inicio: "2026-11-02", fim: "2026-11-10", gozada: false });
  test("separa o mesmo setor dos outros e tira a própria pessoa", () => {
    const r = colegasFora([a("a", "Ana", "Cozinha"), a("b", "Bruno", "Salão"), a("c", "Caio", "Cozinha")], "2026-11-05", "2026-11-06", "c", "Cozinha");
    expect(r).toEqual({ mesmoSetor: ["Ana"], outros: ["Bruno"] });
  });
});

describe("período alvo", () => {
  test("é o mais antigo que ainda tem o que programar", () => {
    const vencido = periodo({ aquisitivoInicio: "2024-03-01", situacao: "VENCIDA" });
    const atual = periodo();
    expect(periodoAlvo(pessoa([vencido, atual]))?.aquisitivoInicio).toBe("2024-03-01");
    expect(periodoAlvo(pessoa([periodo({ situacao: "EM_AQUISICAO" }), periodo({ diasPendentes: 0, situacao: "PROGRAMADA" })]))).toBeNull();
  });
});

describe("trechos vedados", () => {
  const eixo = criarEixo(HOJE, [], px);
  test("fim de semana (sexta a domingo) e o feriado viram trechos, e o resultado é reaproveitado", () => {
    const trechos = trechosVedados(eixo, FERIADOS, [0]);
    const primeiro = trechos[0];
    // 01/08/2026 é sábado; sexta 31/07 está fora do eixo, então o primeiro trecho é sáb-dom.
    expect(primeiro).toEqual({ de: 0, ate: 1 });
    expect(trechosVedados(eixo, FERIADOS, [0])).toBe(trechos); // mesma lista, sem refazer a conta
    expect(trechosVedados(eixo, FERIADOS, [2])).not.toBe(trechos);
  });
});

describe("escalas da linha do tempo", () => {
  const [ano, semestre, trimestre] = ZOOMS;
  test("cada escala mostra exatamente 12, 6 e 3 meses na largura das pistas", () => {
    const pistas = 900;
    for (const e of [ano, semestre, trimestre]) {
      const px = pxPorDiaDaEscala(e, pistas);
      expect(Math.round(px * 30.44 * e.meses)).toBeGreaterThanOrEqual(pistas - 15);
      expect(px * 30.44 * e.meses).toBeLessThanOrEqual(pistas + 15);
    }
    expect(trimestre.meses).toBe(3);
    expect(pxPorDiaDaEscala(trimestre, pistas)).toBeCloseTo(pxPorDiaDaEscala(ano, pistas) * 4, 0);
  });

  test("em tela muito estreita a escala não encolhe além do mínimo", () => {
    expect(pxPorDiaDaEscala(ano, 100)).toBe(2.4);
  });
});
