import type { TipComputation, TipComputedParticipant } from "../../api/client";
import { MONTHS, fmtDate, money, ordenar } from "./gorjetaUtils";

type AutoTable = (doc: unknown, options: Record<string, unknown>) => void;

async function novoPdf(titulo: string, comp: TipComputation) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as unknown as AutoTable;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(titulo, 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Competência: ${MONTHS[comp.month - 1]} / ${comp.year}   ·   Período: ${comp.label}`, 14, 23);
  doc.setTextColor(0);
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  return { doc, autoTable, finalY };
}

const estilo = {
  styles: { fontSize: 9, cellPadding: 2.5 },
  headStyles: { fillColor: [107, 79, 42], textColor: 255 },
  footStyles: { fillColor: [240, 236, 229], textColor: 0, fontStyle: "bold" },
  theme: "grid",
  margin: { left: 14, right: 14 },
};

// Envio à contabilidade: só quem é registrado, agrupado por empresa. Os sem
// registro não vão para a contabilidade — vão para a lista de pagamento.
export async function exportarContabilidade(comp: TipComputation) {
  const { doc, autoTable, finalY } = await novoPdf("Fechamento de Gorjetas — Envio à Contabilidade", comp);
  const noPeriodo = ordenar(comp.participants).filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO");
  // Quem já recebeu a gorjeta na rescisão não entra de novo no envio do mês.
  const registrados = noPeriodo.filter((p) => !p.semRegistro && !p.pagoNaRescisao);
  const pagas = noPeriodo.filter((p) => p.pagoNaRescisao);
  const grupos = new Map<string, TipComputedParticipant[]>();
  for (const p of registrados) {
    const k = p.companyName || "Sem empresa";
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  let y = 26;
  for (const [empresa, lista] of grupos) {
    autoTable(doc, {
      ...estilo,
      startY: y + 4,
      head: [[empresa, "Gorjeta", "Hora extra", "Ad. noturno", "Faltas", "Atestado", "Observação"]],
      body: lista.map((p) => [
        p.employeeName,
        money(p.rateioAmount),
        p.horaExtra ?? "",
        p.adicionalNoturno ?? "",
        p.faltas ? String(p.faltas) : "",
        p.atestados ? String(p.atestados) : "",
        p.tipoCalculo === "MES" ? "" : `Rescisão ${fmtDate(p.terminationDate)}`,
      ]),
      foot: [["Total", money(lista.reduce((a, p) => a + p.rateioAmount, 0)), "", "", "", "", ""]],
      columnStyles: { 1: { halign: "right" }, 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center" } },
    });
    y = finalY() + 4;
  }
  if (pagas.length) {
    autoTable(doc, {
      ...estilo,
      startY: y + 4,
      head: [["Já pagas na rescisão — informativo, NÃO lançar de novo", "Gorjeta", "Saída", "Pagamento"]],
      body: pagas.map((p) => [p.employeeName, money(p.rateioAmount), fmtDate(p.terminationDate), fmtDate(p.rescisaoRecibo?.pagamento ?? null)]),
      headStyles: { fillColor: [140, 140, 140], textColor: 255 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "center" }, 3: { halign: "center" } },
    });
    y = finalY() + 4;
  }
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Gorjeta = rateio por pontos do período. Hora extra e adicional noturno em horas (h:mm).", 14, y + 4);
  doc.save(`Gorjeta_Contabilidade_${MONTHS[comp.month - 1]}_${comp.year}.pdf`);
}

// Lista de pagamento dos sem registro: salário proporcional + gorjeta − vales + créditos.
export async function exportarListaPagamento(comp: TipComputation) {
  const { doc, autoTable, finalY } = await novoPdf("Lista de Pagamento — Sem registro", comp);
  const lista = ordenar(comp.participants).filter((p) => p.semRegistro && p.tipoCalculo !== "FORA_DO_PERIODO" && !p.pagoNaRescisao);
  autoTable(doc, {
    ...estilo,
    startY: 30,
    head: [["Funcionário", "Dias", "Salário", "Gorjeta", "Vales", "Créditos", "A pagar", "PIX"]],
    body: lista.map((p) => [
      p.employeeName + (p.tipoCalculo === "MES" ? "" : ` (saída ${fmtDate(p.terminationDate)})`),
      String(p.diasSalario),
      money(p.salarioProporcional),
      money(p.rateioAmount),
      p.descontos ? `− ${money(p.descontos)}` : "",
      p.creditos ? money(p.creditos) : "",
      money(p.totalAPagar),
      p.pixKey ?? "",
    ]),
    foot: [["Total", "", money(lista.reduce((a, p) => a + p.salarioProporcional, 0)), money(lista.reduce((a, p) => a + p.rateioAmount, 0)),
      "", "", money(lista.reduce((a, p) => a + p.totalAPagar, 0)), ""]],
    columnStyles: { 1: { halign: "center" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
  });
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Salário calculado como registrado: salário ÷ 30 × dias (mês inteiro = 30; faltas injustificadas descontam).", 14, finalY() + 8);
  doc.save(`Gorjeta_Pagamento_${MONTHS[comp.month - 1]}_${comp.year}.pdf`);
}
