// PDF da folha salarial líquidos: a lista que se leva para pagar no banco. Um bloco por
// empresa (e o dos sem registro), o líquido logo depois do nome, os dados bancários ao lado
// e uma caixinha para marcar o que já foi pago. Total geral, regras, já pagos e conferência.
import type { TipFolhaLiquidos, TipLinhaFolha } from "../../api/client";
import { SEM_DADOS_BANCARIOS, linhasDadosBancarios } from "./dadosBancarios";
import { nomeNoEnvio, textoPdf } from "./envioContabilidade";
import { MONTHS, fmtDate, money } from "./gorjetaUtils";
import {
  AMBAR, type AutoTable, BEGE, CINZA, type Doc, LINHA, LISTRA, M, MARROM, TINTA, cabecalhoPdf, caixasResumo, faixaTotal, rodapePdf,
} from "./pdfTema";

const reais = (v: number) => textoPdf(money(v));
const soma = (ls: TipLinhaFolha[]) => Math.round(ls.reduce((a, l) => a + l.valor, 0) * 100) / 100;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const REGRAS = [
  "CLT: líquido do extrato da contabilidade.",
  "* Salário combinado: (salário combinado - adiantamento) + gorjeta integral.",
  "Sem registro: salário dos dias trabalhados - adiantamento ou 1ª quinzena já pagos + gorjeta - vales + hora extra/noturno.",
];

type Celula = { text: string[]; styles: Record<string, unknown> };
type CelulaDesenho = { x: number; y: number; width: number; height: number };

export type ModoImpressaoFolha = "empresa" | "alfabetica";

/** Colunas que quem imprime pode tirar do PDF; nome e líquido sempre saem. */
export type ColunaOpcionalPdf = "empresa" | "banco" | "pago";
export const COLUNAS_OPCIONAIS_PDF: Array<{ chave: ColunaOpcionalPdf; rotulo: string }> = [
  { chave: "banco", rotulo: "Dados bancários" },
  { chave: "pago", rotulo: "Pago (caixinha)" },
  { chave: "empresa", rotulo: "Empresa (modo Pateo)" },
];

type Coluna = "nome" | "valor" | ColunaOpcionalPdf;
const TITULO: Record<Coluna, string> = { nome: "Funcionário", empresa: "Empresa", valor: "Líquido", banco: "Dados bancários", pago: "Pago" };

type Bloco = { titulo: string; subtitulo: string; comEmpresa: boolean; rotuloSubtotal: string };

/** As colunas de um bloco, na ordem: o líquido sempre logo depois do nome (e da empresa). */
export function colunasDoBloco(comEmpresa: boolean, ocultas: ReadonlySet<string>): Coluna[] {
  return [
    "nome",
    ...(comEmpresa && !ocultas.has("empresa") ? ["empresa" as const] : []),
    "valor",
    ...(!ocultas.has("banco") ? ["banco" as const] : []),
    ...(!ocultas.has("pago") ? ["pago" as const] : []),
  ];
}

/** "PATEO FREI CANECA BAR E FORNERIA LTDA" → "Pateo Frei Caneca": o nome até a atividade ou o tipo societário. */
export function empresaCurta(grupo: string): string {
  if (grupo === "Sem registro") return grupo;
  const palavras = grupo.trim().split(/\s+/);
  const corte = palavras.findIndex((p, i) => i > 0 && /^(COMERCIO|COMÉRCIO|BAR|RESTAURANTE|LTDA|ME|EIRELI|S\/?A|SERVICOS|SERVIÇOS)$/i.test(p));
  return nomeNoEnvio((corte > 0 ? palavras.slice(0, corte) : palavras).join(" "));
}

