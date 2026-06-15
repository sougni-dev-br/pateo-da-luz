# CMV Loja / Pateo da Luz - Deploy Guide

Este documento consolida o estado atual do sistema para deploy, manutencao e continuidade no Claude Code.

## Visao Geral

Aplicacao local para restaurante com foco em:

- compras e contas a pagar
- importacao de planilhas Excel
- cadastros mestres
- estoque e inventario
- fechamento mensal e CMV
- auditoria e seguranca
- dashboards e relatorios

Stack atual:

- backend: Node.js + Express + Prisma + PostgreSQL
- frontend: React + Vite
- upload e processamento de Excel: ExcelJS
- autenticao: JWT/token salvo em `localStorage`

Branding atual:

- nome: `Pateo da Luz - Gestao Eficiente`
- logo: `frontend/src/assets/logo-pateo-luz.png`
- menu lateral e login com identidade visual padronizada

## Estrutura Principal

- backend: API Express, rotas por dominio
- frontend: SPA React com menu por permissao
- Prisma: schema unico com todas as tabelas e relacionamentos
- uploads: arquivos temporarios em `backend/uploads/`

## Variaveis De Ambiente

### Backend

- `DATABASE_URL`
  - string de conexao do PostgreSQL usada pelo Prisma
- `PORT`
  - porta HTTP do backend
  - default no codigo: `3333`

### Frontend

- `VITE_API_URL`
  - URL base da API usada pelo frontend
  - default no codigo: `http://localhost:3334`

### Variaveis De Runtime E Persistencia

- `localStorage.pateo_session_token`
  - token de sessao do usuario logado no navegador
- `backend/uploads/`
  - diretorio temporario para arquivos Excel enviados
- `frontend/src/assets/logo-pateo-luz.png`
  - logo oficial usada no app

## Comandos Principais

