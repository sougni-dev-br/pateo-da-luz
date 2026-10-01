import type { ExtraRecibo } from "../../../api/client";
import { PIX_ROTULO, brl, dataCurta } from "./extrasRotulos";

// Texto livre (nome, setor, função) vai para um document.write: escapar sempre.
const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// CPF pode vir só com dígitos (cadastro de freelancer grava assim); no recibo, formatado.
const cpfFormatado = (cpf: string) => {
  const d = cpf.replace(/\D/g, "");
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : cpf;
};

const dataLonga = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return esc(`${d}/${m}/${y}`);
};

export function htmlRecibo(r: ExtraRecibo): string {
  const linhas = r.diarias.map((d) => `
    <tr>
      <td>${esc(dataCurta(d.date))}</td>
      <td>${esc(d.sector)}${d.role ? ` · ${esc(d.role)}` : ""}${d.eventName ? ` · ${esc(d.eventName)}` : ""}</td>
      <td>${d.startTime || d.endTime ? `${esc(d.startTime ?? "?")}–${esc(d.endTime ?? "?")}` : ""}</td>
      <td>${d.duration === "MEIA" ? "Meia" : "Inteira"}</td>
      <td class="n">${brl(d.baseAmount)}</td>
      <td class="n">${d.transportAmount ? brl(d.transportAmount) : "—"}</td>
      <td class="n">${d.bonusAmount ? brl(d.bonusAmount) : "—"}</td>
      <td class="n">${d.discountAmount ? `−${brl(d.discountAmount)}` : "—"}</td>
      <td class="n"><strong>${brl(d.totalAmount)}</strong></td>
    </tr>`).join("");
  const pix = r.pixKey ? `${esc(r.pixKey)} (${esc(PIX_ROTULO[r.pixKeyType as keyof typeof PIX_ROTULO] ?? r.pixKeyType ?? "")})` : "";
  const pago = r.paymentDate
    ? `<p>Pago em <strong>${dataLonga(r.paymentDate)}</strong>${r.paidPaymentMethodName ? ` via <strong>${esc(r.paidPaymentMethodName)}</strong>` : ""}${r.paidAmount != null && Math.abs(r.paidAmount - r.amount) > 0.009 ? ` — valor pago <strong>${brl(r.paidAmount)}</strong>` : ""}.</p>`
    : `<p>Vencimento: <strong>${dataLonga(r.dueDate)}</strong>.</p>`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo ${esc(r.code)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.45 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 18px; margin: 0; }
  .code { font-size: 13px; font-weight: 700; }
  .dados { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-bottom: 12px; }
  .dados span { color: #555; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
  th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; }
  th { background: #eee; font-size: 11px; }
  .n { text-align: right; white-space: nowrap; }
  .total { font-size: 15px; text-align: right; margin: 6px 0 14px; }
  .declaro { margin: 18px 0 40px; }
  .assinaturas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px; }
  .assinaturas div { border-top: 1px solid #111; padding-top: 4px; text-align: center; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body>
<header>
  <div><h1>Recibo de pagamento de diárias</h1><div>Pateo da Luz</div></div>
  <div class="code">${esc(r.code)}</div>
</header>
<div class="dados">
  <div><span>Nome:</span> <strong>${esc(r.nome)}</strong></div>
  <div><span>CPF:</span> ${r.cpf ? esc(cpfFormatado(r.cpf)) : "______________________"}</div>
  <div><span>Vínculo:</span> ${r.origem === "CASA" ? "Equipe da casa" : "Freelancer (diária)"}</div>
  <div><span>PIX:</span> ${pix || "______________________"}</div>
</div>
<table>
  <thead><tr><th>Data</th><th>Setor · função</th><th>Horário</th><th>Diária</th><th class="n">Valor</th><th class="n">Transporte</th><th class="n">Acréscimo</th><th class="n">Desconto</th><th class="n">Total</th></tr></thead>
  <tbody>${linhas}</tbody>
</table>
<div class="total">Total: <strong>${brl(r.amount)}</strong></div>
${pago}
<p class="declaro">Declaro ter recebido de Pateo da Luz a quantia de <strong>${brl(r.paidAmount ?? r.amount)}</strong>, referente às diárias acima, trabalhadas como extra, dando plena quitação.</p>
<div class="assinaturas">
  <div>${esc(r.nome)}</div>
  <div>Data: ____/____/________</div>
</div>
</body></html>`;
}

// Imprime por um iframe escondido: não abre aba nova nem depende de pop-up liberado.
export function imprimirRecibo(r: ExtraRecibo) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(htmlRecibo(r));
  doc.close();
  const remover = () => setTimeout(() => iframe.remove(), 500);
  iframe.contentWindow!.onafterprint = remover;
  setTimeout(() => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(remover, 60_000);
  }, 150);
}
