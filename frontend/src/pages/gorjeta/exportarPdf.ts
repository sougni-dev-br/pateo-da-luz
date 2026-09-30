import type { TipComputation, TipComputedParticipant, TipFolhaLiquidos } from "../../api/client";
import { MONTHS, NOTA_ADIANTAMENTO_OCULTO, adiantamentoOculto, fmtDate, money, ordenar } from "./gorjetaUtils";

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

// Envio à contabilidade: só quem é registrado, numa tabela só, por empresa e depois
// por nome. Os sem registro não vão para a contabilidade — vão para a lista de
// pagamento — e quem já recebeu a gorjeta na rescisão não entra de novo.
export async function exportarContabilidade(comp: TipComputation) {
  const { doc, autoTable, finalY } = await novoPdf("Fechamento de Gorjetas — Envio à Contabilidade", comp);
  const empresa = (p: TipComputedParticipant) => p.companyName || "Sem empresa";
  const lista = comp.participants
    .filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO" && !p.semRegistro && !p.pagoNaRescisao)
    .sort((a, b) => empresa(a).localeCompare(empresa(b), "pt-BR") || a.employeeName.localeCompare(b.employeeName, "pt-BR"));
  autoTable(doc, {
    ...estilo,
    startY: 30,
    // A contabilidade lança a gorjeta LÍQUIDA (rateio − vales + créditos), como na planilha e no extrato.
    head: [["Funcionário", "Empresa", "Gorjeta", "Hora extra", "Ad. noturno", "Faltas", "Atestados"]],
    body: lista.map((p) => [
      p.employeeName + (p.tipoCalculo === "MES" ? "" : ` (saída ${fmtDate(p.terminationDate)})`),
      empresa(p),
      money(p.netCommission),
      p.horaExtra ?? "",
      p.adicionalNoturno ?? "",
      p.faltas ? String(p.faltas) : "",
      p.atestados ? String(p.atestados) : "",
    ]),
    foot: [["Total", "", money(lista.reduce((a, p) => a + p.netCommission, 0)), "", "", "", ""]],
    columnStyles: { 2: { halign: "right", fontStyle: "bold" }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center" }, 6: { halign: "center" } },
  });
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Gorjeta = rateio por pontos − vales + créditos. Hora extra e adicional noturno em horas (h:mm).", 14, finalY() + 8);
  doc.save(`Gorjeta_Contabilidade_${MONTHS[comp.month - 1]}_${comp.year}.pdf`);
}

/** Célula do adiantamento no PDF: null = sem permissão ("oculto"); 0 = não recebe (vazio). */
export function celulaAdiantamento(valor: number | null | undefined): string {
  if (valor == null) return "oculto";
  return valor ? `− ${money(valor)}` : "";
}

// Lista de pagamento dos sem registro: salário proporcional − adiantamento + gorjeta − vales + créditos.
export async function exportarListaPagamento(comp: TipComputation) {
  const { doc, autoTable, finalY } = await novoPdf("Lista de Pagamento — Sem registro", comp);
  const lista = ordenar(comp.participants).filter((p) => p.semRegistro && p.tipoCalculo !== "FORA_DO_PERIODO" && !p.pagoNaRescisao);
  const totalAdiantamento = lista.reduce((a, p) => a + (p.adiantamentoSalarial ?? 0), 0);
  // Sem permissão o adiantamento vem null: "oculto", não vazio (que leria como zero).
  const oculto = adiantamentoOculto(lista);
  autoTable(doc, {
    ...estilo,
    startY: 30,
    head: [["Funcionário", "Dias", "Salário", "Adiantamento", "Gorjeta", "Vales", "Créditos", "A pagar", "PIX"]],
    body: lista.map((p) => [
      p.employeeName + (p.tipoCalculo === "MES" ? "" : ` (saída ${fmtDate(p.terminationDate)})`),
      String(p.diasSalario),
      money(p.salarioProporcional),
      celulaAdiantamento(p.adiantamentoSalarial),
      money(p.rateioAmount),
      p.descontos ? `− ${money(p.descontos)}` : "",
      p.creditos ? money(p.creditos) : "",
      money(p.totalAPagar),
      p.pixKey ?? "",
    ]),
    foot: [["Total", "", money(lista.reduce((a, p) => a + p.salarioProporcional, 0)), celulaAdiantamento(oculto ? null : totalAdiantamento),
      money(lista.reduce((a, p) => a + p.rateioAmount, 0)), "", "", money(lista.reduce((a, p) => a + p.totalAPagar, 0)), ""]],
    columnStyles: {
      1: { halign: "center" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" },
    },
  });
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Salário calculado como registrado: salário ÷ 30 × dias (mês inteiro = 30; faltas injustificadas descontam).", 14, finalY() + 8);
  // O adiantamento já foi pago no dia dele: a lista só leva o que falta.
  if (oculto) {
    doc.text(`Adiantamento oculto (sem permissão de ver Funcionários). ${NOTA_ADIANTAMENTO_OCULTO}`, 14, finalY() + 12);
  } else if (comp.adiantamento) {
    const { percent, dia } = comp.adiantamento;
    doc.text(`Adiantamento = ${percent.toLocaleString("pt-BR")}% do salário base, pago no dia ${dia}, para quem recebe adiantamento (cadastro).`, 14, finalY() + 12);
  }
  doc.save(`Gorjeta_Pagamento_${MONTHS[comp.month - 1]}_${comp.year}.pdf`);
}

// Folha salarial líquidos: a lista para o pagamento no banco, por empresa.
export async function exportarFolhaLiquidos(folha: TipFolhaLiquidos, liberada: boolean) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as unknown as AutoTable;
  const doc = new jsPDF();
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  doc.setFontSize(14);
  doc.text("Folha salarial líquidos", 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`${folha.code} · ${folha.label}${liberada ? "" : "   ·   PRÉVIA (sem OK da contabilidade)"}`, 14, 23);
  doc.setTextColor(0);
  let y = 26;
  for (const grupo of [...new Set(folha.linhas.map((l) => l.grupo))]) {
    const lista = folha.linhas.filter((l) => l.grupo === grupo);
    autoTable(doc, {
      ...estilo,
      startY: y + 4,
      head: [[grupo, "PIX", "Valor"]],
      body: lista.map((l) => [l.nome + (l.origem === "SALARIO_COMBINADO" ? " *" : ""), l.pix ?? "", money(l.valor)]),
      foot: [["Total", "", money(lista.reduce((a, l) => a + l.valor, 0))]],
      columnStyles: { 2: { halign: "right" } },
    });
    y = finalY() + 4;
  }
  doc.setFontSize(11);
  doc.text(`Total geral: ${money(folha.total)}`, 14, y + 8);
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("CLT: líquido do extrato da contabilidade. * (salário combinado − adiantamento) + gorjeta. Sem registro: salário ÷ 30 × dias − adiantamento (quem recebe) + gorjeta − vales.", 14, y + 14);
  doc.save(`Folha_Liquidos_${folha.code}.pdf`);
}
