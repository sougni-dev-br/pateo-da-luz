import { describe, expect, test } from "vitest";
import {
  CAMPOS_HISTORICO, CAMPOS_SALARIO, ROTULO_CAMPO, alteracoes, cadastroVigenteEm, diaDeReferencia, faltaMotivoEntradaGorjeta, faltaMotivoRetroativo, lerVigenteDesde,
  serializar, valorVigenteEm, type LinhaHistorico,
} from "../cadastro-historico.js";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
// Registrada no instante `em` (padrão: o próprio dia da vigência, meio-dia).
function linha(campo: string, de: string | null, para: string | null, vigente: string, em?: string): LinhaHistorico {
  return { campo, valorAnterior: de, valorNovo: para, vigenteDesde: d(vigente), createdAt: new Date(`${em ?? vigente}T12:00:00.000Z`) };
}

describe("valor vigente numa data", () => {
  const aumentos = [linha("baseSalary", "2000.00", "2200.00", "2026-07-01"), linha("baseSalary", "2200.00", "2500.00", "2026-09-01")];

  test("sem linhas: o valor atual do cadastro", () => {
    expect(valorVigenteEm([], "2500.00", d("2020-01-01"))).toBe("2500.00");
  });
  test("depois da última mudança: o valor novo dela", () => {
    expect(valorVigenteEm(aumentos, "2500.00", d("2026-09-30"))).toBe("2500.00");
  });
  test("entre duas mudanças: o valor da primeira", () => {
    expect(valorVigenteEm(aumentos, "2500.00", d("2026-08-31"))).toBe("2200.00");
  });
  test("no próprio dia da vigência já vale o novo", () => {
    expect(valorVigenteEm(aumentos, "2500.00", d("2026-09-01"))).toBe("2500.00");
  });
  test("antes de todas: o valor de antes da primeira mudança (sem backfill completo)", () => {
    expect(valorVigenteEm(aumentos, "2500.00", d("2026-06-15"))).toBe("2000.00");
  });
  test("só uma linha, posterior à data: o valor anterior dela", () => {
    expect(valorVigenteEm([linha("baseSalary", "1800.00", "2200.00", "2026-10-01")], "2200.00", d("2026-09-30"))).toBe("1800.00");
  });
  test("aumento retroativo lançado depois vale sobre a mudança registrada antes dele", () => {
    const linhas = [
      linha("baseSalary", "2000.00", "2200.00", "2026-09-01", "2026-09-01"),
      linha("baseSalary", "2200.00", "2500.00", "2026-08-01", "2026-10-05"), // retroativo a agosto
    ];
    expect(valorVigenteEm(linhas, "2500.00", d("2026-09-15"))).toBe("2500.00");
    expect(valorVigenteEm(linhas, "2500.00", d("2026-08-15"))).toBe("2500.00");
    expect(valorVigenteEm(linhas, "2500.00", d("2026-07-15"))).toBe("2000.00");
  });
  test("mudança para vazio devolve vazio", () => {
    expect(valorVigenteEm([linha("salarioCombinado", "5200.00", null, "2026-09-01")], null, d("2026-09-10"))).toBeNull();
  });
});

describe("cadastro vigente", () => {
  test("troca só os campos com histórico, no tipo do cadastro", () => {
    const atual = { id: "e1", baseSalary: 2500, modality: "CLT", recebeAdiantamento: true, companyId: "c2" };
    const linhas = [
      linha("baseSalary", "2200.00", "2500.00", "2026-10-01"),
      linha("modality", "NAO_CLT", "CLT", "2026-10-01"),
      linha("recebeAdiantamento", "false", "true", "2026-10-01"),
    ];
    expect(cadastroVigenteEm(atual, linhas, d("2026-09-30")))
      .toEqual({ id: "e1", baseSalary: 2200, modality: "NAO_CLT", recebeAdiantamento: false, companyId: "c2" });
  });
});

describe("o que mudou", () => {
  test("uma alteração por campo rastreado que mudou; Decimal e número comparam igual", () => {
    const antes = { baseSalary: "2200", modality: "CLT", position: "Garçom", companyId: null, cpf: "12345678909" };
    const depois = { baseSalary: 2200, modality: "NAO_CLT", position: "Líder", cpf: "98765432100" };
    expect(alteracoes(antes, depois)).toEqual([
      { campo: "modality", valorAnterior: "CLT", valorNovo: "NAO_CLT" },
      { campo: "position", valorAnterior: "Garçom", valorNovo: "Líder" },
    ]);
  });
  test("campo ausente no que vai ser gravado não conta como mudança", () => {
    expect(alteracoes({ salarioCombinado: 5200 }, { firstName: "Ana" })).toEqual([]);
  });
  test("serializa dinheiro com 2 casas e booleano em texto", () => {
    expect(serializar("baseSalary", 2200)).toBe("2200.00");
    expect(serializar("recebeAdiantamento", false)).toBe("false");
    expect(serializar("position", "  ")).toBeNull();
  });
});

describe("vale a partir de", () => {
  const hoje = "2026-09-30";
  test("padrão hoje (São Paulo)", () => {
    expect(lerVigenteDesde(undefined, hoje, d("2025-01-01"))).toEqual({ data: d(hoje) });
    expect(lerVigenteDesde("", hoje, null)).toEqual({ data: d(hoje) });
  });
  test("admissão futura: padrão é a admissão", () => {
    expect(lerVigenteDesde(undefined, hoje, d("2026-10-05"))).toEqual({ data: d("2026-10-05") });
  });
  test("aceita data passada (aumento retroativo)", () => {
    expect(lerVigenteDesde("2026-08-01", hoje, d("2025-01-01"))).toEqual({ data: d("2026-08-01") });
  });
  test("recusa antes da admissão, mais de um ano à frente e data inválida", () => {
    expect(lerVigenteDesde("2024-12-31", hoje, d("2025-01-01"))).toHaveProperty("erro");
    expect(lerVigenteDesde("2027-10-02", hoje, null)).toHaveProperty("erro");
    expect(lerVigenteDesde("2026-02-30", hoje, null)).toHaveProperty("erro");
    expect(lerVigenteDesde("30/09/2026", hoje, null)).toHaveProperty("erro");
  });
});