### Backend

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run build
npm run dev
npm run start
```

### Frontend

```bash
npm install
npm run build
npm run dev
npm run preview
```

## Banco De Dados

### Enums

- `ExpenseType`
  - `FOOD`, `BEVERAGE`, `PACKAGING`, `CLEANING`, `ADMINISTRATIVE`, `SMALL_EXPENSE`, `OTHER`
- `PaymentRegime`
  - `CASH`, `ACCRUAL`
- `PaymentMethodType`
  - `CASH`, `PIX`, `CREDIT_CARD`, `DEBIT_CARD`, `BANK_SLIP`, `TRANSFER`, `OTHER`
- `CatalogImportType`
  - `SUPPLIERS`, `PRODUCTS`, `PAYMENT_METHODS`, `SMALL_EXPENSE_TYPES`
- `CatalogImportAction`
  - `CREATED`, `UPDATED`
- `UserRole`
  - `ADMIN`, `GESTAO_COMPLETA`, `ESTOQUISTA`, `VISUALIZACAO`
- `InventoryMovementType`
  - `PURCHASE_IN`, `MANUAL_OUT`, `LOSS`, `BREAKAGE`, `INTERNAL_CONSUMPTION`, `EMPLOYEE_PURCHASE`, `POSITIVE_ADJUSTMENT`, `NEGATIVE_ADJUSTMENT`, `RETURN`, `ADJUSTMENT`, `TRANSFER`
- `StockCountFrequency`
  - `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`
- `InventorySnapshotType`
  - `INVENTARIO_INICIAL`, `INVENTARIO_FINAL`, `CONTAGEM_PARCIAL`, `AJUSTE`
- `MonthlyCloseStatus`
  - `OPEN`, `CLOSED`

### Tabelas / Models

- `Supplier`
  - cadastro mestre de fornecedores
  - campos relevantes: `externalCode`, `document`, `name`, `normalizedName`, `phone`, `email`, `contactName`, `mainCategory`, `defaultPaymentTermDays`, `registrationDate`, `isActive`, `notes`
- `PurchaseSequence`
  - gerador de numero interno sequencial por ano
  - exemplo: `CMP-2026-000001`
- `User`
  - usuarios do sistema
  - campos relevantes: `email`, `passwordHash`, `role`, `isActive`, `mustChangePassword`, `passwordChangedAt`, `failedLoginAttempts`, `lockedUntil`, `lastLoginAt`
- `UserSession`
  - sessoes autenticadas por token
- `AuditLog`
  - trilha de auditoria de acoes criticas
- `Category`
  - categorias de produtos e compras
- `Subcategory`
  - subcategorias vinculadas a categoria
- `UnitMeasure`
  - unidades de medida
  - campos relevantes: `code`, `name`, `type`, `isActive`, `notes`
- `InventorySector`
  - setores fisicos de inventario
  - campos relevantes: `name`, `normalizedName`, `description`, `countOrder`, `isActive`, `notes`
- `ExpenseTypeMaster`
  - tipo de gasto principal
- `Product`
  - cadastro mestre de produto
  - campos relevantes: `externalCode`, `name`, `normalizedName`, `unit`, `unitMeasureId`, `stockUnit`, `purchaseUnit`, `baseUnit`, `conversionFactor`, `packageWeight`, `conversionNotes`, `logisticsNotes`, `categoryId`, `subcategoryId`, `inventorySectorId`, `storageLocation`, `storageCorridor`, `storageShelf`, `storagePosition`, `storageNotes`, `accountType`, `controlsStock`, `isActive`, `notes`
- `ProductUnitConversion`
  - conversoes por produto
  - campos: `fromUnit`, `toUnit`, `factor`, `averagePackageWeight`, `notes`, `isActive`
- `PaymentMethod`
  - formas de pagamento
  - campos: `name`, `normalizedName`, `type`, `group`, `isActive`, `notes`
- `SmallExpenseType`
  - tipos de pequenos gastos
- `ProductAlias`
  - aliases de nome para produto
- `ImportBatch`
  - lote de importacao de compras
- `ImportConflictDecision`
  - decisoes salvas para conflitos de importacao
- `InventoryStock`
  - estoque atual por produto
  - campos relevantes: `currentQuantity`, `averageCost`, `costPerKg`, `costPerBox`, `costPerUnit`, `minQuantity`, `lastMovementAt`
- `InventoryMovement`
  - historico de movimentacoes
  - campos relevantes: `type`, `quantity`, `unit`, `unitMeasureId`, `unitCost`, `totalCost`, `sourcePurchaseItemId`, `sourceStockCountId`, `responsibleUserId`, `notes`, `isCancelled`, `cancelledAt`, `cancelledByPurchaseId`, `restoredAt`
- `StockCount`
  - contagem de inventario/estoque
  - campos relevantes: `productCodeSnapshot`, `productNameSnapshot`, `sectorSnapshot`, `categorySnapshot`, `subcategorySnapshot`, `unitSnapshot`, `countedQuantity`, `expectedQuantity`, `divergenceQuantity`, `status`, `notes`, `adjustmentGenerated`, `adjustmentMovementId`
- `InventoryAgendaRule`
  - agenda de inventario
  - campos relevantes: `dayOfWeek`, `sectorId`, `sectorName`, `categoryId`, `categoryName`, `frequency`, `defaultResponsibleUserId`, `notes`, `isActive`
- `InventoryAgendaItem`
  - item planejado da agenda
  - campos relevantes: `scheduledDate`, `sectorId`, `sectorName`, `categoryId`, `categoryName`, `status`, `responsibleUserId`, `notes`, `startedAt`, `submittedAt`, `confirmedAt`
- `StockCountPolicy`
  - politica global de periodicidade
- `CatalogImportBatch`
  - lote de importacao de cadastros
- `CatalogImportChange`
  - alteracoes aplicadas em importacao de cadastro
- `Purchase`
  - compras e lancamentos
  - campos relevantes: `purchaseNumber`, `duplicateKey`, `workflowStatus`, `purchaseDate`, `competenceMonth`, `competenceYear`, `supplierId`, `invoiceNumber`, `rawSupplierCode`, `paymentMethod`, `paymentMethodId`, `paymentRegime`, `expenseType`, `expenseTypeId`, `smallExpenseTypeId`, `isSmallExpense`, `totalAmount`, `sourceFile`, `importBatchId`, `status`, `cancelledAt`, `cancellationReason`, `cancelledByUserId`, `restoredAt`, `restoredByUserId`, `rawRow`
- `PurchaseItem`
  - itens da compra
  - campos relevantes: `productId`, `rawProductCode`, `rawProductName`, `unit`, `unitMeasureId`, `quantity`, `unitPrice`, `totalPrice`, `convertedUnit`, `convertedQuantity`, `convertedUnitPrice`, `conversionFactorUsed`, `conversionMissing`, `rawCategory`, `rawSubcategory`
- `PaymentInstallment`
  - parcelas / contas a pagar
  - campos relevantes: `dueDate`, `paidDate`, `paidAmount`, `amount`, `installment`, `paymentMethodId`, `paymentMethodName`, `paidPaymentMethodId`, `paidPaymentMethodName`, `paymentNotes`, `paidByUserId`, `reversedAt`, `reversedByUserId`, `status`, `rawValue`
- `InventorySnapshot`
  - inventarios mensais
  - campos relevantes: `competenceYear`, `competenceMonth`, `type`, `countDate`, `status`, `totalItems`, `totalValue`, `importFileId`, `originalFileName`, `createdByUserId`, `cancelledAt`, `cancelledByUserId`, `cancellationReason`, `notes`
- `InventorySnapshotItem`
  - itens de um inventario mensal
  - campos relevantes: `productId`, `productCode`, `productName`, `sectorName`, `categoryName`, `subcategoryName`, `unit`, `quantity`, `unitCost`, `totalCost`, `divergenceQuantity`, `sourceRowNumber`, `resolutionStatus`
- `RevenueEntry`
  - faturamento por competencia e canal
  - campos relevantes: `date`, `competenceYear`, `competenceMonth`, `channel`, `description`, `grossAmount`, `discounts`, `platformFees`, `netAmount`, `paymentMethod`, `notes`, `status`, `cancelledAt`, `cancellationReason`, `createdByUserId`
- `MonthlyCmv`
  - fechamento mensal e CMV
  - campos relevantes: `competenceYear`, `competenceMonth`, `initialInventoryValue`, `purchasesValue`, `finalInventoryValue`, `realCmvValue`, `revenueGrossValue`, `revenueNetValue`, `cmvPercent`, `estimatedGrossMargin`, `status`, `closedByUserId`, `closedAt`, `reopenedByUserId`, `reopenedAt`, `reopenReason`, `notes`

### Relacoes Principais

- `Supplier` -> `Purchase`
- `Product` -> `Category`, `Subcategory`, `InventorySector`, `UnitMeasure`
- `Purchase` -> `Supplier`, `PaymentMethod`, `ExpenseTypeMaster`, `SmallExpenseType`, `ImportBatch`
- `Purchase` -> `PurchaseItem`, `PaymentInstallment`
- `PurchaseItem` -> `Product`, `UnitMeasure`
- `InventoryStock` -> `Product`, `UnitMeasure`
- `InventoryMovement` -> `Product`, `UnitMeasure`
- `StockCount` -> `Product`, `UnitMeasure`, `InventoryAgendaItem`
- `InventoryAgendaRule` / `InventoryAgendaItem` -> `InventorySector`, `Category`, `User`
- `InventorySnapshot` -> `InventorySnapshotItem`
- `PaymentInstallment` -> `Purchase`, `PaymentMethod`

## Endpoints Backend

### Health

- `GET /health`

### Auth E Usuarios

- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/change-password`
- `GET /users`
- `POST /users`
- `PATCH /users/:id/status`
- `PUT /users/:id`
- `PATCH /users/:id/password`

