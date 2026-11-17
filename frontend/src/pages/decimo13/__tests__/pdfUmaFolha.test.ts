import { describe, expect, test } from "vitest";
import type { LinhaPagamentoMeio, ListaDecimo13 } from "../../../api/client";
import { montarPdfListaPagamento } from "../../gorjeta/pdfFolhaLiquidos";
import { codigoDaListaDecimo, listaDecimoParaPdf, regrasDaListaDecimo, seloDaListaDecimo } from "../listaPdf";

// A lista do 13º com a mesma forma da real (18 pessoas, 2 empresas + sem registro, avisos nas linhas a lançar). Dados FICTÍCIOS.
const nomes = ["Ana", "Bia", "Caio", "Dani", "Edu", "Fabi", "Gil", "Hana", "Iago", "Joana", "Kleber", "Lia", "Marco", "Nina", "Otto"];
const linha = (i: number, over: Partial<LinhaPagamentoMeio> = {}): LinhaPagamentoMeio => ({
  employeeId: `e${i}`, nome: `${nomes[i % nomes.length]} Fictícia da Silva ${i}`, grupo: i < 3 ? "EMPRESA UM COMERCIO DE ALIMENTOS LTDA" : "EMPRESA DOIS BAR E FORNERIA LTDA",
  origem: "EXTRATO", valor: 1000 + i * 37.5, situacao: "LANCADO", vencimento: "2026-11-30", pagoEm: null, valorPago: null, payrollItemId: `i${i}`,
  pix: i % 4 === 0 ? `pix${i}@teste.com` : null, pixTipo: i % 4 === 0 ? "EMAIL" : null, contaBancaria: null, aviso: null, atualizarPara: null, ...over,
});
const dezoito: LinhaPagamentoMeio[] = [
  ...Array.from({ length: 15 }, (_, i) => linha(i)),
  ...[15, 16, 17].map((i) => linha(i, { grupo: "Sem registro", origem: "SEM_REGISTRO", situacao: "A_LANCAR", aviso: "Ainda não está no Contas a Pagar: vence 30/11." })),
];
const lista = (linhas: LinhaPagamentoMeio[]): ListaDecimo13 => ({
  parcela: 1, ano: 2026, linhas, total: Math.round(linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100, avisos: [],
  aLancar: { pessoas: 3, total: 0 }, lancado: { pessoas: 15, total: 0 }, pago: { pessoas: 0, total: 0 }, aguardandoExtrato: [],
});
const opcoes = (l: ListaDecimo13, umaFolha: boolean) => ({
  titulo: "13º salário - 1ª parcela - lista de pagamento", apoio: "Competência Novembro/2026   |   vencimento 30/11/2026",
  codigo: codigoDaListaDecimo(2026, 1), selo: seloDaListaDecimo(l), regras: regrasDaListaDecimo(1, []),
  rotuloValor: "Valor", rotuloTotal: "Total a pagar",
  subtituloGrupo: (g: string) => (g === "Sem registro" ? "valor calculado pelo sistema" : "valor do título: extrato da contabilidade, mais o combinado ou o período sem registro quando há"),
  rodape: "13º salário 1ª parcela 2026", arquivo: "x.pdf", modo: "empresa" as const, umaFolha,
});

describe("PDF do 13º numa folha só", () => {
  test("sem o ajuste, a lista de 18 pessoas passa de uma página (é o problema que o ajuste resolve)", async () => {
    const l = lista(dezoito);
    const doc = await montarPdfListaPagamento(listaDecimoParaPdf(l), opcoes(l, false));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  test("com o ajuste, a mesma lista sai em UMA página", async () => {
    const l = lista(dezoito);
    const doc = await montarPdfListaPagamento(listaDecimoParaPdf(l), opcoes(l, true));
    expect(doc.getNumberOfPages()).toBe(1);
  });

  test("uma lista pequena continua com o desenho normal (não aperta à toa)", async () => {
    const l = lista(dezoito.slice(0, 4));
    const normal = await montarPdfListaPagamento(listaDecimoParaPdf(l), opcoes(l, false));
    const ajustada = await montarPdfListaPagamento(listaDecimoParaPdf(l), opcoes(l, true));
    expect(ajustada.getNumberOfPages()).toBe(1);
    const bytes = (d: unknown) => (d as { output: (t: string) => ArrayBuffer }).output("arraybuffer").byteLength;
    expect(bytes(ajustada)).toBe(bytes(normal));
  });
});
