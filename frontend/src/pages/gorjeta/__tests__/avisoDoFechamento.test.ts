import { describe, expect, test } from "vitest";
import { avisoDoFechamento } from "../avisoDoFechamento";

const BASE = "Período fechado. O retrato completo ficou gravado no registro de fechamentos (Relatórios → Fechamentos).";

describe("aviso depois de fechar a gorjeta", () => {
  test("sem nada da sincronização (backend antigo): só o sucesso", () => {
    expect(avisoDoFechamento({})).toEqual({ tone: "success", message: BASE });
  });

  test("salários combinados atualizados: conta quantos", () => {
    expect(avisoDoFechamento({ salariosCombinados: { atualizados: 2, detalhes: null, erro: null } }))
      .toEqual({ tone: "success", message: `${BASE} 2 salários combinados atualizados no Contas a Pagar.` });
  });

  test("sincronização não feita (falta permissão da Folha): fecha, mas avisa", () => {
    const r = avisoDoFechamento({ salariosCombinados: { atualizados: 0, detalhes: null, erro: null, aviso: "sincronização não feita: falta permissão da Folha" } });
    expect(r.tone).toBe("warning");
    expect(r.message).toContain(BASE);
    expect(r.message).toContain("sincronização não feita: falta permissão da Folha");
  });

  test("erro na sincronização vira aviso, não erro do fechamento", () => {
    const r = avisoDoFechamento({ salariosCombinados: { atualizados: 0, detalhes: null, erro: "mês travado" } });
    expect(r.tone).toBe("warning");
    expect(r.message).toContain("mês travado");
  });
});
