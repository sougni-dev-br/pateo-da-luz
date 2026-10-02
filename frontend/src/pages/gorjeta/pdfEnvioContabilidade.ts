// PDF do envio à contabilidade: o documento que sai do restaurante para o escritório.
// Um bloco por empresa (razão social e CNPJ), subtotal de cada uma, total geral, legenda,
// campo de conferência e rodapé com emissão e página. Nada aqui fala do teto do IR.
import { getCompanies, type Company, type TipComputation } from "../../api/client";
import { MONTHS, fmtDate, fmtHoras, money, parseHoras } from "./gorjetaUtils";
import {
  NOTA_TETO_OCULTO, agruparEnvioPorEmpresa, montarEnvioContabilidade, entraNaImpressao, rotuloResumoAusencias, tabelaDoEnvio, textoPdf, totaisDoEnvio,
} from "./envioContabilidade";

type Doc = {
  setFont: (f: string, s?: string) => void; setFontSize: (n: number) => void;
  setTextColor: (...c: number[]) => void; setDrawColor: (...c: number[]) => void; setFillColor: (...c: number[]) => void;
  setLineWidth: (n: number) => void; getTextWidth: (t: string) => number; text: (t: string | string[], x: number, y: number, o?: Record<string, unknown>) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  rect: (x: number, y: number, w: number, h: number, s?: string) => void;
  roundedRect: (x: number, y: number, w: number, h: number, rx: number, ry: number, s?: string) => void;
  addPage: () => void; setPage: (n: number) => void; getNumberOfPages: () => number;
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  lastAutoTable: { finalY: number };
  save: (nome: string) => void;
};
type AutoTable = (doc: unknown, options: Record<string, unknown>) => void;

const MARROM = [107, 79, 42] as const;
const BEGE = [246, 242, 235] as const;
const LISTRA = [251, 249, 245] as const;
const LINHA = [226, 219, 207] as const;
const TINTA = [38, 32, 26] as const;
const CINZA = [118, 110, 100] as const;
const M = 14; // margem

const reais = (v: number) => textoPdf(money(v));
const cnpjFmt = (c: string | null | undefined) => {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (c ?? "");
};

async function empresasPorId(): Promise<Map<string, Company>> {
  // Sem acesso ao cadastro de empresas, o PDF sai com o nome curto: não é motivo para falhar.
  try { return new Map((await getCompanies({ includeInactive: true })).map((c) => [c.id, c])); } catch { return new Map(); }
}

