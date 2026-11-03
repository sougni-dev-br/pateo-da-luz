import { describe, expect, test } from "vitest";
import { agruparBatidasPorDia, type BatidaAfd } from "../afd-parser.js";
import { fecharBanco } from "../ponto-banco.js";
import { apurarDia, apurarPeriodo, TOLERANCIA_DIA_MIN, type DiaPontoEntrada } from "../ponto-calc.js";

// Testes de propriedade: milhares de entradas geradas ao acaso (semente fixa, reproduzível) e
// invariantes que NENHUM resultado correto pode violar. Servem para o cálculo não depender só dos
// exemplos que alguém pensou em escrever.

function gerador(semente: number) {
  let a = semente >>> 0;
  const proximo = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    inteiro: (min: number, max: number) => min + Math.floor(proximo() * (max - min + 1)),
    escolha: <T,>(lista: readonly T[]): T => lista[Math.floor(proximo() * lista.length)],
    sorte: (p: number) => proximo() < p,
  };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const DATAS = ["2026-10-05", "2026-10-06", "2026-10-04", "2026-10-12", "2026-12-31", "2028-02-29"] as const; // útil, útil, domingo, feriado, virada de ano, bissexto
const PREVISTOS = [0, 240, 360, 420, 480, 540] as const;

function entradaAleatoria(g: ReturnType<typeof gerador>): DiaPontoEntrada {
  const quantas = g.inteiro(0, 6);
  const marcacoes = Array.from({ length: quantas }, () => hhmm(g.inteiro(0, 1439)));
  return {
    data: g.escolha(DATAS),
    marcacoes,
    previstoMin: g.escolha(PREVISTOS),
    feriado: g.sorte(0.2),
    abonado: g.sorte(0.15),
  };
}

// Segunda implementação, minuto a minuto, só para pares simples (entrada < saída, no mesmo dia ou virando a meia-noite).
function minutosNoturnosPorForcaBruta(inicio: number, fim: number): number {
  let n = 0;
  for (let m = inicio; m < fim; m += 1) {
    const doDia = m % 1440;
    if (doDia < 5 * 60 || doDia >= 22 * 60) n += 1;
  }
  return n;
}

