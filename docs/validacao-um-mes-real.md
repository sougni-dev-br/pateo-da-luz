# Validacao de 1 mes real

Antes de importar varios meses, valide um unico arquivo mensal.

## 1. Reiniciar backend

Depois desta etapa, reinicie o backend para carregar as novas rotas:

```powershell
cd "C:\Users\Usuario\Documents\CMV Loja\backend"
npm run build
npm start
```

Em desenvolvimento:

```powershell
npm run dev
```

## 2. Aplicar banco

Se ainda nao aplicou a migration nova:

```powershell
cd "C:\Users\Usuario\Documents\CMV Loja\backend"
npm run prisma:migrate
```

A migration adiciona o controle de lote de importacao, usado para desfazer uma importacao de teste.

## 3. Importar somente 1 mes

No frontend:

```txt
http://localhost:5173
```

Abra `Importar Excel`, selecione a planilha real de um mes e gere o preview.

## 4. Conferir antes de confirmar

Confira:

- total de linhas;
- total da planilha;
- colunas obrigatorias ausentes;
- colunas nao reconhecidas;
- fornecedores unicos;
- produtos unicos;
- produtos repetidos;
- categorias;
- subcategorias;
- formas de pagamento;
- preview das primeiras linhas.

## 5. Confirmar e conferir relatorio

Depois de confirmar, confira:

- total da planilha x total importado;
- diferenca;
- linhas importadas;
- linhas ignoradas;
- fornecedores criados e reaproveitados;
- produtos criados e reaproveitados;
- compras criadas;
- vencimentos/parcelas criados;
- avisos de vencimentos nao interpretados;
- linhas com erro.

## 6. Desfazer teste se vier errado

Use o botao `Excluir importacao de teste` no relatorio.

Ele remove:

- compras;
- itens;
- vencimentos/parcelas.

Ele preserva cadastros de fornecedores, produtos e categorias, porque esses cadastros podem ja estar sendo reaproveitados por outras importacoes.

## 7. Conferir telas

Depois da importacao:

- `Compras`: filtre por mes, ano, fornecedor, categoria, produto, pagamento e item.
- `Fornecedores`: busque por nome, codigo ou documento.
- `Produtos`: busque por nome e categoria.
- `Dashboard`: confira total do mes, comparacao com mes anterior, categorias, fornecedores e produtos.
