import { describe, expect, test } from "vitest";
import type { ApuracaoRescisao, DetalheRescisao, ItemFolhaAposSaida } from "../../../../api/client";
import { pendenciasDaRescisao } from "../pendencias";

const apuracao = (over: Partial<ApuracaoRescisao> = {}): ApuracaoRescisao => ({
  saida: "2026-09-12", semRegistro: true,
  vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
  vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
  gorjeta: { periodo: "Gorjeta 26/08–25/09", status: "OPEN", pontos: 2, valorPonto: 90, gorjeta: 180, pendente: false, diasSalario: 12, salarioProporcional: 880 },
  gorjetaObservacao: null,
  sugestao: { salario: 880, gorjeta: 180, creditos: 0, vales: 0, valesRotulo: null, vtDesconto: 0, bruto: 1060 },
  ...over,
});

const detalhe = (over: Partial<DetalheRescisao> = {}, pessoa: Partial<DetalheRescisao["pessoa"]> = {}): DetalheRescisao => ({
  pessoa: {
    employeeId: "e1", nome: "Ana Silva", apelido: null, empresa: "Pateo", semRegistro: true,
    saida: "2026-09-12", motivo: null, rescisao: null, termo: null, ...pessoa,
  },
  itensAposSaida: [],
  periodoGorjeta: { year: 2026, month: 9, label: "Gorjeta 26/08–25/09", fechado: false, participa: true },
  extratoDoMes: { competencia: "09/2026", importado: true, pessoaNoExtrato: true },
  ...over,
});

const item = (over: Partial<ItemFolhaAposSaida>): ItemFolhaAposSaida => ({
  id: "i1", tipo: "VALE_TRANSPORTE", rotulo: "VT 2ª quinzena", competencia: "09/2026", valor: 120, vencimento: "2026-09-15", ficaComAPessoa: null, ...over,
});

const ids = (l: ReturnType<typeof pendenciasDaRescisao>) => l.map((p) => p.id);

