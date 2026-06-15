# Claude Code Import Guide

## Objetivo

Este arquivo serve como handoff do projeto `CMV Loja / Pateo da Luz` para uso no Claude Code.

Ele cobre:

- estrutura do projeto;
- dependências principais;
- arquivos e pastas que devem ser exportados;
- arquivos gerados que podem ser omitidos;
- instruções de setup;
- comandos de validação;
- contexto funcional do sistema.

## Raiz do projeto

```txt
C:\Projetos\CMV Loja\CMV Loja
```

## Stack

- Frontend: React 18 + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- ORM: Prisma
- Banco: PostgreSQL 16
- Infra local: Docker Compose
- Importação de planilhas: ExcelJS

## Estrutura principal

```txt
backend/
  src/
  prisma/
  package.json
  package-lock.json
  tsconfig.json
  .env

frontend/
  src/
  public assets via src/assets/
  package.json
  package-lock.json
  tsconfig.json
  vite.config.ts
  index.html

docs/
samples/
scripts/
docker-compose.yml
README.md
CLAUDE_CODE_DEPLOY.md
CLAUDE_CODE_IMPORT.md
```

## Módulos funcionais do sistema

- Compras
- Pedidos de compra
- Contas a pagar
- Faturamento
- Cartões
- Caixa
- CMV Real
- Fechamento mensal
- Estoque atual
- Movimentações
- Contagem de estoque
- Inventário
- Relatórios
- Produtos
- Fornecedores
- Importações
- Cadastros base
- Usuários
- Auditoria

## Dependências do frontend

Arquivo-fonte:

```txt
frontend/package.json
```

Dependências:

- `react`
- `react-dom`
- `react-router-dom`
- `framer-motion`
- `lucide-react`
- `vite`
- `@vitejs/plugin-react`

Dev dependencies:

- `typescript`
- `@types/react`
- `@types/react-dom`

## Dependências do backend

Arquivo-fonte:

```txt
backend/package.json
```

Dependências:

- `express`
- `cors`
- `dotenv`
- `zod`
- `jsonwebtoken`
- `bcryptjs`
- `multer`
- `exceljs`
- `@prisma/client`

Dev dependencies:

- `prisma`
- `tsx`
- `typescript`
- `@types/node`
- `@types/express`
- `@types/cors`
- `@types/jsonwebtoken`
- `@types/multer`

## Banco e Prisma

Arquivos principais:

```txt
backend/prisma/schema.prisma
backend/prisma/migrations/
docker-compose.yml
backend/.env
```

Configuração local atual:

```env
DATABASE_URL="postgresql://cmv:cmv@localhost:5432/cmv_loja?schema=public"
PORT=3334
JWT_SECRET="cmv-loja-local-jwt-secret"
```

Docker Compose atual:

- imagem: `postgres:16-alpine`
- porta: `5432`
- banco: `cmv_loja`
- usuário: `cmv`
- senha: `cmv`

## O que exportar para o Claude Code

### Exportação recomendada

Enviar estas pastas e arquivos:

- `backend/src`
- `backend/prisma`
- `backend/package.json`
- `backend/package-lock.json`
- `backend/tsconfig.json`
- `backend/.env`
- `frontend/src`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/tsconfig.json`
- `frontend/vite.config.ts`
- `frontend/index.html`
- `docs`
- `samples`
- `scripts`
- `docker-compose.yml`
- `README.md`
- `CLAUDE_CODE_DEPLOY.md`
- `CLAUDE_CODE_IMPORT.md`

### Pode exportar também, se quiser contexto total

- `frontend/src/assets`
- `docs/postman`

## O que normalmente NÃO vale a pena exportar

Esses itens são gerados, volumosos ou temporários:

- `frontend/node_modules`
- `backend/node_modules`
- `frontend/dist`
- `backend/dist` se existir
- `backend/uploads`
- `uploads`
- `*.log`
- `*.err`
- `tmp-*`
- planilhas temporárias na raiz

## Observação sobre “dependências”

Para Claude Code, o ideal é exportar os manifests:

- `package.json`
- `package-lock.json`

Isso é melhor do que enviar `node_modules`.

Se o ambiente do Claude Code tiver Node/npm, ele reinstala tudo com:

```bash
npm install
```

## Comando PowerShell para gerar pacote limpo

Exemplo de exportação recomendada em `.zip` sem `node_modules`, `dist`, `uploads` e logs:

```powershell
$origem = "C:\Projetos\CMV Loja\CMV Loja"
$destino = "C:\Projetos\CMV Loja\cmv-loja-claude-code"

Remove-Item -Recurse -Force $destino -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $destino | Out-Null

