import { describe, expect, test } from "vitest";
import { formatarDiaDaGuia, formatarMesAno, hojeIso, resumoDaGuia, situacaoDaGuia } from "../guia-imposto";

describe("datas da guia", () => {
  test("mostra o dia gravado, sem recuar um dia pelo fuso", () => {
    expect(formatarDiaDaGuia("2026-09-01T00:00:00.000Z")).toBe("01/09/2026");
    expect(formatarMesAno("2026-09-01T00:00:00.000Z")).toBe("09/2026");
  });

  test("vazio ou inválido vira travessão", () => {
    expect(formatarDiaDaGuia(null)).toBe("—");
    expect(formatarDiaDaGuia("xx")).toBe("—");
    expect(formatarMesAno(undefined)).toBe("—");
  });

  test("hojeIso usa o dia do relógio de quem usa a tela", () => {
    expect(hojeIso(new Date(2026, 9, 5, 23, 30))).toBe("2026-10-05");
  });
});

describe("situacaoDaGuia", () => {
  const base = { paymentDate: null, dueDate: "2026-10-20T00:00:00.000Z", status: "PENDING" };

  test("vence hoje ainda está em dia; no dia seguinte está vencida", () => {
    expect(situacaoDaGuia(base, "2026-10-20")).toBe("PENDING");
    expect(situacaoDaGuia(base, "2026-10-21")).toBe("OVERDUE");
  });

  test("com pagamento é paga, mesmo vencida", () => {
    expect(situacaoDaGuia({ ...base, paymentDate: "2026-10-30T00:00:00.000Z" }, "2026-11-01")).toBe("PAID");
  });

  test("cancelada prevalece sobre vencimento e pagamento", () => {
    expect(situacaoDaGuia({ ...base, status: "CANCELED" }, "2027-01-01")).toBe("CANCELED");
    expect(situacaoDaGuia({ ...base, status: "CANCELED", paymentDate: "2026-10-01T00:00:00.000Z" }, "2026-10-02")).toBe("CANCELED");
  });

  test("o status OVERDUE gravado não vale: guia ainda a vencer não é vencida", () => {
    expect(situacaoDaGuia({ ...base, status: "OVERDUE" }, "2026-10-01")).toBe("PENDING");
  });
});

describe("resumoDaGuia", () => {
  test("diz o valor, o vencimento, que vai para Contas a Pagar e onde entra no DRE", () => {
    const linhas = resumoDaGuia({ amount: "4312.9", dueDate: "2026-10-20", competenceDate: "2026-09-01", categoriaNome: "Simples Nacional" });
    expect(linhas[0]).toMatch(/Conta a pagar de R\$\s?4\.312,90, vencendo em 20\/10\/2026.*Contas a Pagar/);
    expect(linhas[1]).toBe("DRE de 09/2026, em Simples Nacional.");
  });

  test("sem categoria avisa que cai em Não categorizadas", () => {
    const linhas = resumoDaGuia({ amount: "100", dueDate: "2026-10-20", competenceDate: "2026-09-01", categoriaNome: null });
    expect(linhas[1]).toMatch(/Não categorizadas/);
  });

  test("sem competência avisa que a guia fica fora do DRE", () => {
    const linhas = resumoDaGuia({ amount: "100", dueDate: "2026-10-20", competenceDate: "", categoriaNome: null });
    expect(linhas[linhas.length - 1]).toMatch(/não entra no DRE/);
  });

  test("sem valor ou vencimento válidos não promete conta a pagar", () => {
    const linhas = resumoDaGuia({ amount: "", dueDate: "", competenceDate: "2026-09-01", categoriaNome: null });
    expect(linhas.some((l) => l.includes("Conta a pagar"))).toBe(false);
  });
});
