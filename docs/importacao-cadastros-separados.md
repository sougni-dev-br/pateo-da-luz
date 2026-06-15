# Importacao separada de cadastros

Hoje as planilhas usam uma logica parecida com PROCV:

- cadastro de fornecedores;
- cadastro de produtos;
- lancamentos/compras.

O sistema passa a tratar os codigos como referencia principal para substituir esse relacionamento aos poucos.

## Prioridade de relacionamento

Fornecedor:

1. `COD. FORNECEDOR` / `COD. FORNE`
2. `CNPJ/CPF`
3. `FORNECEDOR`
4. `DATA CADASTRO` / `DT. CADASTRO` / `DATA DE CADASTRO` / `CADASTRO`

Produto:

1. `COD. PRODUTO` / `C. PRODUTO`
2. `ITEM/DESCRICAO` / `ITEM/DESCRIÇÃO` normalizado

## Importadores implementados

Fornecedores:

- `POST /imports/suppliers/preview`
- `POST /imports/suppliers/confirm`

Produtos:

- `POST /imports/products/preview`
- `POST /imports/products/confirm`

Desfazer lote de cadastro:

- `DELETE /imports/catalog/:importBatchId`

Cada preview retorna abas da planilha, aba selecionada, colunas detectadas, colunas nao reconhecidas, campos obrigatorios ausentes, primeiras linhas, erros e alertas.

Na confirmacao, registros existentes sao reutilizados por codigo primeiro. Atualizacoes em registros existentes so acontecem quando `updateExisting` for enviado como `true`.

A data de cadastro do fornecedor e gravada em `registrationDate`. Ela representa a data original da planilha e e independente do `createdAt` do sistema. Quando a celula vem vazia, o campo fica em branco e a importacao continua normalmente.

Existe uma planilha simples para teste rapido em:

```txt
samples/cadastros-importacao-exemplo.xlsx
```

Ela tem duas abas:

- `Fornecedores`
- `Produtos`

## Alertas na importacao

O preview e o relatorio final alertam quando encontrar:

- mesmo codigo com nomes diferentes;
- mesmo nome com codigos diferentes;
- registro sem codigo original;
- codigo ja existente com nome diferente no banco;
- nome ja existente com outro codigo no banco.

## Proxima evolucao

A proxima etapa natural e aplicar o mesmo padrao para:

1. formas de pagamento;
2. tipos de pequenos gastos;
3. compras usando cadastros ja validados.
