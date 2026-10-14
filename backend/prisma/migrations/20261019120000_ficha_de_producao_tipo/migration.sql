-- Ficha de producao x prato vendido: a ficha de producao (a massa do nhoque) nao e vendida e so serve de ingrediente.
-- Sem preco de venda, categoria nem segundo cardapio; o vinculo com canais e PDV a aplicacao confere.
ALTER TABLE "Dish" ADD COLUMN "fichaDeProducao" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_producao_nao_e_vendida" CHECK (
  NOT "fichaDeProducao" OR ("salePriceDefault" IS NULL AND "categoryId" IS NULL AND "alsoMenu" IS NULL AND "alsoCategoryId" IS NULL)
);