### Fornecedores

- `GET /suppliers`
- `POST /suppliers`
- `PUT /suppliers/:id`
- `PATCH /suppliers/:id/status`
- `GET /suppliers/:id/history`

### Produtos

- `GET /products`
- `POST /products`
- `PUT /products/:id`
- `POST /products/:id/aliases`
- `PATCH /products/:id/status`

### Formas De Pagamento

- `GET /payment-methods`
- `POST /payment-methods`
- `PUT /payment-methods/:id`
- `PATCH /payment-methods/:id/status`

### Compras

- `GET /purchases`
- `GET /purchases/:id`
- `POST /purchases`
- `PUT /purchases/:id`
- `PATCH /purchases/:id/cancel`
- `PATCH /purchases/:id/restore`
- `GET /purchases/payables`
- `GET /purchases/payables/:id/history`
- `PATCH /purchases/payables/:id/pay`
- `PATCH /purchases/payables/:id/reverse`
- `GET /purchases/reports/supplier-position.pdf`
- `GET /purchases/payables/report.pdf`

### Importacao De Compras

- `POST /imports/purchases/preview`
- `POST /imports/purchases/confirm`
- `DELETE /imports/purchases/:importBatchId`

### Importacao De Cadastros

- `POST /imports/suppliers/preview`
- `POST /imports/suppliers/confirm`
- `POST /imports/products/preview`
- `POST /imports/products/confirm`
- `DELETE /imports/catalog/:importBatchId`

### Conflitos De Importacao

- `POST /import-conflicts/decisions`
- `GET /import-conflicts/decisions`

### Estoque / Inventario

- `GET /inventory/stocks`
- `GET /inventory/movements`
- `POST /inventory/movements`
- `GET /inventory/counts`
- `POST /inventory/counts`
- `GET /inventory/policy`
- `PUT /inventory/policy`
- `GET /inventory/agenda`
- `POST /inventory/agenda/rules`
- `PUT /inventory/agenda/rules/:id`
- `DELETE /inventory/agenda/rules/:id`
- `GET /inventory/agenda/:id/detail`
- `PATCH /inventory/agenda/:id/start`
- `PATCH /inventory/agenda/:id/submit`
- `PATCH /inventory/agenda/:id/confirm`

### Fechamento Mensal / Revenue / CMV

