import { describe, expect, it } from "vitest";
import { decidirSincronizacao, ehCategoriaFuncionario, motivoParaNaoFechar } from "../reimbursement-rules.js";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const aberto = { reportStatus: "OPEN", payeeId: "pessoa-a", amount: 120.5, purchaseDate: d("2026-10-03") };

describe("quem pode ser 'quem pagou'", () => {
  it("aceita a categoria Funcionario com ou sem acento e em qualquer caixa", () => {
    expect(ehCategoriaFuncionario("Funcionário")).toBe(true);
    expect(ehCategoriaFuncionario("FUNCIONARIO")).toBe(true);
  });

  it("recusa loja e fornecedor sem categoria", () => {
    expect(ehCategoriaFuncionario("Hortifruti")).toBe(false);
    expect(ehCategoriaFuncionario(null)).toBe(false);
  });
});

describe("compra criada ou editada", () => {
  it("compra nova de reembolso entra no reembolso", () => {
    expect(decidirSincronizacao(null, { payeeId: "pessoa-a", amount: 10, purchaseDate: d("2026-10-01") })).toBe("ADICIONAR");
  });

  it("compra comum nao toca em reembolso", () => {
    expect(decidirSincronizacao(null, { payeeId: null, amount: 10, purchaseDate: d("2026-10-01") })).toBe("NADA");
  });

  it("mudar o valor num reembolso aberto atualiza o item", () => {
    expect(decidirSincronizacao(aberto, { ...aberto, amount: 130 })).toBe("ATUALIZAR");
  });

  it("mudar a data num reembolso aberto atualiza o item", () => {
    expect(decidirSincronizacao(aberto, { ...aberto, purchaseDate: d("2026-10-04") })).toBe("ATUALIZAR");
  });

  it("trocar quem pagou move a compra para o reembolso da outra pessoa", () => {
    expect(decidirSincronizacao(aberto, { ...aberto, payeeId: "pessoa-b" })).toBe("MOVER");
  });

  it("deixar de ser reembolso tira a compra do reembolso aberto", () => {
    expect(decidirSincronizacao(aberto, { ...aberto, payeeId: null })).toBe("REMOVER");
  });

  it("editar outros campos (NF, observacao) nao mexe no item", () => {
    expect(decidirSincronizacao(aberto, { payeeId: "pessoa-a", amount: 120.5, purchaseDate: d("2026-10-03") })).toBe("NADA");
  });

  it("centavo de arredondamento nao conta como mudanca", () => {
    expect(decidirSincronizacao(aberto, { ...aberto, amount: 120.50000001 })).toBe("NADA");
  });

  it.each(["CLOSED", "PAID"])("reembolso %s bloqueia mudar valor, data ou quem pagou", (reportStatus) => {
    const fechado = { ...aberto, reportStatus };
    expect(decidirSincronizacao(fechado, { ...fechado, amount: 99 })).toBe("BLOQUEADO");
    expect(decidirSincronizacao(fechado, { ...fechado, purchaseDate: d("2026-10-09") })).toBe("BLOQUEADO");
    expect(decidirSincronizacao(fechado, { ...fechado, payeeId: "pessoa-b" })).toBe("BLOQUEADO");
    expect(decidirSincronizacao(fechado, { ...fechado, payeeId: null })).toBe("BLOQUEADO");
  });

  it("reembolso fechado ainda deixa editar o que nao muda o titulo", () => {
    const fechado = { ...aberto, reportStatus: "CLOSED" };
    expect(decidirSincronizacao(fechado, { payeeId: "pessoa-a", amount: 120.5, purchaseDate: d("2026-10-03") })).toBe("NADA");
  });
});

describe("fechar o reembolso", () => {
  const pronto = {
    status: "OPEN",
    itens: [{ checked: true }, { checked: true }],
    total: 250,
    tipoDaFormaDePagamento: "PIX",
    vencimento: d("2026-10-15")
  };

  it("fecha quando tudo foi conferido e ha forma de pagamento e vencimento", () => {
    expect(motivoParaNaoFechar(pronto)).toBeNull();
  });

  it("nao fecha reembolso que nao esta aberto", () => {
    expect(motivoParaNaoFechar({ ...pronto, status: "CLOSED" })).toMatch(/aberto/);
  });

  it("nao fecha sem compras", () => {
    expect(motivoParaNaoFechar({ ...pronto, itens: [] })).toMatch(/sem compras/);
  });

  it("diz quantas compras faltam conferir", () => {
    expect(motivoParaNaoFechar({ ...pronto, itens: [{ checked: true }, { checked: false }, { checked: false }] })).toMatch(/^2 compra/);
  });

  it("nao fecha com valor zero", () => {
    expect(motivoParaNaoFechar({ ...pronto, total: 0 })).toMatch(/sem valor/);
  });

  it("exige a forma como a pessoa vai receber", () => {
    expect(motivoParaNaoFechar({ ...pronto, tipoDaFormaDePagamento: null })).toMatch(/receber/);
  });

  it.each(["CREDIT_CARD", "REIMBURSEMENT"])("nao paga a pessoa com %s", (tipo) => {
    expect(motivoParaNaoFechar({ ...pronto, tipoDaFormaDePagamento: tipo })).toMatch(/PIX/);
  });

  it("exige vencimento valido", () => {
    expect(motivoParaNaoFechar({ ...pronto, vencimento: null })).toMatch(/vencimento/);
    expect(motivoParaNaoFechar({ ...pronto, vencimento: new Date("x") })).toMatch(/vencimento/);
  });
});
