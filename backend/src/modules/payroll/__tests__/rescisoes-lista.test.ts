import { describe, expect, test } from "vitest";
import { entraNaLista, itensDaFolhaAposSaida, resumoDaRescisao } from "../rescisoes-lista.js";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("resumoDaRescisao", () => {
  test("sem parcelas devolve null", () => {
    expect(resumoDaRescisao([])).toBeNull();
  });

  test("soma o líquido, conta as pagas e acha o próximo vencimento em aberto", () => {
    const r = resumoDaRescisao([
      { amount: 500, paymentDate: d("2026-09-20"), dueDate: d("2026-09-20") },
      { amount: "250.10", paymentDate: null, dueDate: d("2026-11-20") },
      { amount: 250.1, paymentDate: null, dueDate: d("2026-10-20") },
    ]);
    expect(r).toEqual({ parcelas: 3, pagas: 1, liquido: 1000.2, valorPago: 500, proximoVencimento: "2026-10-20", quitadaNoTermo: null });
  });

  test("quitada no termo: marca a rescisão com o lançamento (para poder desfazer)", () => {
    const r = resumoDaRescisao([
      { id: "q1", amount: 0, paymentDate: d("2026-09-11"), dueDate: d("2026-09-11"), details: { quitadaNoTermo: true } },
    ]);
    expect(r).toMatchObject({ parcelas: 1, pagas: 1, liquido: 0, quitadaNoTermo: { itemId: "q1" } });
  });

  test("rescisão normal não é quitada no termo", () => {
    const r = resumoDaRescisao([{ id: "r1", amount: 10, paymentDate: null, dueDate: d("2026-09-11"), details: { grupoRescisao: "g" } }]);
    expect(r?.quitadaNoTermo).toBeNull();
  });

  test("tudo pago: sem próximo vencimento", () => {
    const r = resumoDaRescisao([{ amount: 300, paymentDate: d("2026-09-20"), dueDate: d("2026-09-18") }]);
    expect(r?.proximoVencimento).toBeNull();
    expect(r?.pagas).toBe(1);
  });
});

describe("entraNaLista", () => {
  const hoje = d("2026-10-01");

  test("saiu nos últimos 90 dias entra", () => {
    expect(entraNaLista({ saida: d("2026-07-05"), hoje, rescisao: null })).toBe(true);
  });

  test("vai sair (data futura) entra", () => {
    expect(entraNaLista({ saida: d("2026-10-15"), hoje, rescisao: null })).toBe(true);
  });

  test("saiu há mais de 90 dias, sem rescisão em aberto, fica de fora", () => {
    expect(entraNaLista({ saida: d("2026-06-01"), hoje, rescisao: null })).toBe(false);
    expect(entraNaLista({ saida: d("2026-06-01"), hoje, rescisao: { parcelas: 2, pagas: 2 } })).toBe(false);
  });

  test("rescisão com parcela em aberto entra, mesmo antiga", () => {
    expect(entraNaLista({ saida: d("2026-03-01"), hoje, rescisao: { parcelas: 3, pagas: 1 } })).toBe(true);
  });

  test("sem data de saída e sem rescisão não entra", () => {
    expect(entraNaLista({ saida: null, hoje, rescisao: null })).toBe(false);
  });
});

describe("itensDaFolhaAposSaida", () => {
  const saida = d("2026-09-12");
  const base = { paymentDate: null, status: "PENDING", details: null, periodLabel: "VT 2ª quinzena", competenceYear: 2026, competenceMonth: 9, amount: 100 };

  test("só o que não foi pago e vence depois da saída", () => {
    const r = itensDaFolhaAposSaida([
      { ...base, id: "a", type: "VALE_TRANSPORTE", dueDate: d("2026-09-15") },
      { ...base, id: "b", type: "VALE_TRANSPORTE", dueDate: d("2026-09-12") },
      { ...base, id: "c", type: "VALE_TRANSPORTE", dueDate: d("2026-09-20"), paymentDate: d("2026-09-14") },
      { ...base, id: "d", type: "VALE_TRANSPORTE", dueDate: d("2026-09-20"), status: "CANCELED" },
    ], saida);
    expect(r.map((i) => i.id)).toEqual(["a"]);
  });

  test("rescisão e férias não entram (têm tela própria)", () => {
    const r = itensDaFolhaAposSaida([
      { ...base, id: "r", type: "RESCISAO", dueDate: d("2026-09-20") },
      { ...base, id: "f", type: "FERIAS", dueDate: d("2026-09-20") },
      { ...base, id: "s", type: "SALARIO", dueDate: d("2026-10-05") },
    ], saida);
    expect(r.map((i) => i.id)).toEqual(["s"]);
  });

  test("marca bilhete mensal e ajuda de custo (ficam com a pessoa) e devolve datas como dia", () => {
    const [m, a, t] = itensDaFolhaAposSaida([
      { ...base, id: "m", type: "VALE_TRANSPORTE", dueDate: d("2026-09-30"), competenceMonth: 10, details: { bilheteUnicoMensal: true } },
      { ...base, id: "a", type: "VALE_TRANSPORTE", dueDate: d("2026-10-01"), competenceMonth: 10, details: { auxilioCombustivel: true } },
      { ...base, id: "t", type: "VALE_TRANSPORTE", dueDate: d("2026-10-02"), details: { diasPagos: [16, 17] } },
    ], saida);
    expect(m).toMatchObject({ id: "m", ficaComAPessoa: "BILHETE_MENSAL", vencimento: "2026-09-30", valor: 100, competencia: "10/2026" });
    expect(a.ficaComAPessoa).toBe("AJUDA_DE_CUSTO");
    expect(t.ficaComAPessoa).toBeNull();
  });

  test("sem saída não há o que listar", () => {
    expect(itensDaFolhaAposSaida([{ ...base, id: "a", type: "VALE_TRANSPORTE", dueDate: d("2026-09-15") }], null)).toEqual([]);
  });
});
