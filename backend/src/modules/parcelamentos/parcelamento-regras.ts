// Regras puras do parcelamento: situação de cada parcela e resumo "quantas faltam".
export type ParcelaLinha = {
  status: string;
  purchaseStatus: string;
  amount: number;
  paidAmount: number | null;
  dueDate: Date | null;
};

export type Resumo = {
  total: number;
  pagas: number;
  abertas: number;
  atrasadas: number;
  canceladas: number;
  valorPago: number;
  saldoAberto: number;
  proximoVencimento: Date | null;
  quitado: boolean;
};

const PAGAS = new Set(["PAID", "PAID_LATE"]);

export function situacaoDaParcela(p: Pick<ParcelaLinha, "status" | "purchaseStatus">): "PAGA" | "ABERTA" | "CANCELADA" {
  if (p.purchaseStatus === "CANCELLED" || p.status === "CANCELLED") return "CANCELADA";
  return PAGAS.has(p.status) ? "PAGA" : "ABERTA";
}

function centavos(valor: number) {
  return Math.round(valor * 100);
}

function inicioDoDia(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function resumirParcelas(parcelas: ParcelaLinha[], hoje: Date): Resumo {
  let pagas = 0;
  let abertas = 0;
  let atrasadas = 0;
  let canceladas = 0;
  let pagoCent = 0;
  let saldoCent = 0;
  let proximo: Date | null = null;
  for (const p of parcelas) {
    const situacao = situacaoDaParcela(p);
    if (situacao === "CANCELADA") {
      canceladas += 1;
    } else if (situacao === "PAGA") {
      pagas += 1;
      pagoCent += centavos(p.paidAmount ?? p.amount);
    } else {
      abertas += 1;
      saldoCent += centavos(p.amount);
      if (p.dueDate) {
        if (inicioDoDia(p.dueDate) < inicioDoDia(hoje)) atrasadas += 1;
        if (!proximo || p.dueDate < proximo) proximo = p.dueDate;
      }
    }
  }
  return {
    total: parcelas.length - canceladas,
    pagas,
    abertas,
    atrasadas,
    canceladas,
    valorPago: pagoCent / 100,
    saldoAberto: saldoCent / 100,
    proximoVencimento: proximo,
    quitado: abertas === 0 && pagas > 0
  };
}