export async function gerarPdfEnvioContabilidade(comp: TipComputation) {
  const envio = montarEnvioContabilidade(comp);
  if (envio.ocultos > 0) throw new Error(`${NOTA_TETO_OCULTO} Peça a quem tem a permissão para gerar o PDF.`);
  // Quem tem gorjeta zero e nada mais a pagar não vai para o papel.
  const linhas = envio.linhas.filter((l) => entraNaImpressao(l, parseHoras));
  const grupos = agruparEnvioPorEmpresa(linhas);
  // Uma tabela só para todas as empresas: a coluna de afastamento aparece em todas ou em nenhuma.
  const tabela = tabelaDoEnvio(linhas);
  const empresas = await empresasPorId();
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as unknown as AutoTable;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as unknown as Doc;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const mes = MONTHS[comp.month - 1];
  const competencia = `${mes.charAt(0).toUpperCase()}${mes.slice(1).toLowerCase()}/${comp.year}`;
  const emitido = new Date();

  // ── Cabeçalho ───────────────────────────────────────────────
  doc.setFillColor(...MARROM);
  doc.rect(0, 0, W, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MARROM);
  doc.text("PATEO DA LUZ", M, 13);
  doc.setFontSize(17);
  doc.setTextColor(...TINTA);
  doc.text("Gorjetas para a folha de pagamento", M, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...CINZA);
  doc.text(textoPdf(`Competência ${competencia}   |   Ciclo da gorjeta: ${fmtDate(comp.periodStart)} a ${fmtDate(comp.periodEnd)}`), M, 27.5);

  // Código e situação em selo no canto: fechado (verde) ou prévia (âmbar).
  const fechado = comp.status === "CLOSED" && comp.fechamento;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...CINZA);
  if (comp.code) doc.text(comp.code, W - M, 13, { align: "right" });
  const selo = fechado ? textoPdf(`FECHADO EM ${fmtDate(comp.fechamento!.closedAt)}`) : "PRÉVIA - GORJETA EM ABERTO";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const largSelo = doc.getTextWidth(selo) + 7;
  if (fechado) doc.setFillColor(228, 242, 232); else doc.setFillColor(253, 238, 220);
  doc.roundedRect(W - M - largSelo, 16.5, largSelo, 6.5, 3.2, 3.2, "F");
  if (fechado) doc.setTextColor(36, 104, 58); else doc.setTextColor(166, 88, 10);
  doc.text(selo, W - M - largSelo / 2, 20.9, { align: "center" });

  // ── Resumo ──────────────────────────────────────────────────
  const t = totaisDoEnvio(linhas, parseHoras);
  const horas = (min: number) => (min > 0 ? fmtHoras(min) : "0:00");
  const caixas: Array<[string, string, number]> = [
    ["Total de gorjetas", reais(envio.total ?? 0), 1.5],
    ["Funcionários", String(linhas.length), 0.8],
    ["Hora extra / noturno", `${horas(t.minutosHoraExtra)}  /  ${horas(t.minutosNoturno)}`, 1.2],
    [...rotuloResumoAusencias(t), 1],
  ];
  const yResumo = 33;
  const gap = 3.5;
  const pesos = caixas.reduce((a, c) => a + c[2], 0);
  const util = W - 2 * M - gap * (caixas.length - 1);
  let xCaixa = M;
  caixas.forEach(([rotulo, valor, peso], i) => {
    const x = xCaixa;
    const larg = (util * peso) / pesos;
    xCaixa += larg + gap;
    doc.setFillColor(...BEGE);
    doc.roundedRect(x, yResumo, larg, 15, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA);
    doc.text(rotulo.toUpperCase(), x + 4, yResumo + 5.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(i === 0 ? 13 : 11.5);
    doc.setTextColor(...(i === 0 ? MARROM : TINTA));
    doc.text(valor, x + 4, yResumo + 12);
  });

  // ── Um bloco por empresa ────────────────────────────────────
  let y = yResumo + 22;
  for (const g of grupos) {
    const emp = g.companyId ? empresas.get(g.companyId) : undefined;
    if (y > H - 60) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...TINTA);
    doc.text(textoPdf(emp?.legalName ?? g.empresa), M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...CINZA);
    const sub = [emp?.cnpj ? `CNPJ ${cnpjFmt(emp.cnpj)}` : null, `${g.linhas.length} funcionário${g.linhas.length === 1 ? "" : "s"}`]
      .filter(Boolean).join("   |   ");
    doc.text(textoPdf(sub), M, y + 4.5);

    autoTable(doc, {
      startY: y + 7,
      margin: { left: M, right: M, top: 18, bottom: 22 },
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8.8, textColor: [...TINTA], cellPadding: { top: 1.9, bottom: 1.9, left: 2.5, right: 2.5 }, valign: "middle" },
      headStyles: { fillColor: [...MARROM], textColor: 255, fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [...BEGE], textColor: [...TINTA], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [...LISTRA] },
      head: [tabela.head],
      body: g.linhas.map(tabela.linha),
      foot: [[textoPdf(`Subtotal ${g.empresa}`), reais(g.subtotal), ...tabela.head.slice(2).map(() => "")]],
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { cellWidth: 30, halign: "right", fontStyle: "bold" },
        2: { cellWidth: 22, halign: "center" },
        3: { cellWidth: 22, halign: "center" },
        4: { cellWidth: 16, halign: "center" },
        5: { cellWidth: 19, halign: "center" },
        ...(tabela.comAfastamento ? { 6: { cellWidth: 15, halign: "center" } } : {}),
      },
      didParseCell: (d: { section: string; column: { index: number }; cell: { text: string[]; styles: Record<string, unknown> } }) => {
        if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = d.column.index === 1 ? "right" : "center";
        if (d.section === "foot" && d.column.index === 1) d.cell.styles.halign = "right";
        // Traço de "nada no período" mais claro, para o olho achar só o que tem valor.
        if (d.section === "body" && d.column.index > 1 && d.cell.text.join("") === "-") d.cell.styles.textColor = [190, 182, 170];
      },
      didDrawCell: (d: { section: string; row: { index: number }; cell: { x: number; y: number; width: number; height: number } }) => {
        // Linha marrom separa o subtotal das pessoas.
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
      },
    });
    y = doc.lastAutoTable.finalY + 9;
  }

  // ── Total geral, legenda e conferência ──────────────────────
  if (y > H - 50) { doc.addPage(); y = 20; }
  doc.setFillColor(...MARROM);
  doc.roundedRect(M, y - 4, W - 2 * M, 11, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text("Total geral de gorjetas", M + 4, y + 3);
  doc.text(reais(envio.total ?? 0), W - M - 4, y + 3, { align: "right" });

  y += 15;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CINZA);
  [
    "Gorjeta: valor a lançar na folha de cada funcionário.",
    tabela.comAfastamento
      ? "Hora extra e adicional noturno em horas (h:mm). Faltas, atestados e afastamento não remunerado (Afast.) em dias. \"-\" = nada no período."
      : "Hora extra e adicional noturno em horas (h:mm). Faltas e atestados em dias. \"-\" = nada no período.",
  ].forEach((l, i) => doc.text(textoPdf(l), M, y + i * 4.2));

  // Assinatura de quem confere; a data é a do dia, preenchida pelo sistema.
  y += 16;
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
  doc.text("Conferido por (contabilidade)", M, y + 4);
  doc.text("Data", M + 105, y + 4);

  // ── Rodapé em todas as páginas ──────────────────────────────
  const total = doc.getNumberOfPages();
  const quando = `${emitido.toLocaleDateString("pt-BR")} às ${emitido.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINHA);
    doc.setLineWidth(0.2);
    doc.line(M, H - 12, W - M, H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA);
    doc.text(textoPdf(`Gorjetas ${competencia}${comp.code ? ` - ${comp.code}` : ""}   |   Emitido em ${quando}`), M, H - 7.5);
    doc.text(`Página ${i} de ${total}`, W - M, H - 7.5, { align: "right" });
  }

  doc.save(`Gorjeta_Contabilidade_${mes}_${comp.year}.pdf`);
}
