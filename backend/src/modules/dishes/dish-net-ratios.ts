import type { Router } from "express";
import { prisma } from "../../config/database.js";

/**
 * Quanto do preço de tabela chega ao caixa em cada loja da 99, medido nos pedidos recentes: o líquido do
 * pedido (`netAmount`, já sem desconto bancado pela loja, comissão, taxa de pagamento, logística e frete grátis)
 * dividido pelo preço de tabela que a 99 manda em cada pedido (`mealOriginalAmount`). É o que permite dizer o CMV
 * sobre o que de fato entra, e não sobre o preço anunciado.
 *
 * É a MÉDIA da loja: um prato com oferta pesada (a Margherita a R$ 9,99) recebe bem menos que isso, e um sem oferta,
 * mais. Serve para comparar lojas e pratos; não substitui a conta de um prato só.
 */

export const DIAS_PADRAO = 60;
export const DIAS_MINIMO = 14;
export const DIAS_MAXIMO = 180;
/** Menos pedidos que isso e a razão da loja é ruído: usa a da plataforma toda. */
export const MINIMO_DE_PEDIDOS_DA_LOJA = 30;

export type LinhaDeLoja = { deliveryStoreId: string; nickname: string; tabela: number; liquido: number; pedidos: number };

export type RazaoDeLoja = {
  deliveryStoreId: string;
  storeName: string;
  /** Líquido ÷ tabela (0,46 = 46%); null sem pedido com preço de tabela. */
  razao: number | null;
  pedidos: number;
  /** "loja" = medida nos pedidos dela; "plataforma" = poucos pedidos, vale a média da 99. */
  base: "loja" | "plataforma";
};

export type RazoesLiquidas = {
  channel: "NOVENTA_NOVE";
  dias: number;
  plataforma: { razao: number | null; pedidos: number };
  lojas: RazaoDeLoja[];
};

const arredondar = (valor: number) => Math.round(valor * 10_000) / 10_000;
const dividir = (liquido: number, tabela: number) => (tabela > 0 ? arredondar(liquido / tabela) : null);

/** Pura: das somas por loja, a razão de cada uma e a da plataforma. */
export function calcularRazoes(linhas: LinhaDeLoja[], dias: number): RazoesLiquidas {
  const tabelaTotal = linhas.reduce((soma, linha) => soma + linha.tabela, 0);
  const liquidoTotal = linhas.reduce((soma, linha) => soma + linha.liquido, 0);
  const pedidosTotal = linhas.reduce((soma, linha) => soma + linha.pedidos, 0);
  const razaoDaPlataforma = dividir(liquidoTotal, tabelaTotal);

  const lojas = linhas.map((linha): RazaoDeLoja => {
    const propria = dividir(linha.liquido, linha.tabela);
    const confiavel = propria != null && linha.pedidos >= MINIMO_DE_PEDIDOS_DA_LOJA;
    return {
      deliveryStoreId: linha.deliveryStoreId,
      storeName: linha.nickname,
      razao: confiavel ? propria : razaoDaPlataforma,
      pedidos: linha.pedidos,
      base: confiavel ? "loja" : "plataforma"
    };
  });

  return { channel: "NOVENTA_NOVE", dias, plataforma: { razao: razaoDaPlataforma, pedidos: pedidosTotal }, lojas };
}

export function normalizarDias(valor: unknown): number {
  const dias = Math.round(Number(valor));
  if (!Number.isFinite(dias)) return DIAS_PADRAO;
  return Math.min(Math.max(dias, DIAS_MINIMO), DIAS_MAXIMO);
}

export function registrarRotaDeRazaoLiquida(router: Router) {
  router.get("/net-ratios", async (request, response) => {
    const dias = normalizarDias(request.query.dias ?? DIAS_PADRAO);
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    // Só pedidos que TÊM o preço de tabela: sem ele, o líquido entraria no numerador e não no denominador.
    const linhas = await prisma.$queryRaw<Array<{ id: string; nickname: string; tabela: number | null; liquido: number | null; pedidos: number }>>`
      SELECT s."deliveryStoreId" AS id, st."nickname" AS nickname,
             SUM((s."rawPayload"->>'mealOriginalAmount')::numeric / 100) AS tabela,
             SUM(s."netAmount") AS liquido,
             COUNT(*)::int AS pedidos
        FROM "NoventaNoveSale" s
        JOIN "DeliveryStore" st ON st.id = s."deliveryStoreId"
       WHERE st.platform = 'NOVENTA_NOVE' AND st.active = true
         AND s."orderDate" >= ${desde}
         AND s.channel IN ('DELIVERY', 'DELIVERY_REFUND')
         AND s."rawPayload"->>'mealOriginalAmount' IS NOT NULL
       GROUP BY s."deliveryStoreId", st."nickname"
       ORDER BY st."nickname"`;

    response.json(
      calcularRazoes(
        linhas.map((linha) => ({
          deliveryStoreId: linha.id,
          nickname: linha.nickname,
          tabela: Number(linha.tabela ?? 0),
          liquido: Number(linha.liquido ?? 0),
          pedidos: Number(linha.pedidos ?? 0)
        })),
        dias
      )
    );
  });
}