describe("pendenciasDaRescisao", () => {
  test("sem nada pendente devolve lista vazia", () => {
    expect(pendenciasDaRescisao({ detalhe: detalhe(), apuracao: apuracao() })).toEqual([]);
  });

  test("sem data de saída: só a pendência de registrar a saída", () => {
    const l = pendenciasDaRescisao({ detalhe: detalhe({}, { saida: null }), apuracao: null });
    expect(ids(l)).toEqual(["saida"]);
    expect(l[0]).toMatchObject({ tom: "acao", acao: { tipo: "passo", passo: 1 } });
  });

  test("VT por trajeto depois da saída: excluir, com o motivo sugerido", () => {
    const [p] = pendenciasDaRescisao({ detalhe: detalhe({ itensAposSaida: [item({})] }), apuracao: apuracao() });
    expect(p).toMatchObject({ id: "folha-i1", tom: "acao", acao: { tipo: "excluir", itemId: "i1" } });
    expect(p.oQueFazer).toMatch(/Exclua/);
    expect(p.acao?.tipo === "excluir" && p.acao.motivoSugerido).toMatch(/saída em 12\/09\/2026/);
  });

  test.each([["BILHETE_MENSAL", /Bilhete mensal/], ["AJUDA_DE_CUSTO", /Ajuda de custo/]] as const)(
    "%s do mês da saída fica com a pessoa: aparece como ok, sem botão de excluir",
    (fica, texto) => {
      const [p] = pendenciasDaRescisao({ detalhe: detalhe({ itensAposSaida: [item({ ficaComAPessoa: fica, competencia: "09/2026" })] }), apuracao: apuracao() });
      expect(p.tom).toBe("ok");
      expect(p.titulo).toMatch(texto);
      expect(p.acao).toBeUndefined();
    },
  );

  test.each(["BILHETE_MENSAL", "AJUDA_DE_CUSTO"] as const)("%s de um mês inteiro depois da saída: sugere excluir", (fica) => {
    const [p] = pendenciasDaRescisao({ detalhe: detalhe({ itensAposSaida: [item({ ficaComAPessoa: fica, competencia: "10/2026", vencimento: "2026-09-30" })] }), apuracao: apuracao() });
    expect(p.tom).toBe("acao");
    expect(p.acao).toMatchObject({ tipo: "excluir", itemId: "i1" });
    expect(p.titulo).toMatch(/10\/2026/);
  });

  test("salário do mês da saída ainda na Folha: excluir para não pagar duas vezes", () => {
    const [p] = pendenciasDaRescisao({
      detalhe: detalhe({ itensAposSaida: [item({ id: "s1", tipo: "SALARIO", rotulo: "Salário", competencia: "09/2026", vencimento: "2026-10-05" })] }),
      apuracao: apuracao(),
    });
    expect(p).toMatchObject({ tom: "acao", acao: { tipo: "excluir", itemId: "s1" } });
    expect(p.oQueFazer).toMatch(/duas vezes/);
  });

  test("salário de mês anterior à saída é devido: fica, sem botão", () => {
    const [p] = pendenciasDaRescisao({
      detalhe: detalhe({ itensAposSaida: [item({ id: "s0", tipo: "SALARIO", rotulo: "Salário", competencia: "08/2026", vencimento: "2026-09-15" })] }),
      apuracao: apuracao(),
    });
    expect(p.tom).toBe("ok");
    expect(p.acao).toBeUndefined();
  });

  test("vales em aberto (sem registro): entram no desconto, com link para a aba Vales", () => {
    const a = apuracao({ vales: { itens: [{ codigo: "VALE-1", data: "2026-09-05", tipo: "VALE", descricao: null, valor: 50 }, { codigo: "CRED-1", data: null, tipo: "CREDITO", descricao: null, valor: 10 }], descontos: 50, creditos: 10, liquido: -40, entraNaRescisao: true } });
    const [p] = pendenciasDaRescisao({ detalhe: detalhe(), apuracao: a });
    expect(p).toMatchObject({ id: "vales", tom: "aviso", acao: { tipo: "link", para: "/rh/gorjeta" } });
    expect(p.titulo).toMatch(/1 vale/);
    expect(p.oQueFazer).toMatch(/desconto/);
  });

  test("vales de CLT: só conferência (já foram à contabilidade)", () => {
    const a = apuracao({ semRegistro: false, vales: { itens: [{ codigo: "VALE-1", data: null, tipo: "VALE", descricao: null, valor: 50 }], descontos: 50, creditos: 0, liquido: -50, entraNaRescisao: false } });
    const l = pendenciasDaRescisao({ detalhe: detalhe({}, { semRegistro: false, termo: { arquivo: "t.pdf", importadoEm: null, gorjeta: 1, liquido: null, pagamento: null } }), apuracao: a });
    expect(l.find((p) => p.id === "vales")?.tom).toBe("ok");
  });

  test("já pago na lista fechada: bloqueia o lançamento", () => {
    const [p] = pendenciasDaRescisao({ detalhe: detalhe(), apuracao: apuracao({ jaPagoNaLista: { valor: 900, competencia: "09/2026" } }) });
    expect(p).toMatchObject({ id: "ja-pago", tom: "acao" });
    expect(p.oQueFazer).toMatch(/Não lance/);
  });

  test("período de gorjeta seguinte inexistente: abrir na Apuração de gorjeta", () => {
    const a = apuracao({
      gorjetaPartes: [
        { periodo: "Gorjeta 26/08–25/09", competencia: "09/2026", dias: "26/08 a 25/09", valor: 180, pendente: false, jaPagoNaLista: false },
        { periodo: "Gorjeta de 10/2026", competencia: "10/2026", dias: "26/09 a 29/09", valor: null, pendente: false, jaPagoNaLista: false },
      ],
    });
    const [p] = pendenciasDaRescisao({ detalhe: detalhe(), apuracao: a });
    expect(p).toMatchObject({ id: "gorjeta-10/2026", tom: "acao", acao: { tipo: "link", para: "/rh/gorjeta" } });
    expect(p.titulo).toMatch(/10\/2026/);
  });

  test("gorjeta pendente de faturamento: aviso", () => {
    const g = apuracao().gorjeta!;
    const [p] = pendenciasDaRescisao({ detalhe: detalhe(), apuracao: apuracao({ gorjeta: { ...g, pendente: true }, gorjetaObservacao: "falta o serviço" }) });
    expect(p).toMatchObject({ id: "gorjeta-pendente", tom: "aviso" });
  });

  test("sem período de gorjeta com a saída: aviso com a observação da apuração", () => {
    const [p] = pendenciasDaRescisao({ detalhe: detalhe({ periodoGorjeta: null }), apuracao: apuracao({ gorjeta: null, gorjetaObservacao: "Não há período de gorjeta aberto que contenha a data de saída." }) });
    expect(p).toMatchObject({ id: "gorjeta-sem-periodo", tom: "aviso" });
    expect(p.detalhe).toMatch(/Não há período/);
  });

  test("CLT: termo não importado (voltar ao passo 2) e folha do mês não importada (Retorno do RH)", () => {
    const l = pendenciasDaRescisao({
      detalhe: detalhe({ extratoDoMes: { competencia: "09/2026", importado: false, pessoaNoExtrato: false } }, { semRegistro: false }),
      apuracao: apuracao({ semRegistro: false }),
    });
    expect(ids(l)).toEqual(["termo", "extrato"]);
    expect(l[0].acao).toEqual({ tipo: "passo", passo: 2, rotulo: "Importar o termo" });
    expect(l[1]).toMatchObject({ tom: "aviso", acao: { tipo: "link", para: "/rh/retorno" } });
  });

  test("CLT quitada no termo: não pede termo nem gorjeta para lançar; o resto continua", () => {
    const quitada = { parcelas: 1, pagas: 1, liquido: 0, valorPago: 0, proximoVencimento: null, quitadaNoTermo: { itemId: "q1" } };
    const l = pendenciasDaRescisao({
      detalhe: detalhe(
        { periodoGorjeta: null, itensAposSaida: [item({})], extratoDoMes: { competencia: "09/2026", importado: false, pessoaNoExtrato: false } },
        { semRegistro: false, rescisao: quitada, termo: null },
      ),
      apuracao: apuracao({ semRegistro: false, gorjeta: null, gorjetaObservacao: "Fora da apuração." }),
    });
    expect(ids(l)).toEqual(["folha-i1", "extrato"]);
  });

  test("quitada sem valor: concluída, não pede termo nem gorjeta; o resto continua", () => {
    const quitada = {
      parcelas: 1, pagas: 1, liquido: 0, valorPago: 0, proximoVencimento: null, quitadaNoTermo: null,
      quitadaSemValor: { itemId: "z1", saldoDevedorPerdoado: 50 },
    };
    const semRegistro = pendenciasDaRescisao({
      detalhe: detalhe({ periodoGorjeta: null, itensAposSaida: [item({})] }, { rescisao: quitada }),
      apuracao: apuracao({ gorjeta: null, gorjetaObservacao: "Fora da apuração." }),
    });
    expect(ids(semRegistro)).toEqual(["folha-i1"]);
    const clt = pendenciasDaRescisao({
      detalhe: detalhe({ periodoGorjeta: null }, { semRegistro: false, rescisao: quitada, termo: null }),
      apuracao: apuracao({ semRegistro: false, gorjeta: null }),
    });
    expect(ids(clt)).not.toContain("termo");
  });

  test("sem registro não pede extrato nem termo", () => {
    const l = pendenciasDaRescisao({ detalhe: detalhe({ extratoDoMes: { competencia: "09/2026", importado: false, pessoaNoExtrato: false } }), apuracao: apuracao() });
    expect(l).toEqual([]);
  });

  test("VT sem a lista de dias: conferir à mão", () => {
    const a = apuracao({ vt: { total: 0, dias: [], semDetalhe: ["VT julho"], observacao: null } });
    const [p] = pendenciasDaRescisao({ detalhe: detalhe(), apuracao: a });
    expect(p).toMatchObject({ id: "vt-sem-detalhe", tom: "aviso" });
  });

  test("ordem: o que precisa de ação vem antes dos avisos e do que está ok", () => {
    const a = apuracao({ vt: { total: 0, dias: [], semDetalhe: ["VT julho"], observacao: null } });
    const l = pendenciasDaRescisao({
      detalhe: detalhe({ itensAposSaida: [item({ ficaComAPessoa: "BILHETE_MENSAL", id: "m" }), item({ id: "v" })] }),
      apuracao: a,
    });
    expect(l.map((p) => p.tom)).toEqual(["acao", "aviso", "ok"]);
  });
});