/** Modo Pateo: todos juntos, pelo nome (sem acento e sem caixa). */
export function ordemAlfabetica(linhas: TipLinhaFolha[]): TipLinhaFolha[] {
  return [...linhas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
}

export async function gerarPdfFolhaLiquidos(
  folha: TipFolhaLiquidos,
  opcoes: { year: number; month: number; liberada: boolean; modo: ModoImpressaoFolha; ocultas?: ReadonlySet<string> },
) {
  const ocultas = opcoes.ocultas ?? new Set<string>();
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as unknown as AutoTable;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as unknown as Doc;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const mes = MONTHS[opcoes.month - 1];
  const competencia = `${mes.charAt(0).toUpperCase()}${mes.slice(1).toLowerCase()}/${opcoes.year}`;
  const emitido = new Date();

  cabecalhoPdf(doc, {
    titulo: "Folha salarial - líquidos a pagar",
    apoio: `Competência ${competencia}   |   ${folha.label}`,
    codigo: folha.code,
    selo: opcoes.liberada ? { texto: "LIBERADA PARA PAGAMENTO", tom: "ok" } : { texto: "PRÉVIA - FALTA O OK DA CONTABILIDADE", tom: "aviso" },
  });

  const semRegistro = folha.linhas.filter((l) => l.origem === "SEM_REGISTRO");
  const clt = folha.linhas.filter((l) => l.origem !== "SEM_REGISTRO");
  const semDados = folha.linhas.filter((l) => linhasDadosBancarios(l).length === 0).length;
  let y = caixasResumo(doc, 33, [
    ["Total a pagar", reais(folha.total), 1.5],
    ["Pessoas", String(folha.linhas.length), 0.7],
    ["CLT", reais(soma(clt)), 1.1],
    ["Sem registro", reais(soma(semRegistro)), 1.1],
  ]);
  if (semDados > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...AMBAR);
    doc.text(textoPdf(`${semDados === folha.linhas.length ? "Ninguém tem" : `${plural(semDados, "pessoa", "pessoas")} sem`} PIX ou conta no cadastro: confira antes de pagar.`), M, y + 5);
    y += 4;
  }
  y += 10;

  // Uma tabela por bloco: por empresa (com subtotal de cada) ou, no modo Pateo, todos juntos em ordem alfabética.
  const desenharBloco = (lista: TipLinhaFolha[], bloco: Bloco) => {
    const cols = colunasDoBloco(bloco.comEmpresa, ocultas);
    const C = Object.fromEntries(cols.map((c, i) => [c, i])) as Partial<Record<Coluna, number>>;
    const comEmpresa = C.empresa != null;
    // Largura do aviso embaixo do nome: a coluna do nome é mais estreita quando há a da empresa.
    const larguraAviso = comEmpresa ? 44 : 70;
    const celula = (c: Coluna, l: TipLinhaFolha) => {
      if (c === "nome") return nomeNoEnvio(l.nome) + (l.origem === "SALARIO_COMBINADO" ? " *" : "");
      if (c === "empresa") return textoPdf(empresaCurta(l.grupo));
      if (c === "valor") return reais(l.valor);
      if (c === "banco") return textoPdf(linhasDadosBancarios(l).join("\n") || SEM_DADOS_BANCARIOS);
      return "";
    };
    const ESTILO: Record<Coluna, Record<string, unknown>> = {
      nome: { cellWidth: "auto" },
      empresa: { cellWidth: 26, fontSize: 8, textColor: [...CINZA] },
      valor: { cellWidth: 28, halign: "right", fontStyle: "bold" },
      banco: { cellWidth: comEmpresa ? 64 : 72, fontSize: 8 },
      pago: { cellWidth: 12, halign: "center" },
    };
    if (y > H - 60) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...TINTA);
    doc.text(textoPdf(bloco.titulo), M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...CINZA);
    doc.text(textoPdf(`${plural(lista.length, "pessoa", "pessoas")}   |   ${bloco.subtitulo}`), M, y + 4.5);

    autoTable(doc, {
      startY: y + 7,
      margin: { left: M, right: M, top: 18, bottom: 22 },
      theme: "plain",
      showFoot: "lastPage",
      rowPageBreak: "avoid",
      styles: { font: "helvetica", fontSize: 9, textColor: [...TINTA], cellPadding: { top: 1.8, bottom: 1.8, left: 2.5, right: 2.5 }, valign: "middle" },
      headStyles: { fillColor: [...MARROM], textColor: 255, fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [...BEGE], textColor: [...TINTA], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [...LISTRA] },
      head: [cols.map((c) => TITULO[c])],
      body: lista.map((l) => cols.map((c) => celula(c, l))),
      foot: [cols.map((c) => (c === "nome" ? textoPdf(bloco.rotuloSubtotal) : c === "valor" ? reais(soma(lista)) : ""))],
      columnStyles: Object.fromEntries(cols.map((c, i) => [i, ESTILO[c]])),
      didParseCell: (d: { section: string; row: { index: number }; column: { index: number }; cell: Celula }) => {
        if (d.section === "head" && d.column.index === C.valor) d.cell.styles.halign = "right";
        if (d.section === "head" && d.column.index === C.pago) d.cell.styles.halign = "center";
        if (d.section === "foot" && d.column.index === C.valor) d.cell.styles.halign = "right";
        if (d.section !== "body") return;
        const l = lista[d.row.index];
        if (d.column.index === C.banco && linhasDadosBancarios(l).length === 0) d.cell.styles.textColor = [...AMBAR];
        // Aviso da linha (pago a menos, acerto ajustado, vínculo a confirmar) vai embaixo do nome, em cinza.
        if (d.column.index === 0 && l.aviso) {
          d.cell.styles.valign = "top";
          d.cell.styles.minCellHeight = 7.4 + doc.splitTextToSize(textoPdf(l.aviso), larguraAviso).length * 3.2;
        }
      },
      didDrawCell: (d: { section: string; row: { index: number }; column: { index: number }; cell: CelulaDesenho }) => {
        if (d.section === "foot") {
          doc.setDrawColor(...MARROM);
          doc.setLineWidth(0.4);
          doc.line(d.cell.x, d.cell.y, d.cell.x + d.cell.width, d.cell.y);
          return;
        }
        if (d.section !== "body") return;
        doc.setDrawColor(...LINHA);
        doc.setLineWidth(0.2);
        doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
        const l = lista[d.row.index];
        if (d.column.index === 0 && l.aviso) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.2);
          doc.setTextColor(...AMBAR);
          doc.text(doc.splitTextToSize(textoPdf(l.aviso), larguraAviso), d.cell.x + 2.5, d.cell.y + 8.2);
        }
        // Caixinha para marcar à caneta o que já foi pago.
        if (d.column.index === C.pago) {
          doc.setDrawColor(...CINZA);
          doc.setLineWidth(0.3);
          doc.rect(d.cell.x + d.cell.width / 2 - 2, d.cell.y + d.cell.height / 2 - 2, 4, 4);
        }
      },
    });
    y = doc.lastAutoTable.finalY + 9;
  };

  if (opcoes.modo === "alfabetica") {
    desenharBloco(ordemAlfabetica(folha.linhas), {
      titulo: "Todos os funcionários", subtitulo: "em ordem alfabética", comEmpresa: true, rotuloSubtotal: "Total",
    });
  } else {
    for (const grupo of [...new Set(folha.linhas.map((l) => l.grupo))]) {
      const semReg = grupo === "Sem registro";
      desenharBloco(folha.linhas.filter((l) => l.grupo === grupo), {
        titulo: grupo, subtitulo: semReg ? "valor pela apuração da gorjeta" : "valor pelo extrato da contabilidade",
        comEmpresa: false, rotuloSubtotal: semReg ? "Subtotal sem registro" : "Subtotal",
      });
    }
  }

  if (y > H - 60) { doc.addPage(); y = 20; }
  faixaTotal(doc, y, `Total a pagar   (${plural(folha.linhas.length, "pessoa", "pessoas")})`, reais(folha.total));
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CINZA);
  for (const regra of REGRAS) {
    const partes = doc.splitTextToSize(textoPdf(regra), W - 2 * M);
    doc.text(partes, M, y);
    y += partes.length * 3.8;
  }

  const jaPagos = folha.jaPagos ?? [];
  if (jaPagos.length > 0) {
    y += 3;
    if (y > H - 40) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...TINTA);
    doc.text(textoPdf("Já pagos (fora desta lista e do total)"), M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    for (const p of jaPagos) {
      y += 4;
      doc.text(textoPdf(`${nomeNoEnvio(p.nome)}  ${money(p.valor)}  em ${fmtDate(p.pagoEm)}`), M + 3, y);
    }
  }

  // Quem pagou assina; a data é a do dia, preenchida pelo sistema.
  y += 16;
  if (y > H - 24) { doc.addPage(); y = 30; }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TINTA);
  doc.text(emitido.toLocaleDateString("pt-BR"), M + 105 + (W - M - (M + 105)) / 2, y - 1.5, { align: "center" });
  doc.setDrawColor(...CINZA);
  doc.setLineWidth(0.3);
  doc.line(M, y, M + 85, y);
  doc.line(M + 105, y, W - M, y);
  doc.setFontSize(7.5);
  doc.setTextColor(...CINZA);
  doc.text("Pago e conferido por", M, y + 4);
  doc.text("Data", M + 105, y + 4);

  rodapePdf(doc, `Folha líquidos ${competencia} - ${folha.code}`, emitido);
  doc.save(`Folha_Liquidos_${folha.code}.pdf`);
}
