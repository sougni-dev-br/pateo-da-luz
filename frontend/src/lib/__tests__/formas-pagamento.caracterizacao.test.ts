// Caracterização do refactor de 2026-09-15, quando Purchases.tsx deixou de ter
// cópia própria destas regras e passou a importar daqui.
//
// As funções abaixo são as de Purchases.tsx *antes* da troca, congeladas. Elas
// existem só para confrontar com as da lib: a tela tem 3.000 linhas e nenhum
// teste, então esta era a única forma de provar que o comportamento não mudou.
// Não as edite — se uma regra mudar de propósito, o confronto tem que quebrar.
//
// As duas divergências conhecidas e aceitas estão marcadas nos testes:
// o teto de 60 parcelas e a data vazia (que a tela resolve com um adaptador).
import { describe, expect, test } from "vitest";
import {
  dividirValor, formaPermiteParcelamento, nomeBaseDaForma,
  normalizar, parcelasNoNomeDaForma, somarDias,
} from "../formas-pagamento";

// ---------- implementações antigas, verbatim de Purchases.tsx ----------
function normalize(value?: string | null) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}
function parseLegacyInstallmentCount(name?: string | null) {
  const match = normalize(name).match(/^(.*?)(?:\s+|\/|-)?(\d{1,2})\s*x$/);
  if (!match) return null;
  const count = Number(match[2]);
  return count > 0 ? count : null;
}
function basePaymentMethodName(name?: string | null) {
  const raw = String(name ?? "").trim();
  const normalized = normalize(raw);
  const match = normalized.match(/^(.*?)(?:\s+|\/|-)?(\d{1,2})\s*x$/);
  const base = match ? normalize(match[1]) : normalized;
  if (base.includes("boleto")) return "BOLETO";
  if (base.includes("faturado") || base.includes("prazo")) return "FATURADO";
  if (base.includes("cartao") && base.includes("credito")) return "CARTÃO CRÉDITO";
  if (base.includes("cartao") && base.includes("debito")) return "CARTÃO DÉBITO";
  if (base.includes("pix")) return "PIX";
  if (base.includes("dinheiro") || base.includes("caixa")) return "DINHEIRO";
  return raw || "";
}
type PM = { id?: string; name?: string | null; group?: string | null; type?: string | null };
function allowsInstallments(method?: PM | null) {
  const baseName = normalize(basePaymentMethodName(method?.name));
  if (["boleto", "faturado", "cartao credito"].includes(baseName)) return true;
  if (normalize(method?.group) === "faturado") return true;
  return ["credit_card", "bank_slip"].includes(normalize(method?.type));
}
function splitAmount(total: number, parts: number) {
  if (parts <= 0) return [];
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, index) => {
    const isLast = index === parts - 1;
    return ((base + (isLast ? remainder : 0)) / 100).toFixed(2);
  });
}
function addDaysToInputDate(inputDate: string, days: number) {
  const baseDate = inputDate ? new Date(`${inputDate}T12:00:00`) : new Date();
  baseDate.setDate(baseDate.getDate() + days);
  return baseDate.toISOString().slice(0, 10);
}
// ----------------------------------------------------------------------

const NOMES: Array<string | null | undefined> = [
  "BOLETO", "BOLETO 2X", "BOLETO 3X", "BOLETO 8X", "BOLETO/4X", "BOLETO-6X", "boleto 12x",
  "CARTAO CREDITO", "cartão de crédito 6x", "CARTAO DEBITO", "CARTÃO DÉBITO",
  "DINHEIRO", "CAIXA", "PIX", "FATURADO", "FATURADO 3X", "A PRAZO", "a prazo 2x",
  "TRANSFERENCIA", "Cobrança registrada", "  BOLETO  ", "", "   ", null, undefined,
  "BOLETO 0X", "BOLETO 60X", "BOLETO 61X", "BOLETO 99X", "3X", "X", "Depósito",
];

const FORMAS: PM[] = [
  ...NOMES.map((name, i) => ({ id: String(i), name })),
  { id: "g1", name: "Qualquer", group: "FATURADO" },
  { id: "g2", name: "Qualquer", group: "faturado " },
  { id: "g3", name: "Qualquer", group: null },
  { id: "t1", name: "Qualquer", type: "credit_card" },
  { id: "t2", name: "Qualquer", type: "CREDIT_CARD" },
  { id: "t3", name: "Qualquer", type: "bank_slip" },
  { id: "t4", name: "Qualquer", type: "cash" },
  { id: "t5", name: "BOLETO 2X", type: "bank_slip", group: "FATURADO" },
];

describe("equivalência normalize/normalizar", () => {
  test("mesmo resultado para todo o universo", () => {
    for (const nome of NOMES) expect(normalizar(nome)).toBe(normalize(nome));
  });
});

describe("equivalência basePaymentMethodName/nomeBaseDaForma", () => {
  test("mesmo resultado para todo o universo", () => {
    for (const nome of NOMES) expect(nomeBaseDaForma(nome)).toBe(basePaymentMethodName(nome));
  });
});

describe("equivalência parseLegacyInstallmentCount/parcelasNoNomeDaForma", () => {
  test("mesmo resultado, exceto 61..99 (a lib trava em 60, como o backend)", () => {
    for (const nome of NOMES) {
      const antigo = parseLegacyInstallmentCount(nome);
      const novo = parcelasNoNomeDaForma(nome);
      if (antigo !== null && antigo > 60) {
        expect(novo).toBeNull();
      } else {
        expect(novo).toBe(antigo);
      }
    }
  });
});

describe("equivalência allowsInstallments/formaPermiteParcelamento", () => {
  test("mesmo resultado para todo o universo", () => {
    for (const forma of FORMAS) {
      expect(formaPermiteParcelamento(forma as never)).toBe(allowsInstallments(forma));
    }
  });
});

describe("equivalência splitAmount/dividirValor", () => {
  test("dividirValor(...).toFixed(2) === splitAmount(...)", () => {
    const totais = [0, 0.01, 1, 100, 209, 7150.07, 1000.01, 999.995, 33.33, 1234567.89, -50];
    for (const total of totais) {
      for (const partes of [0, 1, 2, 3, 4, 6, 7, 8, 12, 24]) {
        expect(dividirValor(total, partes).map((v) => v.toFixed(2)))
          .toEqual(splitAmount(total, partes));
      }
    }
  });
});

describe("equivalência addDaysToInputDate/somarDias", () => {
  test("mesmo resultado com data preenchida", () => {
    const datas = ["2026-09-15", "2026-01-31", "2026-02-28", "2026-12-31", "2026-03-01"];
    for (const data of datas) {
      for (const dias of [0, 1, 7, 28, 30, 60, 90, 365, -1, -30]) {
        expect(somarDias(data, dias)).toBe(addDaysToInputDate(data, dias));
      }
    }
  });

  test("com data vazia a antiga cai para hoje — é o que o adaptador da tela repõe", () => {
    const hoje = new Date().toISOString().slice(0, 10);
    expect(addDaysToInputDate("", 0)).toBe(hoje);
    expect(somarDias("", 0)).toBe("");
    // Mesma expressão do addDaysToInputDate que ficou em Purchases.tsx.
    const adaptador = (data: string, dias: number) => somarDias(data || hoje, dias);
    for (const dias of [0, 7, 30, 60]) {
      expect(adaptador("", dias)).toBe(addDaysToInputDate("", dias));
    }
  });
});
