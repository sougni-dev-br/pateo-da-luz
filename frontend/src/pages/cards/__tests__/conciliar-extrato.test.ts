import { describe, expect, it } from "vitest";
import { conciliarExtrato, lerExtrato } from "../conciliar-extrato";

describe("lerExtrato", () => {
  it("lê data, descrição e valor em formato brasileiro", () => {
    const [linha] = lerExtrato("21/08 HORTIFRUTI EXEMPLO R$ 1.250,50");
    expect(linha).toMatchObject({ dia: 21, mes: 8, valor: 1250.5 });
    expect(linha.descricao).toContain("HORTIFRUTI");
  });

  it("aceita linha sem data e valor sem R$", () => {
    const [linha] = lerExtrato("LOJA ONLINE 480,00");
    expect(linha).toMatchObject({ dia: null, mes: null, valor: 480 });
  });

  it("usa o último valor da linha (o anterior pode ser parcela ou cotação)", () => {
    const [linha] = lerExtrato("10/09 LOJA 2/3 150,00");
    expect(linha.valor).toBe(150);
  });

  it("ignora linhas em branco e sem valor", () => {
    expect(lerExtrato("\n  \nSaldo anterior\n")).toEqual([]);
  });

  it("lê data com ano", () => {
    expect(lerExtrato("05/09/2026 PAPELARIA 90,00")[0]).toMatchObject({ dia: 5, mes: 9, valor: 90 });
  });
});

const item = (id: string, value: string, data: string) => ({ id, value, itemDate: `${data}T00:00:00.000Z`, description: id });

describe("conciliarExtrato", () => {
  it("casa por valor e data", () => {
    const r = conciliarExtrato(lerExtrato("21/08 A 100,00\n22/08 B 200,00"), [item("x", "100.00", "2026-08-21"), item("y", "200.00", "2026-08-22")]);
    expect(r.pares.map((p) => [p.itemId, p.certeza])).toEqual([["x", "data"], ["y", "data"]]);
    expect(r.soNoExtrato).toEqual([]);
    expect(r.soNoSistema).toEqual([]);
  });

  it("valores iguais: cada linha do extrato pega o item da mesma data", () => {
    const r = conciliarExtrato(lerExtrato("22/08 B 50,00\n21/08 A 50,00"), [item("x", "50.00", "2026-08-21"), item("y", "50.00", "2026-08-22")]);
    expect(r.pares.find((p) => p.linha.dia === 22)?.itemId).toBe("y");
    expect(r.pares.find((p) => p.linha.dia === 21)?.itemId).toBe("x");
  });

  it("data do banco um dia depois da compra ainda casa", () => {
    const r = conciliarExtrato(lerExtrato("22/08 A 100,00"), [item("x", "100.00", "2026-08-21")]);
    expect(r.pares[0]).toMatchObject({ itemId: "x", certeza: "data" });
  });

  it("mesmo valor com data muito diferente casa só por valor", () => {
    const r = conciliarExtrato(lerExtrato("28/08 A 100,00"), [item("x", "100.00", "2026-08-10")]);
    expect(r.pares[0]).toMatchObject({ itemId: "x", certeza: "valor" });
  });

  it("separa o que só está no extrato e o que só está no sistema", () => {
    const r = conciliarExtrato(lerExtrato("A 100,00\nB 999,00"), [item("x", "100.00", "2026-08-21"), item("z", "70.00", "2026-08-22")]);
    expect(r.soNoExtrato.map((l) => l.valor)).toEqual([999]);
    expect(r.soNoSistema.map((i) => i.id)).toEqual(["z"]);
  });

  it("um item não é usado por duas linhas do extrato", () => {
    const r = conciliarExtrato(lerExtrato("A 100,00\nB 100,00"), [item("x", "100.00", "2026-08-21")]);
    expect(r.pares).toHaveLength(1);
    expect(r.soNoExtrato).toHaveLength(1);
  });

  it("não acumula erro de centavos", () => {
    const r = conciliarExtrato(lerExtrato("A 0,30"), [item("x", "0.3", "2026-08-21")]);
    expect(r.pares).toHaveLength(1);
  });
});
