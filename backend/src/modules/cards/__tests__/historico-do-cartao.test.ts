import { describe, expect, it } from "vitest";
import { resumirAlteracao } from "../historico-do-cartao";

const base = { name: "Cartão A", bankName: "Banco", closingDay: 5, dueDay: 18, isActive: true, notes: null };
const fisico = { id: "f1", label: "Físico", last4Digits: "1111", kind: "PHYSICAL", isActive: true };
const virtual = { id: "f2", label: "Virtual loja", last4Digits: "2222", kind: "VIRTUAL", isActive: true };

describe("resumirAlteracao", () => {
  it("criação de cartão", () => {
    expect(resumirAlteracao(null, { ...base, finais: [fisico] })).toEqual([
      "Cartão criado: Cartão A (Banco)",
      "Cartão físico ·· 1111 cadastrado"
    ]);
  });

  it("mudança de campos da conta mostra antes e depois", () => {
    const r = resumirAlteracao({ ...base, finais: [] }, { ...base, name: "Cartão Sicredi", closingDay: 4, finais: [] });
    expect(r).toEqual(["Nome: Cartão A → Cartão Sicredi", "Fechamento: dia 5 → dia 4"]);
  });

  it("cartão virtual adicionado e outro inativado", () => {
    const r = resumirAlteracao(
      { ...base, finais: [fisico, virtual] },
      { ...base, finais: [fisico, { ...virtual, isActive: false }, { id: "f3", label: "Virtual app", last4Digits: "3333", kind: "VIRTUAL", isActive: true }] }
    );
    expect(r).toEqual(["Cartão virtual ·· 2222 inativado", "Cartão virtual ·· 3333 cadastrado"]);
  });

  it("troca de final ou de apelido de um cartão existente", () => {
    const r = resumirAlteracao({ ...base, finais: [virtual] }, { ...base, finais: [{ ...virtual, last4Digits: "9999", label: "Virtual nova" }] });
    expect(r).toEqual(["Cartão virtual: final 2222 → 9999", "Cartão virtual ·· 9999: nome Virtual loja → Virtual nova"]);
  });

  it("sem diferença devolve lista vazia", () => {
    expect(resumirAlteracao({ ...base, finais: [fisico] }, { ...base, finais: [fisico] })).toEqual([]);
  });

  it("tolera valores ausentes (registros antigos sem finais)", () => {
    expect(resumirAlteracao({ ...base }, { ...base, dueDay: 20 })).toEqual(["Vencimento: dia 18 → dia 20"]);
  });
});
