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

  test("acertos da lista lançados: conta quantos", () => {
    const r = avisoDoFechamento({ acertosLista: { criados: 3, atualizados: 1, detalhes: null, erro: null, avisos: [] } });
    expect(r).toEqual({ tone: "success", message: `${BASE} Acertos da lista no Contas a Pagar: 3 lançados, 1 atualizado.` });
  });

  test("acertos não lançados (sem permissão da Folha, mês travado, avisos): fecha, mas avisa", () => {
    const semPermissao = avisoDoFechamento({ acertosLista: { criados: 0, atualizados: 0, detalhes: null, erro: null, avisos: [], aviso: "Acertos da lista de pagamento não lançados: exige editar a Folha" } });
    expect(semPermissao.tone).toBe("warning");
    expect(semPermissao.message).toContain("Acertos da lista de pagamento não lançados: exige editar a Folha");
    const travado = avisoDoFechamento({ acertosLista: { criados: 0, atualizados: 0, detalhes: null, erro: "Mês travado", avisos: [] } });
    expect(travado.tone).toBe("warning");
    expect(travado.message).toMatch(/acertos da lista.*Mês travado/i);
    const comAviso = avisoDoFechamento({ acertosLista: { criados: 1, atualizados: 0, detalhes: null, erro: null, avisos: ["Ana Exemplo: acerto pago não muda"] } });
    expect(comAviso.tone).toBe("warning");
    expect(comAviso.message).toContain("1 lançado");
    expect(comAviso.message).toContain("Ana Exemplo: acerto pago não muda");
  });

  test("erro na sincronização vira aviso, não erro do fechamento", () => {
    const r = avisoDoFechamento({ salariosCombinados: { atualizados: 0, detalhes: null, erro: "mês travado" } });
    expect(r.tone).toBe("warning");
    expect(r.message).toContain("mês travado");
  });
});
