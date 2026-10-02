import type { TipComputation, TipComputedParticipant } from "../../api/client";
import {
  MONTHS, NOTA_ADIANTAMENTO_OCULTO, NOTA_DSR_OCULTO, NOTA_HORA_EXTRA_OCULTA, NOTA_QUINZENA_OCULTA, REGRA_DSR, REGRA_HORA_EXTRA, REGRA_QUINZENA,
  adiantamentoOculto, fmtDate, fmtHoras, money, mostraDsr, mostraQuinzena, ordenar, parseHoras, quinzenaOculta, valorHoraExtraTotal,
} from "./gorjetaUtils";
import { celulasPdf, textoPdf } from "./envioContabilidade";
import { gerarPdfEnvioContabilidade } from "./pdfEnvioContabilidade";

type AutoTable = (doc: unknown, options: Record<string, unknown>) => void;

// A Helvetica do jsPDF (WinAnsi) não desenha "−" nem alguns traços: todo texto e toda célula
// passam por textoPdf antes de ir para o documento.
const comTextoPdf = (autoTable: AutoTable): AutoTable => (doc, o) => autoTable(doc, {
  ...o,
  ...(o.head ? { head: celulasPdf(o.head as string[][]) } : {}),
  ...(o.body ? { body: celulasPdf(o.body as string[][]) } : {}),
  ...(o.foot ? { foot: celulasPdf(o.foot as string[][]) } : {}),
});

