# Arquitetura da V1

## Decisao principal

A V1 preserva a planilha atual como formato de entrada. O banco fica mais organizado por tras, mas o importador conhece os cabecalhos usados hoje e converte cada linha para um formato interno.

## Camada de mapeamento

Arquivo:

```txt
backend/src/modules/imports/column-mapping/current-spreadsheet.mapping.ts
```

Esse arquivo liga os nomes das colunas da planilha aos campos internos do sistema.

Exemplo:

```ts
productDescription: [
  "ITEM/DESCRI\u00c7\u00c3O",
  "ITEM/DESCRICAO",
  "DESCRI\u00c7\u00c3O",
  "DESCRICAO",
  "ITEM"
]
```

Se uma planilha vier com uma variacao, basta adicionar mais um alias nessa lista. O restante do importador continua igual.

## Campos internos da compra

- purchaseDate: data da compra e base inicial da competencia.
- supplierCode: codigo do fornecedor na planilha.
- invoiceNumber: numero da nota fiscal.
- supplierDocument: CNPJ ou CPF.
- supplierName: fornecedor.
- productCode: codigo do produto na planilha.
- categoryName: categoria.
- subcategoryName: subcategoria.
- expenseType: tipo de gasto.
- productDescription: item/descricao.
- unit: unidade.
- quantity: quantidade.
- unitPrice: valor unitario.
- totalPrice: valor total.
- paymentMethod: forma de pagamento.
- dueDates: vencimentos/parcelas em formato bruto para interpretacao posterior.

## Preparacao para proximas fases

- Competencia: guardada em `competenceMonth` e `competenceYear`.
- Regime de caixa: preparado em `PaymentInstallment`, com `dueDate` e `paidDate`.
- Pequenos gastos: campo `isSmallExpense` em compras.
- CMV: produtos, categorias e unidades ficam normalizados para futura relacao com estoque e vendas.
- DRE: tipo de gasto, categorias, pagamentos e competencia ja ficam separados.
