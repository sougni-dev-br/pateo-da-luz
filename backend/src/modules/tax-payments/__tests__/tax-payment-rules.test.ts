import path from "node:path";
import { describe, expect, test } from "vitest";
import { dataDePagamentoPlausivel, diaIso, hojeBrasilia, lerData, observacoesDaBaixa, observacoesDoEstorno, parseValorGuia, resolverUploadImportacao, statusDaGuia, statusDeGuiaEmAberto } from "../tax-payment-rules.js";

describe("statusDaGuia", () => {
  const hoje = new Date("2026-10-20T15:00:00Z");

  test("com pagamento é PAID, mesmo vencida", () => {
    expect(statusDaGuia(new Date("2026-10-25T00:00:00Z"), new Date("2026-09-01T00:00:00Z"), false, hoje)).toBe("PAID");
  });

  test("sem pagamento e vencimento anterior a hoje é OVERDUE", () => {
    expect(statusDaGuia(null, new Date("2026-10-19T00:00:00Z"), false, hoje)).toBe("OVERDUE");
  });

  test("vence hoje ainda é PENDING, em qualquer hora do dia", () => {
    expect(statusDaGuia(null, new Date("2026-10-20T00:00:00Z"), false, new Date("2026-10-20T23:59:00Z"))).toBe("PENDING");
  });

  test("vencimento futuro é PENDING", () => {
    expect(statusDaGuia(null, new Date("2026-11-20T00:00:00Z"), false, hoje)).toBe("PENDING");
  });

  test("cancelada prevalece sobre pagamento e vencimento", () => {
    expect(statusDaGuia(new Date("2026-10-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"), true, hoje)).toBe("CANCELED");
  });
});

describe("parseValorGuia", () => {
  test("aceita número positivo, inclusive em texto com ponto", () => {
    expect(parseValorGuia(1500.5)).toBe(1500.5);
    expect(parseValorGuia("1500.50")).toBe(1500.5);
  });

  test.each([0, -10, "", null, undefined, "abc", "1.234,56", NaN, Infinity])("rejeita %s", (valor) => {
    expect(parseValorGuia(valor)).toBeNull();
  });

  test.each([true, [7], "1e3", "0x1F", " ", 1e12, "10.005", {}])("rejeita formato solto ou acima do limite do banco: %s", (valor) => {
    expect(parseValorGuia(valor)).toBeNull();
  });

  test("arredonda em centavos", () => {
    expect(parseValorGuia(10.005)).toBe(10.01);
    expect(parseValorGuia(0.001)).toBeNull();
  });
});

describe("dataDePagamentoPlausivel", () => {
  const hoje = new Date("2026-11-18T12:00:00Z");
  test.each(["2022-05-19", "2026-11-18", "2026-12-20", "2015-01-01"])("%s é plausível (baixa antiga de verdade ou agendada)", (d) => {
    expect(dataDePagamentoPlausivel(new Date(`${d}T00:00:00Z`), hoje)).toBe(true);
  });
  test.each(["1900-01-01", "2014-12-31", "2999-12-31", "2027-03-01"])("%s é ano digitado errado: recusada", (d) => {
    expect(dataDePagamentoPlausivel(new Date(`${d}T00:00:00Z`), hoje)).toBe(false);
  });
  test("data inválida é recusada", () => {
    expect(dataDePagamentoPlausivel(new Date("abc"), hoje)).toBe(false);
  });
});

