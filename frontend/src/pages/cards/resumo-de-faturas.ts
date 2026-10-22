// Contas puras da lista de faturas de cartão (resumo do topo e prazo de cada linha).

type StatusDaFatura = "OPEN" | "CHECKED" | "CLOSED" | "PAID" | "CANCELLED" | string;

export type PrazoDaFatura = {
  texto: string;
  tom: "ok" | "atencao" | "atraso" | "neutro";
};

const DIA_EM_MS = 86_400_000;
const DIAS_DE_ATENCAO = 3;

function diaUtc(iso: string): number {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

function hojeUtc(hoje: Date): number {
  return Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
}

function emDias(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function vencimentoRelativo(dueDate: string, status: StatusDaFatura, hoje: Date = new Date()): PrazoDaFatura {
  if (status === "PAID" || status === "CANCELLED") return { texto: "", tom: "neutro" };
  const dias = Math.round((diaUtc(dueDate) - hojeUtc(hoje)) / DIA_EM_MS);
  if (dias < 0) {
    return { texto: dias === -1 ? "venceu ontem" : `venceu há ${emDias(-dias, "dia", "dias")}`, tom: "atraso" };
  }
  if (dias === 0) return { texto: "vence hoje", tom: "atencao" };
  if (dias === 1) return { texto: "vence amanhã", tom: "atencao" };
  return { texto: `vence em ${emDias(dias, "dia", "dias")}`, tom: dias <= DIAS_DE_ATENCAO ? "atencao" : "ok" };
}

export type FaturaParaResumo = {
  status: StatusDaFatura;
  totalAmount: string | number;
  dueDate: string;
  itensSemCartao?: number;
  creditCard?: { name: string; finais?: Array<{ isActive: boolean }> };
};

export type ResumoDasFaturas = {
  abertas: { valor: number; qtd: number };
  conferidas: { valor: number; qtd: number };
  semCartao: number;
  proximoVencimento: { dueDate: string; valor: number; cartao: string; atrasada: boolean } | null;
};

const A_PAGAR: StatusDaFatura[] = ["OPEN", "CHECKED", "CLOSED"];

export function resumoDasFaturas(faturas: FaturaParaResumo[], hoje: Date = new Date()): ResumoDasFaturas {
  const soma = (status: StatusDaFatura) => {
    const doStatus = faturas.filter((f) => f.status === status);
    const centavos = doStatus.reduce((total, f) => total + Math.round(Number(f.totalAmount ?? 0) * 100), 0);
    return { valor: centavos / 100, qtd: doStatus.length };
  };

  const semCartao = faturas
    .filter((f) => (f.creditCard?.finais ?? []).some((final) => final.isActive))
    .reduce((total, f) => total + (f.itensSemCartao ?? 0), 0);

  const aPagar = faturas
    .filter((f) => A_PAGAR.includes(f.status))
    .sort((a, b) => diaUtc(a.dueDate) - diaUtc(b.dueDate))[0];

  return {
    abertas: soma("OPEN"),
    conferidas: soma("CHECKED"),
    semCartao,
    proximoVencimento: aPagar
      ? {
          dueDate: aPagar.dueDate,
          valor: Number(aPagar.totalAmount ?? 0),
          cartao: aPagar.creditCard?.name ?? "",
          atrasada: diaUtc(aPagar.dueDate) < hojeUtc(hoje)
        }
      : null
  };
}
