# Cadastros-mestre basicos

Foram adicionados cadastros para:

- categorias;
- subcategorias;
- unidades de medida;
- tipos de gasto.

Esses cadastros ficam preparados para uso futuro em:

- CMV;
- DRE;
- estoque;
- relatorios por grupo de gasto.

## Importacao de compras

Na importacao:

- categoria e subcategoria sao reutilizadas quando ja existem;
- categoria e subcategoria sao criadas automaticamente quando nao existem;
- produto e vinculado a categoria/subcategoria;
- unidade de medida e reutilizada ou criada pela sigla (`UND`, `KG`, etc.);
- item da compra e vinculado a unidade de medida;
- tipo de gasto e reutilizado ou criado pelo nome normalizado;
- compra e vinculada ao tipo de gasto mestre.

## Alertas

O relatorio de importacao alerta quando:

- unidade do item esta vazia;
- unidade do item diverge da unidade ja cadastrada no produto.