describe("apurarDia — invariantes sobre 6.000 dias aleatórios", () => {
  const g = gerador(20261103);
  const casos = Array.from({ length: 6000 }, () => entradaAleatoria(g));

  test("todos os números são inteiros finitos e não negativos", () => {
    for (const c of casos) {
      const r = apurarDia(c);
      for (const v of [r.trabalhadoMin, r.noturnoMin, r.extraMin, r.extraDescansoMin, r.atrasoMin]) {
        expect(Number.isInteger(v) && v >= 0, JSON.stringify({ c, r })).toBe(true);
      }
    }
  });

  test("extra e atraso nunca aparecem juntos no mesmo dia", () => {
    for (const c of casos) {
      const r = apurarDia(c);
      expect(r.extraMin > 0 && r.atrasoMin > 0, JSON.stringify({ c, r })).toBe(false);
      expect(r.extraDescansoMin > 0 && r.atrasoMin > 0, JSON.stringify({ c, r })).toBe(false);
    }
  });

  test("extra, noturno e atraso respeitam os limites do que foi trabalhado e do previsto", () => {
    for (const c of casos) {
      const r = apurarDia(c);
      expect(r.extraMin + r.extraDescansoMin, JSON.stringify({ c, r })).toBeLessThanOrEqual(r.trabalhadoMin);
      expect(r.noturnoMin, JSON.stringify({ c, r })).toBeLessThanOrEqual(r.trabalhadoMin);
      expect(r.atrasoMin, JSON.stringify({ c, r })).toBeLessThanOrEqual(c.previstoMin);
    }
  });

  test("dia pendente nunca lança extra, atraso nem falta, e sempre explica o motivo", () => {
    let pendentes = 0;
    for (const c of casos) {
      const r = apurarDia(c);
      if (!r.pendente) continue;
      pendentes += 1;
      expect([r.extraMin, r.extraDescansoMin, r.atrasoMin, r.falta], JSON.stringify({ c, r })).toEqual([0, 0, 0, false]);
      expect(r.avisos.length, JSON.stringify({ c, r })).toBeGreaterThan(0);
    }
    expect(pendentes).toBeGreaterThan(100); // a geração realmente exercita o caminho
  });

  test("número ímpar de batidas: 1 sozinha é pendente; 3 ou mais ignoram a última e avisam", () => {
    for (const c of casos) {
      const distintas = c.marcacoes.filter((h, i) => i === 0 || h !== c.marcacoes[i - 1]);
      if (distintas.length % 2 === 0) continue;
      const r = apurarDia(c);
      if (distintas.length === 1) expect(r.pendente, JSON.stringify(c)).toBe(true);
      else expect(r.avisos.some((a) => a.includes("última batida foi ignorada")), JSON.stringify(c)).toBe(true);
    }
  });

  test("falta só existe sem nenhuma batida, com jornada prevista e sem abono — e então tudo é zero", () => {
    for (const c of casos) {
      const r = apurarDia(c);
      const devidaFalta = c.previstoMin > 0 && c.marcacoes.length === 0 && !c.abonado;
      expect(r.falta, JSON.stringify({ c, r })).toBe(devidaFalta);
      if (r.falta) expect([r.trabalhadoMin, r.extraMin, r.atrasoMin, r.extraDescansoMin]).toEqual([0, 0, 0, 0]);
    }
  });

  test("dia sem jornada prevista: nada de atraso nem falta, e todo o trabalhado é extra (comum ou de descanso)", () => {
    for (const c of casos.filter((x) => x.previstoMin === 0)) {
      const r = apurarDia(c);
      if (r.pendente) continue; // dia pendente: nada é lançado até corrigir as batidas
      expect([r.atrasoMin, r.falta], JSON.stringify({ c, r })).toEqual([0, false]);
      expect(r.extraMin + r.extraDescansoMin, JSON.stringify({ c, r })).toBe(r.trabalhadoMin);
    }
  });

  test("tolerância da CLT: diferença de até 10 min no dia não gera extra nem atraso; acima, conta a diferença inteira", () => {
    for (const c of casos.filter((x) => x.previstoMin > 0 && x.marcacoes.length > 0)) {
      const r = apurarDia(c);
      if (r.pendente) continue; // dia pendente: nada é lançado até corrigir as batidas
      const diferenca = r.trabalhadoMin - c.previstoMin;
      if (Math.abs(diferenca) <= TOLERANCIA_DIA_MIN) {
        expect([r.extraMin, r.atrasoMin], JSON.stringify({ c, r })).toEqual([0, 0]);
      } else if (diferenca > 0) {
        expect(r.extraMin, JSON.stringify({ c, r })).toBe(diferenca);
      } else if (!c.abonado) {
        expect(r.atrasoMin, JSON.stringify({ c, r })).toBe(-diferenca);
      }
    }
  });

  test("é determinístico e não altera a entrada", () => {
    for (const c of casos.slice(0, 500)) {
      const copia = JSON.parse(JSON.stringify(c));
      const a = apurarDia(c);
      const b = apurarDia(c);
      expect(a).toEqual(b);
      expect(c).toEqual(copia);
    }
  });

  test("apurarPeriodo é exatamente a soma dos dias", () => {
    const dias = casos.slice(0, 400);
    const total = apurarPeriodo(dias);
    const soma = (campo: "trabalhadoMin" | "noturnoMin" | "extraMin" | "extraDescansoMin" | "atrasoMin") => dias.reduce((s, d) => s + apurarDia(d)[campo], 0);
    expect(total.trabalhadoMin).toBe(soma("trabalhadoMin"));
    expect(total.noturnoMin).toBe(soma("noturnoMin"));
    expect(total.extraMin).toBe(soma("extraMin"));
    expect(total.atrasoMin).toBe(soma("atrasoMin"));
    expect(total.faltas).toBe(dias.filter((d) => apurarDia(d).falta).length);
  });
});