- `POST /monthly/inventory/preview`
- `POST /monthly/inventory/confirm`
- `GET /monthly/inventory`
- `GET /monthly/inventory/:id`
- `DELETE /monthly/inventory/:id`
- `GET /monthly/revenue`
- `POST /monthly/revenue`
- `PUT /monthly/revenue/:id`
- `DELETE /monthly/revenue/:id`
- `GET /monthly/cmv`
- `POST /monthly/cmv/calculate`
- `POST /monthly/cmv/close`
- `POST /monthly/cmv/reopen`

### Auditoria

- `GET /audit`

### Dashboard

- `GET /dashboard/purchases`

### Master Data

- `GET /master-data/sectors`
- `POST /master-data/sectors`
- `PUT /master-data/sectors/:id`
- `PATCH /master-data/sectors/:id/status`
- `GET /master-data/categories`
- `POST /master-data/categories`
- `PUT /master-data/categories/:id`
- `PATCH /master-data/categories/:id/status`
- `GET /master-data/subcategories`
- `POST /master-data/subcategories`
- `PUT /master-data/subcategories/:id`
- `PATCH /master-data/subcategories/:id/status`
- `GET /master-data/units`
- `POST /master-data/units`
- `PUT /master-data/units/:id`
- `PATCH /master-data/units/:id/status`
- `GET /master-data/expense-types`
- `POST /master-data/expense-types`
- `PUT /master-data/expense-types/:id`
- `PATCH /master-data/expense-types/:id/status`
- `GET /master-data/small-expense-types`
- `POST /master-data/small-expense-types`
- `PUT /master-data/small-expense-types/:id`
- `PATCH /master-data/small-expense-types/:id/status`

## Frontend / Telas

### Rotas / Menus

- Dashboard
- Importar Excel
- Importar cadastros
- Compras
- Contas a pagar
- Fechamento mensal
- Estoque
- Produtos
- Fornecedores
- Pagamentos
- Cadastros base
- Usuarios
- Auditoria

### Paginas React

- `Login`
- `ForcedPasswordChange`
- `Dashboard`
- `ImportExcel`
- `CatalogImports`
- `Purchases`
- `Payables`
- `MonthlyClosing`
- `Inventory`
- `Products`
- `Suppliers`
- `PaymentMethods`
- `MasterData`
- `Users`
- `Audit`

### Regras De Interface Importantes

- token de login fica em `localStorage.pateo_session_token`
- frontend aponta para `VITE_API_URL` ou `http://localhost:3334`
- menu lateral filtra por role
- `ESTOQUISTA` enxerga apenas estoque/inventario e sair
- `VISUALIZACAO` enxerga apenas telas sem importacao/admin
- `ADMIN` e `GESTAO_COMPLETA` veem a maior parte das operacoes

## Fluxos Implementados

### Autenticacao E Senhas

- login com email/senha
- hash de senha com `scryptSync` via `hashPassword`
- bloqueio apos tentativas invalidas
- `lockedUntil` e `failedLoginAttempts`
- `mustChangePassword`
- alteracao de senha propria
- reset de senha por admin
- senha temporaria por admin
- audit log em login, login invalido, bloqueio, troca de senha e reset

### Compras

- compra manual
- importacao Excel com preview
- numero interno sequencial `CMP-AAAA-NNNNNN`
- validacao de duplicidade por fornecedor/NF/data/total
- cancelamento e restauracao com estorno de estoque
- conta a pagar gerada por parcelas

### Importacao Excel

- preview antes de confirmar
- mapeamento flexivel de colunas
- fallback por codigo, CNPJ, nome normalizado e alias
- conflitos com decisao persistida
- modo historico para planilhas antigas
- opcao de ignorar linhas sem produto
- agrupamento por nota e fornecedor

### Cadastros Mestres

- fornecedores
- produtos
- formas de pagamento
- tipos de pequenos gastos
- categorias
- subcategorias
- unidades
- tipos de gasto
- setores

### Estoque / Inventario

- estoque atual
- movimentacoes
- contagens
- agenda mensal por setor/categoria
- aprovacao de contagem
- estimativas futuras para CMV e divergencias

### Fechamento Mensal

- inventario inicial
- inventario final
- faturamento
- CMV real
- fechamento e reabertura por competencia

### Relatorios PDF

- posicao de fornecedor
- financeiro de contas a pagar
- log de geracao em AuditLog

## Observacoes Operacionais

- a aplicacao foi desenvolvida para rodar localmente
- o backend atual usa rota base em `http://localhost:3334` no frontend
- se o backend subir em outra porta, ajustar `VITE_API_URL`
- o Prisma depende de `DATABASE_URL`
- arquivos Excel entram em `backend/uploads/`

## Pontos Para Deploy No Claude Code

1. subir PostgreSQL
2. configurar `DATABASE_URL`
3. rodar `npm run prisma:migrate`
4. rodar `npm run build` no backend e frontend
5. garantir `VITE_API_URL` apontando para o backend correto
6. validar login e relatorios PDF
7. validar importacao de compras e inventario