describe("observacoesDaBaixa", () => {
  const dia = new Date("2026-10-10T00:00:00Z");

  test("a nota da baixa entra depois das observações que a guia já tinha (não apaga o recibo), com a data da baixa", () => {
    expect(observacoesDaBaixa("Nº Recibo Declaração: 50000525960371", "pago no app", 1500, 1500, dia))
      .toBe("Nº Recibo Declaração: 50000525960371\nBaixa de 10/10/2026: pago no app");
  });
  test("sem nota e sem diferença não muda nada", () => {
    expect(observacoesDaBaixa("recibo 1", undefined, 1500, 1500, dia)).toBeNull();
    expect(observacoesDaBaixa(null, "  ", 1500, 1500.004, dia)).toBeNull();
  });
  test("pago diferente da guia deixa a diferença registrada, com sinal e espaço comum (sem NBSP)", () => {
    const mais = observacoesDaBaixa(null, undefined, 1500, 1600, dia) as string;
    expect(mais).toBe("Baixa de 10/10/2026: Pago R$ 1.600,00 (+R$ 100,00 em relação ao valor da guia)");
    expect(mais).not.toContain("\u00a0");
    expect(observacoesDaBaixa("x", "juros", 1500, 1450, dia)).toBe("x\nBaixa de 10/10/2026: juros · Pago R$ 1.450,00 (-R$ 50,00 em relação ao valor da guia)");
  });
  test("perto do limite de 2000 caracteres: o começo fica intacto e só a linha nova é cortada", () => {
    const base = "Nº Recibo Declaração: 50000525960371" + "a".repeat(1950);
    const r = observacoesDaBaixa(base, "nota bem comprida da baixa que não cabe inteira", 10, 10, dia) as string;
    expect(r.startsWith(base + "\n")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(2000);
    expect(r.endsWith("…")).toBe(true);
  });
  test("observações já no limite: não cabe nada, ficam como estão", () => {
    expect(observacoesDaBaixa("a".repeat(2000), "nota", 10, 10, dia)).toBeNull();
  });
});

describe("observacoesDoEstorno", () => {
  test("registra o estorno depois do que já estava, para a nota da baixa desfeita não parecer valer", () => {
    expect(observacoesDoEstorno("Baixa de 10/10/2026: Pago R$ 1.600,00 (+R$ 100,00 em relação ao valor da guia)", " valor errado ", "2026-11-18"))
      .toBe("Baixa de 10/10/2026: Pago R$ 1.600,00 (+R$ 100,00 em relação ao valor da guia)\nEstorno de 18/11/2026: valor errado");
    expect(observacoesDoEstorno(null, "duplicada", "2026-11-18")).toBe("Estorno de 18/11/2026: duplicada");
  });
});

describe("statusDeGuiaEmAberto (estorno e restauração)", () => {
  const hoje = new Date("2026-10-20T15:00:00Z");
  test("vence hoje continua em aberto; só depois do dia vira vencida", () => {
    expect(statusDeGuiaEmAberto(new Date("2026-10-20T00:00:00Z"), hoje)).toBe("PENDING");
    expect(statusDeGuiaEmAberto(new Date("2026-10-19T00:00:00Z"), hoje)).toBe("OVERDUE");
    expect(statusDeGuiaEmAberto(null, hoje)).toBe("PENDING");
  });
});

describe("lerData", () => {
  test("vazio vira null sem erro", () => {
    expect(lerData(undefined)).toEqual({ ok: true, data: null });
    expect(lerData("")).toEqual({ ok: true, data: null });
  });

  test("data válida vira Date; texto inválido sinaliza erro", () => {
    expect(lerData("2026-10-20")).toEqual({ ok: true, data: new Date("2026-10-20T00:00:00Z") });
    expect(lerData("20/10/2026")).toEqual({ ok: false });
  });
});

describe("diaIso", () => {
  test("usa o dia gravado em UTC, sem deslocar pelo fuso", () => {
    expect(diaIso(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09-01");
    expect(diaIso("2026-09-01T00:00:00.000Z")).toBe("2026-09-01");
  });

  test("ausente ou inválido vira null", () => {
    expect(diaIso(null)).toBeNull();
    expect(diaIso("")).toBeNull();
    expect(diaIso("xx")).toBeNull();
  });
});

describe("resolverUploadImportacao", () => {
  const pasta = path.resolve("uploads");
  const id = "0123456789abcdef0123456789abcdef";

  test("id do multer vira caminho dentro da pasta de uploads", () => {
    expect(resolverUploadImportacao(id, "uploads")).toBe(path.join(pasta, id));
  });

  test.each(["package.json", "../.env", "..\\..\\x", "/etc/passwd", "C:\\Windows\\win.ini", id + "/..", "", undefined, 42])(
    "recusa caminho livre %s",
    (valor) => {
      expect(resolverUploadImportacao(valor, "uploads")).toBeNull();
    }
  );
});

describe("hojeBrasilia", () => {
  test("às 22h de Brasília (01h UTC do dia seguinte) ainda é o mesmo dia", () => {
    expect(hojeBrasilia(new Date("2026-10-21T01:00:00Z"))).toBe("2026-10-20");
  });

  test("a guia que vence hoje não vira vencida à noite", () => {
    expect(statusDaGuia(null, new Date("2026-10-20T00:00:00Z"), false, new Date("2026-10-21T01:00:00Z"))).toBe("PENDING");
    expect(statusDaGuia(null, new Date("2026-10-20T00:00:00Z"), false, new Date("2026-10-21T04:00:00Z"))).toBe("OVERDUE");
  });
});