describe("dia de referência do salário do mês", () => {
  test("último dia do mês civil", () => {
    expect(diaDeReferencia(2026, 9, null)).toEqual(d("2026-09-30"));
    expect(diaDeReferencia(2026, 2, null)).toEqual(d("2026-02-28"));
  });
  test("saiu antes do fim do mês: o dia da saída", () => {
    expect(diaDeReferencia(2026, 9, d("2026-09-12"))).toEqual(d("2026-09-12"));
    expect(diaDeReferencia(2026, 9, d("2026-08-28"))).toEqual(d("2026-08-28"));
  });
  test("saiu depois do mês: o fim do mês", () => {
    expect(diaDeReferencia(2026, 9, d("2026-10-03"))).toEqual(d("2026-09-30"));
  });
});

describe("teto do IR para a gorjeta informada", () => {
  test("é rastreado como dinheiro, com rótulo, e sensível como salário", () => {
    expect(CAMPOS_HISTORICO).toContain("tetoIrGorjeta");
    expect(ROTULO_CAMPO.tetoIrGorjeta).toBe("Teto do IR para a gorjeta informada");
    expect(CAMPOS_SALARIO.has("tetoIrGorjeta")).toBe(true);
    expect(serializar("tetoIrGorjeta", "5000")).toBe("5000.00");
    expect(alteracoes({ tetoIrGorjeta: null }, { tetoIrGorjeta: 5000 })).toEqual([{ campo: "tetoIrGorjeta", valorAnterior: null, valorNovo: "5000.00" }]);
  });
  test("vigente no mês pelo histórico (posto em outubro: setembro sem teto)", () => {
    const linhas = [linha("tetoIrGorjeta", null, "5000.00", "2026-10-01")];
    expect(cadastroVigenteEm({ tetoIrGorjeta: 5000 }, linhas, d("2026-09-30")).tetoIrGorjeta).toBeNull();
    expect(cadastroVigenteEm({ tetoIrGorjeta: 5000 }, linhas, d("2026-10-31")).tetoIrGorjeta).toBe(5000);
  });
  test("pôr ou tirar valendo desde um mês passado exige motivo", () => {
    expect(faltaMotivoRetroativo(["tetoIrGorjeta"], d("2026-08-01"), "2026-10-01", null)).toMatch(/informe o motivo/);
    expect(faltaMotivoRetroativo(["tetoIrGorjeta"], d("2026-08-01"), "2026-10-01", "Teto combinado com a contabilidade")).toBeNull();
    expect(faltaMotivoRetroativo(["tetoIrGorjeta"], d("2026-10-01"), "2026-10-01", null)).toBeNull();
  });
});

describe("entrada na gorjeta no histórico", () => {
  test("é rastreada, com rótulo próprio, e grava o dia (AAAA-MM-DD)", () => {
    expect(CAMPOS_HISTORICO).toContain("inicioGorjeta");
    expect(ROTULO_CAMPO.inicioGorjeta).toBe("Entrada na gorjeta");
    expect(serializar("inicioGorjeta", d("2026-09-10"))).toBe("2026-09-10");
    expect(serializar("inicioGorjeta", "2026-09-10T00:00:00.000Z")).toBe("2026-09-10");
    expect(serializar("inicioGorjeta", null)).toBeNull();
  });

  test("mudança da data vira uma linha; a mesma data não", () => {
    expect(alteracoes({ inicioGorjeta: null }, { inicioGorjeta: d("2026-09-10") })).toEqual([
      { campo: "inicioGorjeta", valorAnterior: null, valorNovo: "2026-09-10" },
    ]);
    expect(alteracoes({ inicioGorjeta: d("2026-09-10") }, { inicioGorjeta: new Date("2026-09-10T00:00:00Z") })).toEqual([]);
  });

  const HOJE = "2026-10-01";
  const entrada = (de: string | null, para: string | null) => ({ campo: "inicioGorjeta" as const, valorAnterior: de, valorNovo: para });
  test("entrada num mês passado (ou tirar uma de mês passado) exige motivo", () => {
    expect(faltaMotivoEntradaGorjeta(entrada(null, "2026-09-10"), HOJE, null))
      .toBe("Entrada na gorjeta em 09/2026 muda a gorjeta de meses passados: informe o motivo.");
    expect(faltaMotivoEntradaGorjeta(entrada("2026-08-01", null), HOJE, "")).toMatch(/08\/2026/);
    expect(faltaMotivoEntradaGorjeta(entrada(null, "2026-09-10"), HOJE, "Efetivada após o teste")).toBeNull();
  });

  test("entrada no mês atual ou futuro não exige motivo; sem mudança, nada", () => {
    expect(faltaMotivoEntradaGorjeta(entrada(null, "2026-10-05"), HOJE, null)).toBeNull();
    expect(faltaMotivoEntradaGorjeta(entrada("2026-10-20", "2026-11-01"), HOJE, null)).toBeNull();
    expect(faltaMotivoEntradaGorjeta(undefined, HOJE, null)).toBeNull();
  });
});
