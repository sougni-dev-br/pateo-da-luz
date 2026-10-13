import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { agruparPorDia } from "../agile-sync.service.js";
import { agileSyncPayloadSchema, type AgileSyncPayload } from "../agile-sync.types.js";
import { montarCancelamentos, type VendaAnalise } from "../agile-analise.report.js";
import { classificarSituacao, ehCancelada, ehRecebida, SITUACAO_CANCELADA, SITUACAO_RECEBIDA } from "../agile-situacao.js";

// Uma unica definicao de "recebida" e "cancelada" para o sync, as consultas e o relatorio. O valor
// tem que ser IDENTICO ao que o PDV grava e ao que as consultas ao banco comparam (igualdade
// exata), senao a mesma venda e contada de um jeito na tela e de outro no filtro.

describe("constantes e predicados", () => {
  test("os valores sao os que o PDV grava", () => {
    expect(SITUACAO_RECEBIDA).toBe("RECEBIDA");
    expect(SITUACAO_CANCELADA).toBe("CANCELADA");
  });

  test.each([
    ["RECEBIDA", true, false],
    ["CANCELADA", false, true],
    ["EM ABERTO", false, false],
    ["CONSUMINDO", false, false],
    ["EM ABERTO/CONSUMINDO", false, false],
    ["recebida", false, false],
    [" RECEBIDA", false, false],
    ["", false, false],
    [null, false, false],
    [undefined, false, false]
  ])("%j -> recebida=%s cancelada=%s", (situacao, recebida, cancelada) => {
    expect(ehRecebida(situacao)).toBe(recebida);
    expect(ehCancelada(situacao)).toBe(cancelada);
  });

  test("nenhum valor e recebida e cancelada ao mesmo tempo", () => {
    for (const s of ["RECEBIDA", "CANCELADA", "EM ABERTO", "", null, undefined]) {
      expect(ehRecebida(s) && ehCancelada(s)).toBe(false);
    }
  });

  test("classificarSituacao separa as tres familias", () => {
    expect(classificarSituacao("RECEBIDA")).toBe("RECEBIDA");
    expect(classificarSituacao("CANCELADA")).toBe("CANCELADA");
    expect(classificarSituacao("EM ABERTO")).toBe("OUTRA");
    expect(classificarSituacao(null)).toBe("OUTRA");
  });
});

const venda = (over: Partial<VendaAnalise> = {}): VendaAnalise => ({
  saleId: "1", movementDate: new Date("2026-10-01T12:00:00Z"), shift: "Almoço", saleStatus: "RECEBIDA", saleHour: "13:10",
  people: 2, totalAmount: 100, cancelledBy: null, cancelReason: null, ...over
});
const periodo = { inicio: "2026-10-01", fim: "2026-10-01" };

describe("relatorio de cancelamentos: comanda em aberto nao e cancelada nem faturada", () => {
  test("so RECEBIDA entra no faturado e so CANCELADA entra nos cancelamentos", () => {
    const r = montarCancelamentos(
      [
        venda({ saleId: "a" }),
        venda({ saleId: "b", saleStatus: "CANCELADA", totalAmount: 50, cancelledBy: "Ana" }),
        venda({ saleId: "c", saleStatus: "EM ABERTO", totalAmount: 400 })
      ],
      periodo
    );
    expect(r.resumo).toMatchObject({ vendas: 2, canceladas: 1, valorCancelado: 50, valorFaturado: 100 });
    expect(r.porPessoa.map((p) => p.pessoa)).toEqual(["Ana"]);
    expect(r.maiores.map((m) => m.saleId)).toEqual(["b"]);
  });

  test("a comanda em aberto tambem fica fora dos denominadores por turno, hora e dia", () => {
    const r = montarCancelamentos(
      [venda({ saleId: "a" }), venda({ saleId: "b", saleStatus: "CANCELADA" }), venda({ saleId: "c", saleStatus: "CONSUMINDO" })],
      periodo
    );
    expect(r.porTurno[0]).toMatchObject({ vendas: 2, canceladas: 1 });
    expect(r.porHora[0]).toMatchObject({ vendas: 2, canceladas: 1 });
    expect(r.porDia[0]).toMatchObject({ vendas: 2, canceladas: 1 });
    expect(r.cobertura.vendasComDetalhe).toBe(2);
  });

  test("so comandas em aberto: relatorio vazio, sem divisao por zero", () => {
    const r = montarCancelamentos([venda({ saleStatus: "EM ABERTO" })], periodo);
    expect(r.resumo).toMatchObject({ vendas: 0, canceladas: 0, valorFaturado: 0, taxaCancelamento: 0 });
  });
});

function payload(over: Partial<AgileSyncPayload> = {}): AgileSyncPayload {
  return agileSyncPayloadSchema.parse({ periodoInicio: "2026-10-12", periodoFim: "2026-10-12", vendas: [], pagamentos: [], itens: [], ...over });
}
const vendaCsv = (nr: string, situacao: string) => ({
  nrseqvenda: nr, dt_movimento: "2026-10-12", turno: "Almoço", situacao_da_venda: situacao,
  qtd_pessoas: 2, vl_total: 100, vl_servico_inf: 10
});
const pagamentoCsv = (nr: string, situacao: string) => ({
  nrseqvenda: nr, nrseqpgto: `${nr}-1`, dt_movimento: "2026-10-12", turno: "Almoço",
  situacao_da_venda: situacao, meio_pagamento: "PIX", vl_recebido: 100
});

describe("sync: agregacao por dia usa a mesma definicao", () => {
  test("RECEBIDA fatura, CANCELADA conta como ignorada, comanda em aberto nao e nenhuma das duas", () => {
    const { dias } = agruparPorDia(payload({
      vendas: [vendaCsv("1", "RECEBIDA"), vendaCsv("2", "CANCELADA"), vendaCsv("3", "EM ABERTO")],
      pagamentos: [pagamentoCsv("1", "RECEBIDA"), pagamentoCsv("2", "CANCELADA"), pagamentoCsv("3", "EM ABERTO")]
    }));
    const dia = dias.get("2026-10-12")!;
    expect([...dia.vendasRecebidas.keys()]).toEqual(["1"]);
    expect(dia.vendasCanceladas).toBe(1);
    expect(dia.pagamentos).toHaveLength(1);
  });
});

describe("guarda: ninguem escreve o literal da situacao fora de agile-situacao.ts", () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const pastas = [join(aqui, ".."), join(aqui, "..", "..", "..", "events")];
  const arquivos = pastas.flatMap((pasta) =>
    readdirSync(pasta)
      .filter((f) => f.endsWith(".ts") && f !== "agile-situacao.ts")
      .map((f) => join(pasta, f))
  );

  test("varre as pastas do Agile e de eventos", () => {
    expect(arquivos.length).toBeGreaterThan(10);
  });

  test("nenhum codigo (fora de comentario de linha) usa o literal", () => {
    const achados: string[] = [];
    for (const arquivo of arquivos) {
      readFileSync(arquivo, "utf-8").split(/\r?\n/).forEach((linha, i) => {
        const codigo = linha.split("//")[0];
        if (/["'`](RECEBIDA|CANCELADA)["'`]/.test(codigo)) achados.push(`${arquivo}:${i + 1}`);
      });
    }
    expect(achados).toEqual([]);
  });
});
