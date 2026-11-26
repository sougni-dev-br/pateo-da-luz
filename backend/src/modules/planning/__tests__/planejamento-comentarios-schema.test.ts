import { describe, expect, it } from "vitest";
import { edicaoComentarioSchema, novoComentarioSchema } from "../planejamento-comentarios-schema.js";

const valido = { anoBase: 2025, anoComparado: 2026, mes: 3, metrica: "VENDAS", turno: "TOTAL", texto: "Feriado prolongado em abril." };
const erro = (dados: unknown) => {
  const r = novoComentarioSchema.safeParse(dados);
  return r.success ? null : r.error.issues[0]?.message;
};

describe("novoComentarioSchema", () => {
  it("aceita um comentário completo e assume naImpressao = true", () => {
    const r = novoComentarioSchema.parse(valido);
    expect(r.naImpressao).toBe(true);
    expect(r.texto).toBe("Feriado prolongado em abril.");
  });

  it("turno padrão é TOTAL", () => {
    const { turno: _t, ...semTurno } = valido;
    expect(novoComentarioSchema.parse(semTurno).turno).toBe("TOTAL");
  });

  it("respeita naImpressao = false", () => {
    expect(novoComentarioSchema.parse({ ...valido, naImpressao: false }).naImpressao).toBe(false);
  });

  it("rejeita texto vazio ou só com espaços", () => {
    expect(erro({ ...valido, texto: "" })).toMatch(/comentário/i);
    expect(erro({ ...valido, texto: "   \n\t " })).toMatch(/comentário/i);
  });

  it("limita o texto a 1000 caracteres", () => {
    expect(novoComentarioSchema.safeParse({ ...valido, texto: "a".repeat(1000) }).success).toBe(true);
    expect(erro({ ...valido, texto: "a".repeat(1001) })).toMatch(/1000/);
  });

  it("normaliza \r\n para \n e apara as pontas", () => {
    expect(novoComentarioSchema.parse({ ...valido, texto: "  linha 1\r\nlinha 2  " }).texto).toBe("linha 1\nlinha 2");
  });

  it("conta o limite depois de normalizar \r\n", () => {
    const texto = "a\r\n".repeat(333) + "b";
    expect(novoComentarioSchema.safeParse({ ...valido, texto }).success).toBe(true);
  });

  it("aceita mês nulo (ano inteiro) e rejeita 0, 13 e fracionário", () => {
    expect(novoComentarioSchema.parse({ ...valido, mes: null }).mes).toBeNull();
    for (const mes of [0, 13, 1.5, undefined]) expect(erro({ ...valido, mes })).not.toBeNull();
  });

  it("rejeita anos iguais, fora dos limites ou não inteiros", () => {
    expect(erro({ ...valido, anoBase: 2026 })).toMatch(/diferentes/i);
    expect(erro({ ...valido, anoBase: 2019 })).not.toBeNull();
    expect(erro({ ...valido, anoComparado: 2101 })).not.toBeNull();
    expect(erro({ ...valido, anoComparado: 2026.5 })).not.toBeNull();
  });

  it("rejeita métrica e turno fora da lista", () => {
    expect(erro({ ...valido, metrica: "LUCRO" })).not.toBeNull();
    expect(erro({ ...valido, turno: "MANHA" })).not.toBeNull();
  });

  it("descarta autorId vindo no corpo", () => {
    expect(novoComentarioSchema.parse({ ...valido, autorId: "outro" })).not.toHaveProperty("autorId");
  });
});

describe("edicaoComentarioSchema", () => {
  const lido = "2026-11-20T10:00:00.000Z";

  it("aceita só o texto, só a flag ou os dois", () => {
    expect(edicaoComentarioSchema.safeParse({ texto: "novo", atualizadoEm: lido }).success).toBe(true);
    expect(edicaoComentarioSchema.safeParse({ naImpressao: false, atualizadoEm: lido }).success).toBe(true);
  });

  it("exige algo para mudar", () => {
    expect(edicaoComentarioSchema.safeParse({ atualizadoEm: lido }).success).toBe(false);
  });

  it("exige atualizadoEm ISO", () => {
    expect(edicaoComentarioSchema.safeParse({ texto: "x" }).success).toBe(false);
    expect(edicaoComentarioSchema.safeParse({ texto: "x", atualizadoEm: "ontem" }).success).toBe(false);
  });

  it("aplica as mesmas regras de texto e ignora ponto/autor", () => {
    expect(edicaoComentarioSchema.safeParse({ texto: "  ", atualizadoEm: lido }).success).toBe(false);
    const r = edicaoComentarioSchema.parse({ texto: "a\r\nb", mes: 5, autorId: "x", atualizadoEm: lido });
    expect(r.texto).toBe("a\nb");
    expect(r).not.toHaveProperty("mes");
    expect(r).not.toHaveProperty("autorId");
  });
});
