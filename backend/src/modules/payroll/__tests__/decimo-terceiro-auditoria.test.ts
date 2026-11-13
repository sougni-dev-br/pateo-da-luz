import { describe, expect, test } from "vitest";
import { decidirParcela, familia13, ROTULO_13_EXTRATO_PARCELA_1, ROTULO_13_PARCELA_1, ROTULO_13_PARCELA_2 } from "../decimo-terceiro-sr.js";
import { lerAno } from "../decimo-terceiro.routes.js";
import { mesmoPagamento } from "../folha-duplicidade.js";
import { detalhesNaLista } from "../payroll.routes.js";
import { calculoDoTexto, lerTextoExtrato } from "../rh-extract.service.js";

// Correções da auditoria do 13º. Dados FICTÍCIOS: o repositório é público.
const data = new Date("2026-11-10T12:00:00Z");

describe("decidirParcela — o que fazer com o que já existe", () => {
  test("não existe: cria", () => {
    expect(decidirParcela(null)).toBe("criar");
  });
  test("ativa e não paga: fica como está (não regrava valor)", () => {
    expect(decidirParcela({ deletedAt: null, deletedById: null, paymentDate: null })).toBe("ja-existe");
  });
  test("paga: nunca é mexida", () => {
    expect(decidirParcela({ deletedAt: null, deletedById: null, paymentDate: data })).toBe("ja-pago");
  });
  test("excluída à mão (com autor): não é recriada, mesmo que tenha sido paga", () => {
    expect(decidirParcela({ deletedAt: data, deletedById: "u1", paymentDate: null })).toBe("excluida-a-mao");
    expect(decidirParcela({ deletedAt: data, deletedById: "u1", paymentDate: data })).toBe("excluida-a-mao");
  });
  test("excluída sem autor (legado): volta", () => {
    expect(decidirParcela({ deletedAt: data, deletedById: null, paymentDate: null })).toBe("restaurar");
  });
});

describe("familia13 e mesmoPagamento do 13º", () => {
  const base = { employeeId: "e1", type: "DECIMO_TERCEIRO", competenceYear: 2026, competenceMonth: 11 };
  test("lê parcela e origem pelo rótulo", () => {
    expect(familia13(ROTULO_13_PARCELA_1)).toEqual({ parcela: 1, origem: "SEM_REGISTRO" });
    expect(familia13(ROTULO_13_PARCELA_2)).toEqual({ parcela: 2, origem: "SEM_REGISTRO" });
    expect(familia13(ROTULO_13_EXTRATO_PARCELA_1)).toEqual({ parcela: 1, origem: "EXTRATO" });
    expect(familia13("13º à mão")).toEqual({ parcela: null, origem: "SEM_REGISTRO" });
  });
  test("extrato e período sem registro da mesma parcela convivem", () => {
    expect(mesmoPagamento({ ...base, id: "a", periodLabel: ROTULO_13_EXTRATO_PARCELA_1 }, { ...base, id: "b", periodLabel: ROTULO_13_PARCELA_1 })).toBe(false);
  });
  test("mesma parcela e mesma origem com rótulo diferente (à mão) é duplicidade", () => {
    expect(mesmoPagamento({ ...base, id: "a", periodLabel: ROTULO_13_PARCELA_1 }, { ...base, id: "b", periodLabel: "13º - 1ª parcela (acerto)" })).toBe(true);
  });
  test("parcelas diferentes, ou rótulo sem parcela reconhecível, não acusam", () => {
    expect(mesmoPagamento({ ...base, id: "a", periodLabel: ROTULO_13_PARCELA_1 }, { ...base, id: "b", periodLabel: ROTULO_13_PARCELA_2 })).toBe(false);
    expect(mesmoPagamento({ ...base, id: "a", periodLabel: "13º à mão" }, { ...base, id: "b", periodLabel: "Outro" })).toBe(false);
  });
});

describe("detalhesNaLista do 13º (sem ver Funcionários)", () => {
  const details = {
    semRegistro: true, decimoTerceiro: true, parcela: 1, avos: 12, desde: "2026-01-01", base: 2900, totalDecimo: 2900,
    memoria: "(S 2.400,00 + média variáveis 500,00) ÷ 12 × 12 avos", preRegistro: true, semRegistroAte: "2026-05-31", registroEm: "2026-06-15",
  };
  test("sai o que revela o salário: base, total, avos, desde e a memória do cálculo", () => {
    const visto = detalhesNaLista("DECIMO_TERCEIRO", details, false) as Record<string, unknown>;
    expect(visto).toEqual({ semRegistro: true, decimoTerceiro: true, parcela: 1, preRegistro: true, semRegistroAte: "2026-05-31", registroEm: "2026-06-15" });
    for (const k of ["base", "totalDecimo", "memoria", "avos", "desde"]) expect(visto).not.toHaveProperty(k);
  });
  test("quem vê Funcionários recebe tudo", () => {
    expect(detalhesNaLista("DECIMO_TERCEIRO", details, true)).toEqual(details);
  });
  test("o 13º do extrato também perde o líquido e a gorjeta dos detalhes", () => {
    const doExtrato = { calculo: "DECIMO_TERCEIRO", liquido: 1300, gorjeta: null, adiantamento: null, empresa: "EMPRESA EXEMPLO", decimoTerceiro: true, parcela: 1 };
    const visto = detalhesNaLista("DECIMO_TERCEIRO", doExtrato, false) as Record<string, unknown>;
    expect(visto).toEqual({ calculo: "DECIMO_TERCEIRO", empresa: "EMPRESA EXEMPLO", decimoTerceiro: true, parcela: 1 });
  });
});

describe("lerAno da rota", () => {
  test("ausente ou vazio: ano corrente; válido: o ano; inválido: null (a rota responde 400)", () => {
    expect(lerAno(undefined)).toBe(new Date().getFullYear());
    expect(lerAno("")).toBe(new Date().getFullYear());
    expect(lerAno("2026")).toBe(2026);
    expect(lerAno(2026)).toBe(2026);
    expect(lerAno("abc")).toBeNull();
    expect(lerAno("1999")).toBeNull();
    expect(lerAno("2101")).toBeNull();
    expect(lerAno("2026.5")).toBeNull();
  });
});

describe("leitor do extrato: robustez", () => {
  test("'Cálculo:' sem valor na mesma linha não é lido como 13º nem como adiantamento", () => {
    expect(calculoDoTexto("Cálculo:\n13 JOAO\nEmpr.:")).toBe("MENSAL");
    expect(calculoDoTexto("Cálculo:\nAdiantamento")).toBe("MENSAL");
  });
  test("entrada patológica (muitos espaços) não trava o leitor", () => {
    const inicio = Date.now();
    lerTextoExtrato("1 A" + " ".repeat(200_000));
    expect(Date.now() - inicio).toBeLessThan(1000);
  });
});