async function novoPdf(titulo: string, comp: TipComputation, orientacao: "portrait" | "landscape" = "portrait") {
  const { jsPDF } = await import("jspdf");
  const autoTable = comTextoPdf((await import("jspdf-autotable")).default as unknown as AutoTable);
  const doc = new jsPDF({ orientation: orientacao });
  doc.setFontSize(14);
  doc.text(textoPdf(titulo), 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(textoPdf(`Competência: ${MONTHS[comp.month - 1]} / ${comp.year}   ·   Período: ${comp.label}`), 14, 23);
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

// Envio à contabilidade: o PDF que vai ao escritório (layout em pdfEnvioContabilidade.ts).
export async function exportarContabilidade(comp: TipComputation) {
  await gerarPdfEnvioContabilidade(comp);
}

/** Célula do adiantamento no PDF: null = sem permissão ("oculto"); 0 = não recebe (vazio). */
export function celulaAdiantamento(valor: number | null | undefined): string {
  if (valor == null) return "oculto";
  return valor ? textoPdf(`- ${money(valor)}`) : "";
}

/** Célula do valor da hora extra + noturno no PDF: null = sem permissão ("oculto"); 0 = sem horas (vazio). */
export function celulaValorHoraExtra(valor: number | null): string {
  if (valor == null) return "oculto";
  return valor ? money(valor) : "";
}

// Horas do período em h:mm (vazio sem horas). O texto ilegível sai como foi digitado.
const celulaHoras = (texto: string | null) => {
  const min = parseHoras(texto);
  return min == null ? texto ?? "" : min > 0 ? fmtHoras(min) : "";
};

/**
 * Linha da lista de pagamento no PDF (exportada para o teste). comQuinzena: a coluna da 1ª
 * quinzena entra depois do adiantamento (só quando alguém da lista recebe por quinzena).
 * comDsr: a coluna do DSR entra depois do valor HE/AN (só quando alguém tem DSR).
 */
export function linhaListaPagamento(p: TipComputedParticipant, comQuinzena = false, comDsr = false): string[] {
  return [
    p.employeeName + (p.foraDaGorjeta ? " (fora da gorjeta)" : "") + (p.tipoCalculo === "MES" ? "" : ` (saída ${fmtDate(p.terminationDate)})`),
    String(p.diasSalario),
    money(p.salarioProporcional),
    celulaAdiantamento(p.adiantamentoSalarial),
    // Mesma célula do adiantamento: null = "oculto"; 0 = não recebe; valor = negativo.
    // Ausente (backend antigo) = não recebe.
    ...(comQuinzena ? [celulaAdiantamento(p.primeiraQuinzena === undefined ? 0 : p.primeiraQuinzena)] : []),
    // Não participa da gorjeta: traço, não "R$ 0,00" (que leria como gorjeta zerada).
    p.foraDaGorjeta ? "—" : money(p.rateioAmount),
    p.descontos ? textoPdf(`- ${money(p.descontos)}`) : "",
    p.creditos ? money(p.creditos) : "",
    celulaHoras(p.horaExtra),
    celulaHoras(p.adicionalNoturno),
    celulaValorHoraExtra(valorHoraExtraTotal(p)),
    // Mesma célula da hora extra: null = "oculto"; ausente (backend antigo) = sem DSR.
    ...(comDsr ? [celulaValorHoraExtra(p.valorDsr === undefined ? 0 : p.valorDsr)] : []),
    money(p.totalAPagar),
    p.pixKey ?? "",
  ];
}

// Lista de pagamento dos sem registro: salário proporcional − adiantamento − 1ª quinzena +
// gorjeta − vales + créditos + hora extra/noturno + DSR. Em paisagem: 12 colunas (+1 com a
// quinzena, +1 com o DSR).
export async function exportarListaPagamento(comp: TipComputation) {
  const { doc, autoTable, finalY } = await novoPdf("Lista de Pagamento — Sem registro", comp, "landscape");
  const lista = ordenar(comp.participants).filter((p) => p.semRegistro && p.tipoCalculo !== "FORA_DO_PERIODO" && !p.pagoNaRescisao);
  const totalAdiantamento = lista.reduce((a, p) => a + (p.adiantamentoSalarial ?? 0), 0);
  // Sem permissão o adiantamento e a hora extra vêm null: "oculto", não vazio (que leria como zero).
  const oculto = adiantamentoOculto(lista);
  const heOculta = lista.some((p) => valorHoraExtraTotal(p) == null);
  const comQuinzena = mostraQuinzena(lista);
  const qOculta = quinzenaOculta(lista);
  const totalQuinzena = lista.reduce((a, p) => a + (p.primeiraQuinzena ?? 0), 0);
  const comDsr = mostraDsr(lista);
  const dsrOculto = lista.some((p) => p.valorDsr === null);
  // A partir da coluna da quinzena, os índices andam uma casa; depois da do DSR, mais uma.
  const q = comQuinzena ? 1 : 0;
  const ds = comDsr ? 1 : 0;
  const totalHoras = (campo: "horaExtra" | "adicionalNoturno") => {
    const min = lista.reduce((a, p) => a + Math.max(0, parseHoras(p[campo]) ?? 0), 0);
    return min > 0 ? fmtHoras(min) : "";
  };
  autoTable(doc, {
    ...estilo,
    startY: 30,
    head: [["Funcionário", "Dias", "Salário", "Adiantamento", ...(comQuinzena ? ["1ª quinzena (15)"] : []),
      "Gorjeta", "Vales", "Créditos", "HE", "Ad. noturno", "Valor HE/AN", ...(comDsr ? ["DSR"] : []), "A pagar", "PIX"]],
    body: lista.map((p) => linhaListaPagamento(p, comQuinzena, comDsr)),
    foot: [["Total", "", money(lista.reduce((a, p) => a + p.salarioProporcional, 0)), celulaAdiantamento(oculto ? null : totalAdiantamento),
      ...(comQuinzena ? [celulaAdiantamento(qOculta ? null : totalQuinzena)] : []),
      money(lista.reduce((a, p) => a + p.rateioAmount, 0)), "", "", totalHoras("horaExtra"), totalHoras("adicionalNoturno"),
      celulaValorHoraExtra(heOculta ? null : lista.reduce((a, p) => a + (valorHoraExtraTotal(p) ?? 0), 0)),
      ...(comDsr ? [celulaValorHoraExtra(dsrOculto ? null : lista.reduce((a, p) => a + (p.valorDsr ?? 0), 0))] : []),
      money(lista.reduce((a, p) => a + p.totalAPagar, 0)), ""]],
    columnStyles: {
      1: { halign: "center" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" },
      [6 + q]: { halign: "right" }, [7 + q]: { halign: "center" }, [8 + q]: { halign: "center" }, [9 + q]: { halign: "right" }, [10 + q]: { halign: "right" },
      [10 + q + ds]: { halign: "right" },
    },
  });
  doc.setFontSize(8);
  doc.setTextColor(120);
  const nota = (t: string, y: number) => doc.text(textoPdf(t), 14, y);
  nota("Salário calculado como registrado: salário ÷ 30 × dias (mês inteiro = 30; faltas injustificadas descontam).", finalY() + 8);
  // O adiantamento já foi pago no dia dele: a lista só leva o que falta.
  if (oculto) {
    nota(`Adiantamento oculto (sem permissão de ver Funcionários). ${NOTA_ADIANTAMENTO_OCULTO}`, finalY() + 12);
  } else if (comp.adiantamento) {
    const { percent, dia } = comp.adiantamento;
    nota(`Adiantamento = ${percent.toLocaleString("pt-BR")}% do salário base, pago no dia ${dia}, para quem recebe adiantamento (cadastro).`, finalY() + 12);
  }
  nota(`Horas em h:mm. ${REGRA_HORA_EXTRA}${heOculta ? ` Valor oculto (sem permissão). ${NOTA_HORA_EXTRA_OCULTA}` : ""}`, finalY() + 16);
  if (comQuinzena) {
    nota(qOculta ? `1ª quinzena oculta (sem permissão de ver Funcionários). ${NOTA_QUINZENA_OCULTA}` : REGRA_QUINZENA, finalY() + 20);
  }
  if (comDsr) {
    nota(`${REGRA_DSR}${dsrOculto ? ` Valor oculto (sem permissão). ${NOTA_DSR_OCULTO}` : ""}`, finalY() + (comQuinzena ? 24 : 20));
  }
  doc.save(`Gorjeta_Pagamento_${MONTHS[comp.month - 1]}_${comp.year}.pdf`);
}

