import { describe, expect, test } from "vitest";
import {
  cicloDaData, derivarCiclos, duracaoEmDias, fechouForaDoMes,
  type ResumoDeCiclo,
} from "../stock-cycle.service.js";

function resumo(ano: number, mes: number, ultimaContagem: string): ResumoDeCiclo {
  const [y, m, d] = ultimaContagem.split("-").map(Number);
  return { competenceYear: ano, competenceMonth: mes, ultimaContagem: new Date(y, m - 1, d) };
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// O historico real do Pateo, como esta no banco em 16/09/2026. Maio e agosto
// fecharam fora do proprio mes — 01/06 e 02/09 — porque o ultimo dia estava
// ocupado. Nao e excecao, e como o restaurante opera.
const HISTORICO: ResumoDeCiclo[] = [
  resumo(2026, 4, "2026-04-30"),
  resumo(2026, 5, "2026-06-01"),
  resumo(2026, 6, "2026-06-29"),
  resumo(2026, 7, "2026-07-31"),
  resumo(2026, 8, "2026-09-02"),
  resumo(2026, 9, "2026-09-16"),
];

describe("derivarCiclos — encadeamento", () => {
  test("cada ciclo comeca no dia seguinte ao fim do anterior", () => {
    const ciclos = derivarCiclos(HISTORICO);
    for (let i = 1; i < ciclos.length; i++) {
      const fimAnterior = ciclos[i - 1].endDate;
      const inicio = ciclos[i].startDate;
      expect(Math.round((inicio.getTime() - fimAnterior.getTime()) / 86_400_000)).toBe(1);
    }
  });

  test("nao ha buraco nem sobreposicao entre ciclos consecutivos", () => {
    // E isto que permite somar compras por ciclo sem contar duas vezes nem
    // perder um dia na virada.
    const ciclos = derivarCiclos(HISTORICO);
    for (let i = 1; i < ciclos.length; i++) {
      expect(ciclos[i].startDate > ciclos[i - 1].endDate).toBe(true);
    }
  });

  test("o primeiro da serie comeca no primeiro dia do proprio mes", () => {
    const ciclos = derivarCiclos(HISTORICO);
    expect(iso(ciclos[0].startDate)).toBe("2026-04-01");
  });

  test("o historico real do Pateo, ciclo a ciclo", () => {
    const ciclos = derivarCiclos(HISTORICO);
    expect(ciclos.map((c) => `${c.competenceMonth}/${c.competenceYear}: ${iso(c.startDate)} a ${iso(c.endDate)}`)).toEqual([
      "4/2026: 2026-04-01 a 2026-04-30",
      "5/2026: 2026-05-01 a 2026-06-01",
      "6/2026: 2026-06-02 a 2026-06-29",
      "7/2026: 2026-06-30 a 2026-07-31",
      "8/2026: 2026-08-01 a 2026-09-02",
      "9/2026: 2026-09-03 a 2026-09-16",
    ]);
  });

  test("a ordem de entrada nao importa", () => {
    const embaralhado = [HISTORICO[3], HISTORICO[0], HISTORICO[5], HISTORICO[1], HISTORICO[4], HISTORICO[2]];
    expect(derivarCiclos(embaralhado)).toEqual(derivarCiclos(HISTORICO));
  });

  test("lista vazia devolve lista vazia", () => {
    expect(derivarCiclos([])).toEqual([]);
  });

  test("virada de ano encadeia sem mes zero", () => {
    const ciclos = derivarCiclos([resumo(2026, 12, "2027-01-02"), resumo(2027, 1, "2027-02-01")]);
    expect(iso(ciclos[0].endDate)).toBe("2027-01-02");
    expect(iso(ciclos[1].startDate)).toBe("2027-01-03");
  });

  test("historico bagunçado nao gera intervalo negativo", () => {
    // Se a ultima contagem for anterior ao inicio herdado, o ciclo vira de um
    // dia so — em vez de endDate < startDate, que quebraria qualquer soma.
    const ciclos = derivarCiclos([resumo(2026, 7, "2026-07-31"), resumo(2026, 8, "2026-07-20")]);
    expect(ciclos[1].startDate <= ciclos[1].endDate).toBe(true);
    expect(iso(ciclos[1].startDate)).toBe("2026-08-01");
    expect(iso(ciclos[1].endDate)).toBe("2026-08-01");
  });
});

describe("fechouForaDoMes", () => {
  test("marca maio e agosto, que fecharam na virada", () => {
    const ciclos = derivarCiclos(HISTORICO);
    const fora = ciclos.filter(fechouForaDoMes).map((c) => `${c.competenceMonth}/${c.competenceYear}`);
    expect(fora).toEqual(["5/2026", "8/2026"]);
  });

  test("nao marca os que fecharam dentro do mes", () => {
    const ciclos = derivarCiclos(HISTORICO);
    const julho = ciclos.find((c) => c.competenceMonth === 7)!;
    expect(fechouForaDoMes(julho)).toBe(false);
  });
});

describe("duracaoEmDias", () => {
  test("conta as duas pontas", () => {
    const ciclos = derivarCiclos(HISTORICO);
    const abril = ciclos.find((c) => c.competenceMonth === 4)!;
    expect(duracaoEmDias(abril)).toBe(30);
  });

  test("agosto durou 33 dias, porque fechou em 02/09", () => {
    const ciclos = derivarCiclos(HISTORICO);
    const agosto = ciclos.find((c) => c.competenceMonth === 8)!;
    expect(duracaoEmDias(agosto)).toBe(33);
  });

  test("a soma das duracoes cobre o intervalo inteiro, sem sobra", () => {
    const ciclos = derivarCiclos(HISTORICO);
    const soma = ciclos.reduce((s, c) => s + duracaoEmDias(c), 0);
    const inteiro = Math.round(
      (ciclos[ciclos.length - 1].endDate.getTime() - ciclos[0].startDate.getTime()) / 86_400_000
    ) + 1;
    expect(soma).toBe(inteiro);
  });
});

describe("cicloDaData", () => {
  test("uma compra de 01/09 pertence ao ciclo de agosto, nao ao de setembro", () => {
    // O ponto inteiro da visao por ciclo: o que entrou no dia 01/09, antes da
    // contagem de fechamento, ainda e estoque de agosto.
    const ciclos = derivarCiclos(HISTORICO);
    const c = cicloDaData(ciclos, new Date(2026, 8, 1));
    expect(c?.competenceMonth).toBe(8);
  });

  test("03/09, ja depois do fechamento, pertence a setembro", () => {
    const ciclos = derivarCiclos(HISTORICO);
    expect(cicloDaData(ciclos, new Date(2026, 8, 3))?.competenceMonth).toBe(9);
  });

  test("os limites pertencem ao ciclo", () => {
    const ciclos = derivarCiclos(HISTORICO);
    expect(cicloDaData(ciclos, new Date(2026, 7, 1))?.competenceMonth).toBe(8);
    expect(cicloDaData(ciclos, new Date(2026, 8, 2))?.competenceMonth).toBe(8);
  });

  test("data fora de todos os ciclos devolve null", () => {
    const ciclos = derivarCiclos(HISTORICO);
    expect(cicloDaData(ciclos, new Date(2025, 0, 1))).toBeNull();
    expect(cicloDaData(ciclos, new Date(2027, 0, 1))).toBeNull();
  });
});
