// Conferência do cartão de crédito no Fechamento Mensal.
//
// Existe separado do service para poder ser testado sem banco.
//
// A fatura de cartão é a única despesa do mês que chega sem nota: cada compra
// no cartão entra como linha da fatura, e só a conferência contra o extrato do
// banco garante que nada foi esquecido nem lançado a mais. Fechar o mês sem
// isso deixa o DRE e o contas a pagar com a fatura "como foi digitada".
//
// Regra: para cada cartão ativo, tem de existir a fatura da competência e ela
// precisa estar CONFERIDA (CHECKED) ou além (CLOSED, PAID). Fatura OPEN ainda
// está em digitação. Divergência registrada num item e não resolvida segura
// o fechamento mesmo com a fatura marcada como conferida.

export type CartaoDoMes = {
  id: string;
  name: string;
  last4Digits: string;
};

export type FaturaDoMes = {
  creditCardId: string;
  status: string;
  /** Itens da fatura marcados com divergência (hasDivergence). */
  itensComDivergencia: number;
};

export type PendenciaDeCartao = {
  key: string;
  label: string;
};

const STATUS_CONFERIDOS = new Set(["CHECKED", "CLOSED", "PAID"]);

function rotulo(cartao: CartaoDoMes): string {
  return `Cartão ${cartao.name} (final ${cartao.last4Digits})`;
}

export function chaveDoCartao(cartaoId: string): string {
  return `card:${cartaoId}`;
}

export function avaliarCartoesDoMes(
  cartoes: CartaoDoMes[],
  faturas: FaturaDoMes[]
): PendenciaDeCartao[] {
  const pendencias: PendenciaDeCartao[] = [];

  for (const cartao of cartoes) {
    const key = chaveDoCartao(cartao.id);
    // Cancelada é como se não existisse: não foi conferida nem será cobrada.
    const fatura = faturas.find((f) => f.creditCardId === cartao.id && f.status !== "CANCELLED");

    if (!fatura) {
      pendencias.push({
        key,
        label: `${rotulo(cartao)}: sem fatura lançada neste mês — a conferência do cartão é obrigatória (se não houve uso, justifique)`
      });
      continue;
    }

    if (!STATUS_CONFERIDOS.has(fatura.status)) {
      pendencias.push({
        key,
        label: `${rotulo(cartao)}: fatura não conferida com o extrato — marque como Conferida em Cartões`
      });
      continue;
    }

    if (fatura.itensComDivergencia > 0) {
      pendencias.push({
        key,
        label: `${rotulo(cartao)}: ${fatura.itensComDivergencia} item(ns) com divergência não resolvida na fatura`
      });
    }
  }

  return pendencias;
}
