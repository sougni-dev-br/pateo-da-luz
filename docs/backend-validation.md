# Validacao manual do backend

Este roteiro valida o backend antes de ligar a tela de importacao no frontend.

## 1. Subir PostgreSQL pelo Docker

Na raiz do projeto:

```powershell
cd "C:\Users\Usuario\Documents\CMV Loja"
docker compose up -d
```

Se o comando `docker` nao existir, instale/inicie o Docker Desktop antes de continuar. Sem PostgreSQL rodando em `localhost:5432`, as migrations e a confirmacao da importacao nao conseguem gravar no banco.

Verifique se o container esta rodando:

```powershell
docker ps
```

Voce deve ver `cmv-loja-postgres`.

## 2. Instalar dependencias do backend

```powershell
cd "C:\Users\Usuario\Documents\CMV Loja\backend"
npm install
```

## 3. Configurar variaveis de ambiente

Copie o exemplo:

```powershell
Copy-Item .env.example .env
```

O conteudo esperado e:

```txt
DATABASE_URL="postgresql://cmv:cmv@localhost:5432/cmv_loja?schema=public"
PORT=3333
```

## 4. Rodar migrations do Prisma

```powershell
npm run prisma:migrate
```

Se o Prisma pedir um nome para a migration, use:

```txt
init
```

## 5. Iniciar o backend

```powershell
npm run dev
```

Teste a saude da API em outro PowerShell:

```powershell
Invoke-RestMethod http://localhost:3333/health
```

Retorno esperado:

```json
{
  "status": "ok"
}
```

## 6. Testar preview da planilha

Use a planilha exemplo gerada em:

```txt
C:\Users\Usuario\Documents\CMV Loja\samples\compras-exemplo.xlsx
```

Envie para preview:

```powershell
curl.exe -F "file=@C:\Users\Usuario\Documents\CMV Loja\samples\compras-exemplo.xlsx" http://localhost:3333/imports/purchases/preview
```

Confira no retorno:

- `importFileId`
- `detectedColumns`
- `unrecognizedColumns`
- `missingRequiredFields`
- `previewRows`

Para a planilha exemplo, `missingRequiredFields` deve voltar vazio.

## 7. Confirmar importacao

Copie o valor de `importFileId` retornado no preview e rode:

```powershell
curl.exe -X POST http://localhost:3333/imports/purchases/confirm -H "Content-Type: application/json" -d "{\"importFileId\":\"COLE_AQUI_O_IMPORT_FILE_ID\"}"
```

O relatorio final deve trazer:

- `importedRows`
- `ignoredRows`
- `suppliersCreated`
- `categoriesCreated`
- `subcategoriesCreated`
- `productsCreated`
- `productsReused`
- `purchasesCreated`
- `installmentsCreated`
- `errors`

## 8. Verificar no banco

Abra o Prisma Studio:

```powershell
cd "C:\Users\Usuario\Documents\CMV Loja\backend"
npm run prisma:studio
```

Confira as tabelas:

- `Supplier`
- `Category`
- `Subcategory`
- `Product`
- `ProductAlias`
- `Purchase`
- `PurchaseItem`
- `PaymentInstallment`

Tambem e possivel verificar pelo `psql` dentro do Docker:

```powershell
docker exec -it cmv-loja-postgres psql -U cmv -d cmv_loja
```

Consultas uteis:

```sql
select count(*) from "Purchase";
select count(*) from "PurchaseItem";
select count(*) from "PaymentInstallment";
select "purchaseDate", "totalAmount", "invoiceNumber" from "Purchase";
select "rawProductName", "quantity", "totalPrice" from "PurchaseItem";
select "dueDate", "amount", "installment", "rawValue" from "PaymentInstallment";
```

Para sair do `psql`:

```sql
\q
```

## 9. Resultado esperado com a planilha exemplo

A planilha exemplo possui 4 linhas:

- 2 itens da mesma NF do fornecedor Hortifruti Central.
- 1 item de Acougue Bom Corte.
- 1 pequeno gasto de Mercado Bairro.

Resultado esperado aproximado:

- `importedRows`: 4
- `ignoredRows`: 0
- `suppliersCreated`: 3
- `productsCreated`: 4
- `purchasesCreated`: 3
- `installmentsCreated`: 5

As parcelas podem variar no arredondamento conforme a divisao decimal feita pelo Prisma.
