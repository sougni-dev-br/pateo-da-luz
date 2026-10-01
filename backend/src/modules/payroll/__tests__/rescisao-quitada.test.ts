import { describe, expect, test } from "vitest";
import { avaliarTermoSemValor, ehQuitadaNoTermo } from "../rescisao-quitada.js";
import type { ReciboRescisao } from "../tip-trct.service.js";

// Termo com líquido zero (faltas zeraram a rescisão): o caso da Michele e do Vagner.
// CPF fictício válido — nunca CPF de gente de verdade em fixture.
const recibo = (over: Partial<ReciboRescisao> = {}): ReciboRescisao => ({
  nome: "MARIA DE TESTE SILVA", cpfDigitos: "52998224725", admissao: "2026-07-21",
  afastamento: "2026-09-03", pagamento: "2026-09-11", gorjeta: null, liquido: 0, totalBruto: 812.4, ...over,
});
const pessoa = (over: Record<string, unknown> = {}) => ({
  firstName: "Maria de Teste", lastName: "Silva", cpf: "529.982.247-25", modality: "CLT",
  terminationDate: new Date("2026-09-03T00:00:00Z"), ...over,
});

describe("avaliarTermoSemValor", () => {
  test("mesmo CPF, mesma saída e líquido zero: pode quitar, sem avisos", () => {
    const r = avaliarTermoSemValor(recibo(), pessoa(), { rescisaoViva: false });
    expect(r).toEqual({ casadoPor: "CPF", divergencias: [], recusa: null });
  });

  test("CPF diferente mas nome completo igual: casa pelo nome e avisa para conferir o cadastro", () => {
    const r = avaliarTermoSemValor(recibo(), pessoa({ cpf: "111.444.777-35" }), { rescisaoViva: false });
    expect(r.casadoPor).toBe("NOME");
    expect(r.recusa).toBeNull();
    expect(r.divergencias.join(" ")).toMatch(/CPF.*cadastro/);
  });

  test("termo de outra pessoa (nem CPF nem nome): recusa, dizendo de quem é o termo", () => {
    const r = avaliarTermoSemValor(recibo({ nome: "JOSE DE TESTE" }), pessoa({ cpf: "111.444.777-35" }), { rescisaoViva: false });
    expect(r.casadoPor).toBeNull();
    expect(r.recusa).toContain("JOSE DE TESTE");
    expect(r.recusa).toContain("Maria de Teste Silva");
  });

  test("a mensagem de recusa nunca traz o CPF", () => {
    const r = avaliarTermoSemValor(recibo({ nome: null }), pessoa({ cpf: "111.444.777-35" }), { rescisaoViva: false });
    expect(JSON.stringify(r)).not.toMatch(/52998224725|529\.982|11144477735/);
  });

  test("saída do cadastro diferente do afastamento do termo: avisa, não recusa", () => {
    const r = avaliarTermoSemValor(recibo({ afastamento: "2026-09-05" }), pessoa(), { rescisaoViva: false });
    expect(r.recusa).toBeNull();
    expect(r.divergencias.join(" ")).toContain("03/09/2026");
    expect(r.divergencias.join(" ")).toContain("05/09/2026");
  });

  test("líquido diferente de zero: recusa e manda lançar a rescisão normal", () => {
    const r = avaliarTermoSemValor(recibo({ liquido: 458.36 }), pessoa(), { rescisaoViva: false });
    expect(r.recusa).toMatch(/458,36/);
    expect(r.recusa).toMatch(/lance a rescisão/i);
  });

  test("líquido não lido: recusa (não dá para afirmar que é zero)", () => {
    const r = avaliarTermoSemValor(recibo({ liquido: null }), pessoa(), { rescisaoViva: false });
    expect(r.recusa).toMatch(/líquido/i);
  });

  test("já há rescisão lançada: recusa", () => {
    const r = avaliarTermoSemValor(recibo(), pessoa(), { rescisaoViva: true });
    expect(r.recusa).toMatch(/já lançada/i);
  });

  test("sem registro não tem termo da contabilidade: recusa", () => {
    const r = avaliarTermoSemValor(recibo(), pessoa({ modality: "NAO_CLT" }), { rescisaoViva: false });
    expect(r.recusa).toMatch(/sem registro/i);
  });

  test("sem data de saída no cadastro: recusa", () => {
    const r = avaliarTermoSemValor(recibo(), pessoa({ terminationDate: null }), { rescisaoViva: false });
    expect(r.recusa).toMatch(/data de saída/i);
  });

  test("termo com gorjeta e líquido zero: pode quitar, mas lembra da apuração de gorjeta", () => {
    const r = avaliarTermoSemValor(recibo({ gorjeta: 120.5 }), pessoa(), { rescisaoViva: false });
    expect(r.recusa).toBeNull();
    expect(r.divergencias.join(" ")).toMatch(/gorjeta/i);
  });
});

describe("ehQuitadaNoTermo", () => {
  test("só com a marca no details", () => {
    expect(ehQuitadaNoTermo({ quitadaNoTermo: true })).toBe(true);
    expect(ehQuitadaNoTermo({ quitadaNoTermo: "true" })).toBe(false);
    expect(ehQuitadaNoTermo({ grupoRescisao: "g" })).toBe(false);
    expect(ehQuitadaNoTermo(null)).toBe(false);
  });
});
