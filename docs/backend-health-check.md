# Backend Health Check e Validacao dos Modulos Financeiros

## 1. Subir banco

```powershell
cd "C:\Users\Usuario\Documents\CMV Loja"
docker compose up -d
```

## 2. Rodar migrations e Prisma

```powershell
cd "C:\Users\Usuario\Documents\CMV Loja\backend"
npx prisma generate
npx prisma migrate deploy
```

## 3. Subir backend

```powershell
npm run build
$env:PORT=3334
node dist/server.js
```

## 4. Validar health

Abrir:

```text
http://localhost:3334/health
```

Resultado esperado:

```json
{"status":"ok"}
```

## 5. Subir frontend

```powershell
cd "C:\Users\Usuario\Documents\CMV Loja\frontend"
npm run dev -- --host 0.0.0.0 --port 5174
```

## 6. Configuracao atual

Frontend:

* `VITE_API_URL=/api`

Proxy Vite:

* `/api` -> `http://127.0.0.1:3334`

## 7. Login teste

```text
admin@pateodaluz.local
Pateo1234
```

## 8. Checklist de validacao

Validar:

* Login
* Dashboard
* Compras
* Contas a pagar
* Cartoes
* Faturamento
* CMV Real
* Fechamento mensal
* Estoque
* Importacao Excel
* Importacao de inventario

## 9. Testes especificos de Cartoes

Validar:

* abrir menu Cartoes
* listar cartoes vazio
* criar cartao
* criar fatura
* listar fatura
* backend continuar vivo
* `/health` continuar OK

## 10. Observacoes criticas

* Nao usar Prisma Accelerate.
* Nao usar Data Proxy.
* Nao usar `@prisma/client/edge`.
* Nao usar URL `prisma://`.
* Usar Prisma local normal:

```ts
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
```

## 11. Erros conhecidos

Documentar:

* `Backend OFFLINE` = backend nao esta respondendo na porta 3334.
* `HTTP 502` no frontend = rota backend falhou ou proxy recebeu erro.
* `URL must start with prisma://` = algum import/uso errado de Prisma Edge/Accelerate.
* `Do not know how to serialize a BigInt` = retorno JSON precisa converter BigInt.
