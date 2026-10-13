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

// ─── iFood e Keeta ───────────────────────────────────────────────────────────
// Não há preço de tabela por pedido para essas plataformas (o iFood não tem integração em produção e a Keeta
// foi importada do portal, mensal/diária). O que existe é o faturamento lançado e o repasse: a razão é
// líquido ÷ faturamento bruto lançado. Pode ficar acima da razão "de tabela" da 99 se o bruto já vier com
// desconto da loja; por isso a tela diz de onde vem cada número.

export const JANELA_FATURAMENTO_DIAS = 90;
/** Loja com menos faturamento que isso na janela: a razão dela é ruído (taxa fixa pesa); vale a da plataforma. */
export const MINIMO_DE_FATURAMENTO_DA_LOJA = 2000;
/** Id de "loja" da plataforma sem lojas cadastradas (a Keeta é uma loja só, sem DeliveryStore). */
export const CHAVE_DA_PLATAFORMA = (canal: string) => `plataforma:${canal}`;

export type LinhaDeFaturamento = { descricao: string | null; bruto: number; liquido: number; de: Date; ate: Date };

export type CanalDeRazao = {
  channel: "NOVENTA_NOVE" | "IFOOD" | "KEETA";
  /** "tabela": líquido ÷ preço de tabela do pedido (99). "faturamento": líquido ÷ faturamento bruto lançado. */
  fonte: "tabela" | "faturamento";
  /** O que foi medido: pedidos (99) ou reais de faturamento (iFood, Keeta). */
  referencia: { pedidos?: number; faturamento?: number; de?: string; ate?: string };
  plataforma: { razao: number | null };
  lojas: RazaoDeLoja[];
};

const semEspacos = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "Delivery iFood - Pateo da Luz & Pizza (consolidado do mes)" → "pateo da luz & pizza". */
export function lojaDaDescricao(descricao: string | null): string | null {
  const achou = descricao?.match(/^Delivery iFood - (.+?)(?: \(consolidado do mes\))?$/i);
  return achou ? semEspacos(achou[1]) : null;
}

/**
 * Pura: razão líquido ÷ bruto lançado da plataforma e de cada loja (iFood casa a loja pelo nome na descrição).
 * `lojas` vazio = plataforma sem loja cadastrada (Keeta): vira uma "loja" só, a própria plataforma.
 */
export function calcularRazoesPorFaturamento(
  channel: "IFOOD" | "KEETA",
  linhas: LinhaDeFaturamento[],
  lojas: Array<{ id: string; nickname: string }>
): CanalDeRazao {
  const bruto = linhas.reduce((soma, linha) => soma + linha.bruto, 0);
  const liquido = linhas.reduce((soma, linha) => soma + linha.liquido, 0);
  const razaoDaPlataforma = bruto > 0 ? dividir(liquido, bruto) : null;

  const lojasDaTela: RazaoDeLoja[] = lojas.length === 0
    ? [{ deliveryStoreId: CHAVE_DA_PLATAFORMA(channel), storeName: channel === "KEETA" ? "Keeta (loja única)" : "Plataforma", razao: razaoDaPlataforma, pedidos: 0, base: "plataforma" }]
    : lojas.map((loja): RazaoDeLoja => {
        const dela = linhas.filter((linha) => lojaDaDescricao(linha.descricao) === semEspacos(loja.nickname));
        const brutoDela = dela.reduce((soma, linha) => soma + linha.bruto, 0);
        const liquidoDela = dela.reduce((soma, linha) => soma + linha.liquido, 0);
        const propria = brutoDela > 0 ? dividir(liquidoDela, brutoDela) : null;
        // Razão negativa ou de loja que quase não vendeu é taxa fixa pesando, não o custo de uma venda.
        const confiavel = propria != null && propria > 0 && brutoDela >= MINIMO_DE_FATURAMENTO_DA_LOJA;
        return { deliveryStoreId: loja.id, storeName: loja.nickname, razao: confiavel ? propria : razaoDaPlataforma, pedidos: 0, base: confiavel ? "loja" : "plataforma" };
      });

  const datas = linhas.flatMap((linha) => [linha.de, linha.ate]).sort((a, b) => a.getTime() - b.getTime());
  return {
    channel,
    fonte: "faturamento",
    referencia: {
      faturamento: Math.round(bruto * 100) / 100,
      ...(datas.length > 0 ? { de: datas[0].toISOString().slice(0, 10), ate: datas[datas.length - 1].toISOString().slice(0, 10) } : {})
    },
    plataforma: { razao: razaoDaPlataforma },
    lojas: lojasDaTela
  };
}

export function normalizarDias(valor: unknown): number {
  const dias = Math.round(Number(valor));
  if (!Number.isFinite(dias)) return DIAS_PADRAO;
  return Math.min(Math.max(dias, DIAS_MINIMO), DIAS_MAXIMO);
}

/** Faturamento e repasse lançados (RevenueEntry ativo) da plataforma, nos últimos 90 dias de dado que ela tem. */
async function razoesPorFaturamento(channel: "IFOOD" | "KEETA", sourcePlatform: string): Promise<CanalDeRazao> {
  const linhas = await prisma.$queryRaw<Array<{ descricao: string | null; bruto: number | null; liquido: number | null; de: Date; ate: Date }>>`
    WITH ultimo AS (
      SELECT MAX(date) AS dia FROM "RevenueEntry" WHERE status = 'ACTIVE' AND "sourcePlatform" = ${sourcePlatform}
    )
    SELECT r.description AS descricao, SUM(r."grossAmount") AS bruto, SUM(r."netAmount") AS liquido, MIN(r.date) AS de, MAX(r.date) AS ate
      FROM "RevenueEntry" r, ultimo
     WHERE r.status = 'ACTIVE' AND r."sourcePlatform" = ${sourcePlatform}
       AND r.date > ultimo.dia - make_interval(days => ${JANELA_FATURAMENTO_DIAS})
     GROUP BY r.description`;

  const lojas = await prisma.deliveryStore.findMany({
    where: { platform: channel, active: true },
    select: { id: true, nickname: true },
    orderBy: { nickname: "asc" }
  });

  return calcularRazoesPorFaturamento(
    channel,
    linhas.map((linha) => ({ descricao: linha.descricao, bruto: Number(linha.bruto ?? 0), liquido: Number(linha.liquido ?? 0), de: new Date(linha.de), ate: new Date(linha.ate) })),
    lojas
  );
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

    const noventaNove = calcularRazoes(
      linhas.map((linha) => ({
        deliveryStoreId: linha.id,
        nickname: linha.nickname,
        tabela: Number(linha.tabela ?? 0),
        liquido: Number(linha.liquido ?? 0),
        pedidos: Number(linha.pedidos ?? 0)
      })),
      dias
    );

    const [ifood, keeta] = await Promise.all([razoesPorFaturamento("IFOOD", "iFood"), razoesPorFaturamento("KEETA", "Keeta")]);

    response.json({
      // Campos da 99 na raiz: o que a tela anterior lia. `canais` traz as três plataformas, com a fonte de cada razão.
      ...noventaNove,
      canais: [
        {
          channel: "NOVENTA_NOVE", fonte: "tabela", referencia: { pedidos: noventaNove.plataforma.pedidos },
          plataforma: { razao: noventaNove.plataforma.razao }, lojas: noventaNove.lojas
        } satisfies CanalDeRazao,
        ifood,
        keeta
      ]
    });
  });
}
