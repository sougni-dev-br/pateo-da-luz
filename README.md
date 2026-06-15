# Pateo da Luz - Gestão Eficiente

Sistema local para gestao de compras, estoque, inventario e preparacao futura de CMV, DRE e integracao com vendas/PDV.

## V1

- PostgreSQL local via Docker.
- Backend Node.js + Express + Prisma.
- Frontend React + Vite.
- Importacao de planilhas Excel baseada nas colunas atuais.
- Camada flexivel de mapeamento de colunas antes do importador definitivo.
- Login local, usuarios, perfis de acesso e auditoria.
- Estoque atual, movimentacoes, contagens e divergencias.

## Planilha atual

O importador foi desenhado para respeitar os nomes usados hoje:

- DT. COMPRA
- COD. FORNE
- Nº NF
- CNPJ/CPF
- FORNECEDOR
- C. PRODUTO
- CATEGORIA
- SUB. CATEGORIA
- TIPO DE GASTOS
- ITEM/DESCRIÇÃO
- UND
- QTDE
- V.UNI
- V.TOTAL
- TIPO DE PAGAMENTO
- VENCIMENTOS

O arquivo principal dessa compatibilidade e:

```txt
backend/src/modules/imports/column-mapping/current-spreadsheet.mapping.ts
```

Ali ficam os aliases de colunas e os campos internos usados pelo banco.

## Como rodar depois de instalar Node/npm

Guias detalhados:

- `docs/windows-npm-path.md`: como resolver `npm` no PATH no Windows.
- `docs/backend-validation.md`: validacao manual do backend, do Docker ate a conferencia no banco.
- `docs/backend-validation-results.md`: resultado da validacao executada nesta maquina.
- `docs/primeira-planilha-teste.md`: como usar sua primeira planilha real.
- `docs/validacao-um-mes-real.md`: roteiro para validar com seguranca uma planilha real de 1 mes.
- `docs/importacao-cadastros-separados.md`: preparacao para substituir PROCV por relacionamentos no banco.
- `docs/cadastros-mestre-basicos.md`: categorias, subcategorias, unidades e tipos de gasto.
- `docs/formas-pagamento-pequenos-gastos.md`: formas de pagamento e tipos de pequenos gastos.
- `docs/estoque-seguranca-dashboard-v2.md`: usuarios, auditoria, estoque, inventario e endpoints novos.
- `docs/gestao-seguranca-controle-v3.md`: calendario do dashboard, senhas, cancelamento/restauracao de compras e auditoria visual.
- `docs/login-senhas-lockout-v4.md`: senha temporaria, troca obrigatoria, politica minima e bloqueio por tentativas invalidas.
- `samples/compras-exemplo.xlsx`: planilha pequena para teste rapido.

```bash
docker compose up -d
cd backend
cp .env.example .env
npm install
npm run prisma:migrate
npm run dev
```

Em outro terminal:

```bash
cd frontend
npm install
npm run dev
```
