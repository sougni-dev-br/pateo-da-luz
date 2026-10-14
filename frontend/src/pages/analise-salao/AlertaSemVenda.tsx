import type { ReactNode } from "react";
import { Alert } from "../../design-system";

// "Ainda não há venda neste período": só faz sentido culpar o agente do PDV quando o período NÃO é apenas o dia em
// andamento. Se o único dia pedido é hoje, ele ficou de fora de propósito e o aviso do dia já explica.
export function AlertaSemVenda({ dados, children }: { dados: { hojeFicouDeFora: boolean; periodo: { inicio: string; fim: string } }; children: ReactNode }) {
  if (dados.hojeFicouDeFora && dados.periodo.inicio === dados.periodo.fim) return null;
  return <Alert tone="info">{children}</Alert>;
}
