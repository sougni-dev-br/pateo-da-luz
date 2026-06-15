# Primeira planilha real para teste

## Onde colocar

Voce pode manter sua planilha em qualquer pasta do computador. Para o primeiro teste, recomendo criar uma pasta simples:

```txt
C:\Users\Usuario\Documents\CMV Loja\planilhas-teste
```

Coloque ali uma copia da planilha mensal real, por exemplo:

```txt
compras-2026-01.xlsx
```

Use uma copia, nao o arquivo original de trabalho.

## Abas

Na V1, o importador le a primeira aba da planilha. Se o arquivo tiver varias abas, deixe a aba de compras como a primeira.

## Cabecalhos esperados

A primeira linha da aba deve conter os cabecalhos atuais, como:

```txt
DT. COMPRA
COD. FORNE
N. NF
CNPJ/CPF
FORNECEDOR
C. PRODUTO
CATEGORIA
SUB. CATEGORIA
TIPO DE GASTOS
ITEM/DESCRICAO
UND
QTDE
V.UNI
V.TOTAL
TIPO DE PAGAMENTO
VENCIMENTOS
```

Nao precisa ter todas as colunas para a previa funcionar, mas para importar de verdade a planilha precisa ter pelo menos:

```txt
DT. COMPRA
FORNECEDOR
ITEM/DESCRICAO
QTDE
V.TOTAL
```

## Vencimentos

A coluna `VENCIMENTOS` pode ficar em branco para compra a vista. Para parcelas, comece com datas separadas por ponto e virgula:

```txt
10/01/2026; 10/02/2026; 10/03/2026
```

Na V1, o sistema divide o valor total igualmente entre os vencimentos detectados.

## Fluxo de teste via API

1. Envie a planilha para previa:

```bash
curl -F "file=@C:\Users\Usuario\Documents\CMV Loja\planilhas-teste\compras-2026-01.xlsx" http://localhost:3333/imports/purchases/preview
```

2. Confira no retorno:

- `detectedColumns`
- `unrecognizedColumns`
- `missingRequiredFields`
- `previewRows`
- `importFileId`

3. Confirme a importacao usando o `importFileId` retornado:

```bash
curl -X POST http://localhost:3333/imports/purchases/confirm ^
  -H "Content-Type: application/json" ^
  -d "{\"importFileId\":\"NOME_RETORNADO_NA_PREVIA\"}"
```

4. O retorno final mostra:

- linhas importadas
- linhas ignoradas
- fornecedores criados
- categorias criadas
- subcategorias criadas
- produtos criados
- produtos reaproveitados
- compras criadas
- parcelas criadas
- erros encontrados
