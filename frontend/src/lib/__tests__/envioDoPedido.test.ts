import { describe, expect, test } from "vitest";
import { etapasParaAprovar, linkEmail, linkWhatsapp, mensagemDoPedido, podeEnviarAoFornecedor, telefoneParaWhatsapp } from "../envioDoPedido";

describe("telefoneParaWhatsapp", () => {
  test("celular e fixo com máscara ganham o DDI 55", () => {
    expect(telefoneParaWhatsapp("(11) 98765-4321")).toBe("5511987654321");
    expect(telefoneParaWhatsapp("11 3333-4444")).toBe("551133334444");
  });

  test("zero na frente do DDD e DDI já presente", () => {
    expect(telefoneParaWhatsapp("011 98765-4321")).toBe("5511987654321");
    expect(telefoneParaWhatsapp("+55 11 98765-4321")).toBe("5511987654321");
  });

  test("telefone curto, vazio ou estranho não vira link", () => {
    expect(telefoneParaWhatsapp("3333-4444")).toBeNull();
    expect(telefoneParaWhatsapp("")).toBeNull();
    expect(telefoneParaWhatsapp(null)).toBeNull();
  });
});

describe("mensagem e links", () => {
  const pedido = {
    code: "PC-2026-0001", supplierNameSnapshot: "Moinho Bom", supplierContactName: "Carlos", expectedDeliveryDate: "2026-10-20T00:00:00.000Z",
    items: [
      { productNameSnapshot: "FARINHA", requestedQuantity: "20.000", unitSnapshot: "KG" },
      { productNameSnapshot: "SAL", requestedQuantity: 2.5, unitSnapshot: null }
    ]
  } as never;

  test("traz o código, os itens com a quantidade confirmada e a entrega prevista", () => {
    const texto = mensagemDoPedido(pedido);
    expect(texto).toContain("Olá, Carlos! Segue o pedido de compra PC-2026-0001 do Pateo da Luz.");
    expect(texto).toContain("• 20 KG — FARINHA");
    expect(texto).toContain("• 2,5 — SAL");
    expect(texto).toContain("Entrega prevista: 20/10/2026");
  });

  test("pedido grande resume o resto e manda ver o PDF", () => {
    const itens = Array.from({ length: 45 }, (_, i) => ({ productNameSnapshot: `P${i}`, requestedQuantity: 1, unitSnapshot: "UN" }));
    expect(mensagemDoPedido({ ...(pedido as object), items: itens } as never)).toContain("e mais 5 itens (veja o PDF)");
  });

  test("link do WhatsApp codifica a mensagem; sem telefone não há link", () => {
    expect(linkWhatsapp("(11) 98765-4321", "Olá & tudo bem?")).toBe("https://wa.me/5511987654321?text=Ol%C3%A1%20%26%20tudo%20bem%3F");
    expect(linkWhatsapp(null, "x")).toBeNull();
  });

  test("link de e-mail só com endereço válido", () => {
    expect(linkEmail("compras@moinho.com", "Pedido", "Olá")).toBe("mailto:compras@moinho.com?subject=Pedido&body=Ol%C3%A1");
    expect(linkEmail("sem arroba", "a", "b")).toBeNull();
    expect(linkEmail("a@b.com?bcc=x@y.com", "a", "b")).toBeNull();
  });
});

describe("fluxo de status", () => {
  test("rascunho passa por revisão e aprovação; em revisão só aprova; aprovado não precisa de nada", () => {
    expect(etapasParaAprovar("RASCUNHO")).toEqual(["SEND_REVIEW", "APPROVE"]);
    expect(etapasParaAprovar("EM_REVISAO")).toEqual(["APPROVE"]);
    expect(etapasParaAprovar("APROVADO")).toEqual([]);
  });

  test("só aprovado ou enviado vai ao fornecedor", () => {
    expect(podeEnviarAoFornecedor("APROVADO")).toBe(true);
    expect(podeEnviarAoFornecedor("ENVIADO")).toBe(true);
    expect(podeEnviarAoFornecedor("RASCUNHO")).toBe(false);
    expect(podeEnviarAoFornecedor("CANCELADO")).toBe(false);
  });
});