describe("apurarDia — contra uma segunda implementação (minuto a minuto)", () => {
  test("horas trabalhadas e adicional noturno de um turno simples batem com a contagem por força bruta", () => {
    const g = gerador(7);
    for (let i = 0; i < 4000; i += 1) {
      const inicio = g.inteiro(0, 1439);
      const duracao = g.inteiro(1, 15 * 60); // abaixo do limite de 16h
      const fim = inicio + duracao; // pode passar da meia-noite
      const r = apurarDia({ data: "2026-10-06", marcacoes: [hhmm(inicio), hhmm(fim)], previstoMin: 0 });
      expect(r.trabalhadoMin, `${hhmm(inicio)}→${hhmm(fim)}`).toBe(duracao);
      expect(r.noturnoMin, `${hhmm(inicio)}→${hhmm(fim)}`).toBe(minutosNoturnosPorForcaBruta(inicio, fim));
    }
  });

  test("dois turnos no mesmo dia (almoço e jantar) somam cada um por força bruta", () => {
    const g = gerador(11);
    for (let i = 0; i < 2000; i += 1) {
      const a = g.inteiro(6 * 60, 12 * 60);
      const b = a + g.inteiro(60, 5 * 60);
      const c = b + g.inteiro(30, 4 * 60);
      const d = c + g.inteiro(60, 6 * 60);
      if (d >= 1440 + 5 * 60) continue;
      const r = apurarDia({ data: "2026-10-06", marcacoes: [hhmm(a), hhmm(b), hhmm(c), hhmm(d)], previstoMin: 0 });
      expect(r.trabalhadoMin).toBe(b - a + (d - c));
      expect(r.noturnoMin).toBe(minutosNoturnosPorForcaBruta(a, b) + minutosNoturnosPorForcaBruta(c, d));
    }
  });

  test("deslocar todas as batidas (sem virar o dia) não muda as horas trabalhadas", () => {
    const g = gerador(13);
    for (let i = 0; i < 2000; i += 1) {
      const a = g.inteiro(0, 600);
      const b = a + g.inteiro(60, 300);
      const c = b + g.inteiro(30, 120);
      const d = c + g.inteiro(60, 300);
      const k = g.inteiro(0, 1439 - d);
      const base = apurarDia({ data: "2026-10-06", marcacoes: [hhmm(a), hhmm(b), hhmm(c), hhmm(d)], previstoMin: 480 });
      const deslocado = apurarDia({ data: "2026-10-06", marcacoes: [hhmm(a + k), hhmm(b + k), hhmm(c + k), hhmm(d + k)], previstoMin: 480 });
      expect(deslocado.trabalhadoMin).toBe(base.trabalhadoMin);
      expect(deslocado.extraMin).toBe(base.extraMin);
      expect(deslocado.atrasoMin).toBe(base.atrasoMin);
    }
  });
});

describe("fecharBanco — o saldo sempre fecha", () => {
  test("identidades do banco de horas em 5.000 combinações", () => {
    const g = gerador(99);
    for (let i = 0; i < 5000; i += 1) {
      const e = { saldoInicialMin: g.inteiro(-600, 600), atrasoMin: g.inteiro(0, 600), debitoFolgaMin: g.escolha([0, 0, 480, 960]), extraMin: g.inteiro(0, 600) };
      const r = fecharBanco(e);
      const bruto = e.saldoInicialMin - e.atrasoMin - e.debitoFolgaMin;
      const dica = JSON.stringify({ e, r });
      expect(r.abatidoMin, dica).toBeGreaterThanOrEqual(0);
      expect(r.abatidoMin, dica).toBeLessThanOrEqual(e.extraMin);
      expect(r.abatidoMin, dica).toBeLessThanOrEqual(Math.max(0, -bruto));
      expect(r.extraAPagarMin + r.abatidoMin, dica).toBe(e.extraMin); // nenhuma hora extra some nem aparece
      expect(r.saldoFinalMin, dica).toBe(bruto + r.abatidoMin);
      expect(r.devendo, dica).toBe(r.saldoFinalMin < 0);
      if (bruto >= 0) expect(r.abatidoMin, dica).toBe(0); // sem dívida, nada a abater
      if (bruto < 0 && e.extraMin > 0) expect(r.abatidoMin === e.extraMin || r.saldoFinalMin === 0, dica).toBe(true); // abate até acabar a dívida ou a extra
    }
  });
});

describe("agruparBatidasPorDia — nenhuma batida se perde nem se repete", () => {
  test("500 arquivos aleatórios: cada batida cai em exatamente um dia, em ordem, com lacunas coerentes", () => {
    const g = gerador(31);
    for (let rodada = 0; rodada < 500; rodada += 1) {
      const batidas: BatidaAfd[] = [];
      let nsr = 1;
      for (const cpf of ["11111111111", "22222222222"]) {
        let momento = Date.UTC(2026, 9, 1, g.inteiro(6, 12), 0);
        for (let i = 0; i < g.inteiro(0, 40); i += 1) {
          momento += g.escolha([5, 30, 60, 240, 600, 700, 900, 1300]) * 60_000;
          const iso = new Date(momento).toISOString();
          batidas.push({ nsr: nsr++, cpf, data: iso.slice(0, 10), hora: iso.slice(11, 16), origem: "040" });
        }
      }
      const embaralhadas = [...batidas].sort(() => g.inteiro(-1, 1));
      const grupos = agruparBatidasPorDia(embaralhadas);
      let total = 0;
      for (const [cpf, dias] of grupos) {
        const esperado = batidas.filter((b) => b.cpf === cpf).sort((a, b) => a.nsr - b.nsr);
        const achatado = dias.flatMap((d) => d.marcacoes);
        total += achatado.length;
        expect(achatado, `rodada ${rodada}`).toEqual(esperado.map((b) => b.hora)); // mesma ordem, nenhuma a mais ou a menos
        expect(dias.map((d) => d.data), `rodada ${rodada}`).toEqual([...dias.map((d) => d.data)].sort()); // dias em ordem
      }
      expect(total).toBe(batidas.length);
    }
  });
});
