// Para onde cada pendência do fechamento leva.
//
// Uma pendência que só diz o que falta obriga a pessoa a lembrar onde se
// resolve — e o fechamento passa por seis áreas do sistema. Aqui cada chave
// aponta para a tela em que ela é resolvida. Rotas internas, para navegar sem
// recarregar a página.

import { ROTAS_RH } from "../pages/rh/rotasRh";

export type DestinoDaPendencia = { rotulo: string; rota: string };

const POR_CHAVE: Record<string, DestinoDaPendencia> = {
  "block:revenue": { rotulo: "Abrir Faturamento", rota: "/financeiro/faturamento" },
  "block:eventRevenue": { rotulo: "Lançar evento", rota: "/financeiro/faturamento" },
  "block:purchasesWithoutItems": { rotulo: "Abrir Compras", rota: "/compras" },
  "block:purchaseDateFarFromCompetence": { rotulo: "Abrir Compras", rota: "/compras" },
  "block:payrollNotLaunched": { rotulo: "Abrir Folha", rota: ROTAS_RH.folha },
  "block:payrollWithoutDreCategory": { rotulo: "Abrir Folha", rota: ROTAS_RH.folha },
  "block:tipsNotClosed": { rotulo: "Abrir Gorjeta", rota: ROTAS_RH.gorjeta },
  "block:taxes": { rotulo: "Abrir Impostos", rota: "/financeiro/impostos" },
  "block:taxesWithoutCompetence": { rotulo: "Abrir Impostos", rota: "/financeiro/impostos" },
  "block:finalInventory": { rotulo: "Abrir Contagens", rota: "/estoque/contagens" },
  "block:inventoryItemsWithoutCost": { rotulo: "Abrir Inventário", rota: "/estoque/inventario" }
};

const POR_PREFIXO: Array<[string, DestinoDaPendencia]> = [
  ["card:", { rotulo: "Abrir Cartões", rota: "/financeiro/cartoes" }],
  ["delivery:", { rotulo: "Abrir Delivery", rota: "/financeiro/delivery" }],
  ["supplier:", { rotulo: "Abrir Compras", rota: "/compras" }]
];

export function destinoDaPendencia(key: string): DestinoDaPendencia | null {
  const direto = POR_CHAVE[key];
  if (direto) return direto;
  return POR_PREFIXO.find(([prefixo]) => key.startsWith(prefixo))?.[1] ?? null;
}
