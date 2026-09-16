import { describe, expect, test } from "vitest";
import { proximoPassoDoFechamento } from "../fechamento-cmv";

describe("proximoPassoDoFechamento", () => {
  test("RASCUNHO manda enviar para revisao", () => {
    // Era o buraco: o inventario recem-consolidado nasce em RASCUNHO e a tela
    // nao dizia nada sobre o que fazer em seguida.
    const p = proximoPassoDoFechamento("RASCUNHO", true);
    expect(p.acao).toBe("submit");
    expect(p.rotuloAcao).toBe("Enviar para revisão");
    expect(p.concluido).toBeFalsy();
  });

  test("RASCUNHO com cobertura incompleta avisa que o que faltar entra como zero", () => {
    const p = proximoPassoDoFechamento("RASCUNHO", false);
    expect(p.acao).toBe("submit");
    expect(p.descricao).toMatch(/zero/i);
  });

  test("RASCUNHO completo nao fala de zero", () => {
    expect(proximoPassoDoFechamento("RASCUNHO", true).descricao).not.toMatch(/entra como zero/i);
  });

  test("REJEITADO pede ajuste e reenvio, com a mesma acao", () => {
    const p = proximoPassoDoFechamento("REJEITADO", true);
    expect(p.acao).toBe("submit");
    expect(p.titulo).toMatch(/rejeitado/i);
  });

  test("EM_REVISAO manda aprovar e avisa do custo de reabrir", () => {
    const p = proximoPassoDoFechamento("EM_REVISAO", true);
    expect(p.acao).toBe("approve");
    expect(p.descricao).toMatch(/reabrir/i);
  });

  test("APROVADO e FECHADO nao oferecem acao", () => {
    for (const status of ["APROVADO", "FECHADO"]) {
      const p = proximoPassoDoFechamento(status, true);
      expect(p.concluido).toBe(true);
      expect(p.acao).toBeUndefined();
      expect(p.rotuloAcao).toBeUndefined();
    }
  });

  test("status desconhecido nao inventa acao", () => {
    const p = proximoPassoDoFechamento("CANCELADO", true);
    expect(p.acao).toBeUndefined();
    expect(p.titulo).toMatch(/CANCELADO/);
  });

  test("todo status que oferece acao tem rotulo, e vice-versa", () => {
    for (const status of ["RASCUNHO", "REJEITADO", "EM_REVISAO", "APROVADO", "FECHADO", "CANCELADO"]) {
      const p = proximoPassoDoFechamento(status, true);
      expect(Boolean(p.acao)).toBe(Boolean(p.rotuloAcao));
    }
  });
});
