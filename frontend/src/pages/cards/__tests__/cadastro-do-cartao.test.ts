import { describe, expect, it } from "vitest";
import { errosDoFormulario, formDoCartao, melhorDiaDeCompra, paraPayload } from "../cadastro-do-cartao";

describe("melhorDiaDeCompra", () => {
  it("é o dia seguinte ao fechamento", () => {
    expect(melhorDiaDeCompra(5)).toBe(6);
    expect(melhorDiaDeCompra(30)).toBe(31);
  });
  it("fechamento no dia 31 vira dia 1", () => {
    expect(melhorDiaDeCompra(31)).toBe(1);
  });
});

const card = {
  id: "c1", name: "Cartão Sicredi", bankName: "Sicredi", last4Digits: "1111", closingDay: 5, dueDay: 18, isActive: true, notes: null,
  createdAt: "", updatedAt: "", finais: [
    { id: "f1", creditCardId: "c1", label: "Físico", last4Digits: "1111", kind: "PHYSICAL", isActive: true },
    { id: "f2", creditCardId: "c1", label: "Virtual loja", last4Digits: "2222", kind: "VIRTUAL", isActive: true }
  ]
};

describe("formDoCartao", () => {
  it("cartão novo começa vazio, com fechamento e vencimento em branco", () => {
    const f = formDoCartao();
    expect(f).toMatchObject({ id: "", name: "", closingDay: "", dueDay: "", virtuais: [] });
    expect(f.fisico.last4Digits).toBe("");
  });
  it("edição separa o físico dos virtuais", () => {
    const f = formDoCartao(card);
    expect(f.fisico).toMatchObject({ id: "f1", last4Digits: "1111" });
    expect(f.virtuais).toEqual([expect.objectContaining({ id: "f2", label: "Virtual loja", last4Digits: "2222", isActive: true })]);
  });
  it("conta antiga sem finais usa o final da conta como físico (ainda sem id)", () => {
    const f = formDoCartao({ ...card, finais: [] });
    expect(f.fisico).toMatchObject({ last4Digits: "1111" });
    expect(f.fisico.id).toBeUndefined();
  });
});

describe("errosDoFormulario", () => {
  const ok = formDoCartao(card);
  it("formulário completo não tem erro", () => {
    expect(errosDoFormulario(ok)).toEqual({});
  });
  it("aponta o campo obrigatório que falta", () => {
    const e = errosDoFormulario({ ...ok, name: " ", fisico: { ...ok.fisico, last4Digits: "12" }, closingDay: "40" });
    expect(Object.keys(e).sort()).toEqual(["closingDay", "fisico", "name"]);
  });
  it("final repetido entre físico e virtual", () => {
    const e = errosDoFormulario({ ...ok, virtuais: [{ key: "a", id: "f2", label: "V", last4Digits: "1111", isActive: true }] });
    expect(e.virtuais).toContain("1111");
  });
  it("virtual sem final válido", () => {
    const e = errosDoFormulario({ ...ok, virtuais: [{ key: "a", label: "V", last4Digits: "", isActive: true }] });
    expect(e.virtuais).toBeTruthy();
  });
});

describe("paraPayload", () => {
  it("monta a conta e os cartões, físico primeiro", () => {
    const p = paraPayload(formDoCartao(card));
    expect(p).toMatchObject({ id: "c1", name: "Cartão Sicredi", closingDay: 5, dueDay: 18 });
    expect(p.finais.map((x) => [x.kind, x.last4Digits])).toEqual([["PHYSICAL", "1111"], ["VIRTUAL", "2222"]]);
    expect(p.finais[0].id).toBe("f1");
  });
  it("cartão novo não manda id", () => {
    const f = formDoCartao();
    const p = paraPayload({ ...f, name: "A", bankName: "B", closingDay: "5", dueDay: "18", fisico: { last4Digits: "1111" } });
    expect(p.id).toBeUndefined();
    expect(p.finais).toHaveLength(1);
  });
});