Copy-Item "$origem\backend" "$destino\backend" -Recurse
Copy-Item "$origem\frontend" "$destino\frontend" -Recurse
Copy-Item "$origem\docs" "$destino\docs" -Recurse
Copy-Item "$origem\samples" "$destino\samples" -Recurse
Copy-Item "$origem\scripts" "$destino\scripts" -Recurse
Copy-Item "$origem\README.md" "$destino\README.md"
Copy-Item "$origem\CLAUDE_CODE_DEPLOY.md" "$destino\CLAUDE_CODE_DEPLOY.md"
Copy-Item "$origem\CLAUDE_CODE_IMPORT.md" "$destino\CLAUDE_CODE_IMPORT.md"
Copy-Item "$origem\docker-compose.yml" "$destino\docker-compose.yml"

Remove-Item "$destino\backend\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$destino\frontend\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$destino\frontend\dist" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$destino\backend\dist" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$destino\backend\uploads" -Recurse -Force -ErrorAction SilentlyContinue

Get-ChildItem $destino -Recurse -Include *.log,*.err,tmp-* | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue

Compress-Archive -Path "$destino\*" -DestinationPath "C:\Projetos\CMV Loja\cmv-loja-claude-code.zip" -Force
```

## Se quiser exportar tudo mesmo

Se a intenção for exportar literalmente quase tudo do workspace, inclusive arquivos gerados, use isso com cuidado:

```powershell
Compress-Archive -Path "C:\Projetos\CMV Loja\CMV Loja\*" -DestinationPath "C:\Projetos\CMV Loja\cmv-loja-full.zip" -Force
```

Observação:

- esse pacote tende a ficar muito grande;
- pode incluir ruído desnecessário;
- normalmente não é a melhor opção para Claude Code.

## Como importar e subir no Claude Code

Depois de abrir o projeto no Claude Code:

### 1. Subir o banco

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
npm install
npx prisma migrate deploy
npx prisma generate
npm run build
npm run dev
```

### 3. Frontend

Em outro terminal:

```bash
cd frontend
npm install
npm run build
npm run dev
```

## Rotas principais

- `/compras`
- `/compras/nova`
- `/compras/:id/editar`
- `/compras/pedidos`
- `/financeiro/contas-a-pagar`
- `/financeiro/faturamento`
- `/financeiro/cartoes`
- `/financeiro/caixa`
- `/cmv/real`
- `/cmv/fechamento-mensal`
- `/estoque/visao-geral`
- `/estoque/produtos`
- `/estoque/movimentacoes`
- `/estoque/contagens`
- `/estoque/contagens/:sessionId/lancar`
- `/estoque/inventario`
- `/estoque/relatorios`

## Arquivos importantes para contexto rápido

### Frontend

- `frontend/src/App.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/pages/Purchases.tsx`
- `frontend/src/pages/Inventory.tsx`
- `frontend/src/pages/Products.tsx`
- `frontend/src/pages/Payables.tsx`
- `frontend/src/pages/CmvReal.tsx`
- `frontend/src/pages/Cash.tsx`
- `frontend/src/styles/global.css`

### Backend

- `backend/src/server.ts`
- `backend/src/config/database.ts`
- `backend/src/modules/purchases/`
- `backend/src/modules/imports/`
- `backend/src/modules/inventory/`
- `backend/src/modules/products/`
- `backend/src/modules/security/`
- `backend/src/modules/cmv-real/`
- `backend/src/modules/cards/`
- `backend/src/modules/monthly/`
- `backend/prisma/schema.prisma`

## Documentação útil já existente

- `docs/architecture.md`
- `docs/backend-health-check.md`
- `docs/backend-validation.md`
- `docs/backend-validation-results.md`
- `docs/system-validation-report.md`
- `docs/validacao-um-mes-real.md`
- `docs/importacao-cadastros-separados.md`
- `docs/formas-pagamento-pequenos-gastos.md`
- `docs/login-senhas-lockout-v4.md`

## Observações operacionais relevantes

- O módulo de compras já usa rota própria para novo lançamento e edição.
- Existe validação de duplicidade por fornecedor + NF/pedido no frontend, backend, importação e banco.
- O banco possui índices únicos parciais para compras ativas por:
  - `supplierId + normalizedInvoiceNumber`
  - `supplierId + normalizedPurchaseOrderNumber`
- Há scripts SQL e documentação de auditoria/importação no diretório `scripts/` e `docs/`.

## Pendência técnica conhecida

Em ambiente Windows local, `npx prisma generate` pode falhar com lock em:

```txt
backend/node_modules/.prisma/client/query_engine-windows.dll.node
```

Se isso acontecer:

- encerrar processos Node/Prisma locais;
- parar backend em execução;
- rodar novamente `npx prisma generate`;
- se persistir, reiniciar terminal/IDE/host.

## Prompt curto sugerido para Claude Code

```txt
Este é um sistema local de compras, estoque, inventário, financeiro e CMV.
Use primeiro os arquivos README.md, CLAUDE_CODE_IMPORT.md, docs/architecture.md, frontend/src/App.tsx, frontend/src/pages/Purchases.tsx, backend/src/server.ts e backend/prisma/schema.prisma para criar contexto.
Depois valide setup, rotas, Prisma e módulos de compras/estoque antes de editar.
```
