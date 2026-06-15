# Conversao de unidades dos produtos

O cadastro de produtos agora separa:

- unidade original/padrao de compra;
- unidade base de controle e CMV;
- fator de conversao;
- peso medio por caixa, pacote ou fardo;
- observacoes de conversao;
- conversoes especificas por produto, como `CX -> KG`, `PCT -> KG`, `FD -> UN`.

## Exemplo

Produto: tomate

- compra na nota: `1 CX`
- valor unitario original: `R$ 180,00`
- unidade base: `KG`
- fator: `18`

Na importacao de compras, o item preserva os dados originais:

- unidade original: `CX`
- quantidade original: `1`
- valor unitario original: `180`
- valor total original: `180`

E grava os dados convertidos:

- unidade convertida: `KG`
- quantidade convertida: `18`
- valor unitario convertido: `10`
- fator usado: `18`

## Regras na importacao

Quando a unidade da planilha for igual a unidade base do produto, o fator usado e `1`.

Quando a unidade da planilha for diferente da unidade base, o sistema procura primeiro uma conversao ativa do produto com `fromUnit -> toUnit`.

Se nao encontrar uma conversao especifica, usa a conversao padrao do produto quando `purchaseUnit` for igual a unidade da planilha.

Se nao houver fator cadastrado, a importacao continua e o item fica marcado com `conversionMissing = true`, com alerta no relatorio para revisao.

## Campos preparados para relatorios

Em `PurchaseItem`:

- `unit`, `quantity`, `unitPrice`, `totalPrice`: dados originais da planilha;
- `convertedUnit`, `convertedQuantity`, `convertedUnitPrice`, `conversionFactorUsed`: dados calculados;
- `conversionMissing`: indica item que precisa de revisao de conversao.
