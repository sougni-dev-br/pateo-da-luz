// As datas das guias ficam gravadas à meia-noite UTC. Formatar com toLocaleDateString no fuso
// de Brasília mostrava um dia antes (competência 01/09 aparecia como 31/08), então tudo aqui
// trabalha com o texto AAAA-MM-DD, sem passar por Date.
const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatarDiaDaGuia(valor: string | null | undefined): string {
  const m = valor ? DIA_ISO.exec(valor) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

export function formatarMesAno(valor: string | null | undefined): string {
  const m = valor ? DIA_ISO.exec(valor) : null;
  return m ? `${m[2]}/${m[1]}` : "—";
}

// Dia de hoje no relógio de quem está usando a tela (AAAA-MM-DD).
export function hojeIso(agora: Date = new Date()): string {
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

type GuiaParaSituacao = { paymentDate: string | null; dueDate: string; status: string };

// Cancelada prevalece; depois pago; vencida só quando o vencimento é anterior a hoje (vence hoje
// ainda está em dia). O status gravado só decide o cancelamento: "vencido" envelhece sozinho.
export function situacaoDaGuia(guia: GuiaParaSituacao, hoje: string = hojeIso()): "CANCELED" | "PAID" | "OVERDUE" | "PENDING" {
  if (guia.status === "CANCELED") return "CANCELED";
  if (guia.paymentDate) return "PAID";
  const vencimento = DIA_ISO.exec(guia.dueDate)?.[0];
  return vencimento && vencimento < hoje ? "OVERDUE" : "PENDING";
}

export function formatarReais(valor: string | number): string {
  const n = Number(valor);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "";
}

type GuiaParaResumo = {
  amount: string;
  dueDate: string;
  competenceDate: string;
  categoriaNome: string | null;
};

// "O que vai acontecer" ao salvar: a pessoa vê, antes de clicar, para onde a guia vai.
export function resumoDaGuia(guia: GuiaParaResumo): string[] {
  const linhas: string[] = [];
  const valor = formatarReais(guia.amount);
  if (valor && DIA_ISO.test(guia.dueDate)) {
    linhas.push(`Conta a pagar de ${valor}, vencendo em ${formatarDiaDaGuia(guia.dueDate)}. Aparece em Contas a Pagar assim que salvar.`);
  }
  if (DIA_ISO.test(guia.competenceDate)) {
    linhas.push(
      guia.categoriaNome
        ? `DRE de ${formatarMesAno(guia.competenceDate)}, em ${guia.categoriaNome}.`
        : `DRE de ${formatarMesAno(guia.competenceDate)}, em "Não categorizadas" (fora do grupo Impostos).`
    );
  } else {
    linhas.push("Sem competência a guia não entra no DRE. Informe o mês a que ela se refere.");
  }
  return linhas;
}
