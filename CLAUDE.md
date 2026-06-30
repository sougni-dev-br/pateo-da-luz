# CLAUDE.md — Pateo da Luz ERP

Sistema ERP próprio do restaurante Pateo da Luz. Stack: Node.js/Express (backend) + React (frontend) + PostgreSQL (banco). Infraestrutura split: backend no Render, frontend no SiteGround.

## Arquitetura

```
pateo-da-luz/
├── backend/        Node.js + Express + TypeScript + Prisma + PostgreSQL
├── frontend/       React + Vite
├── scripts/        Deploy e utilitários
└── render.yaml     Config do Render (backend)
```

**URLs de produção:**
- Frontend: https://pateo.sougni.com
- Backend API: https://pateo-backend.onrender.com

## Stack e Linguagens

- **Backend:** Node.js 22.13.1, Express 4, TypeScript 5.6, Prisma ORM v5.22, bcryptjs, zod, JWT, AWS S3/R2 (anexos)
- **Frontend:** React 18.3, Vite 8, TypeScript 5.6, Radix UI, framer-motion, lucide-react, react-router-dom v7 (sem Axios — usa fetch nativo)
- **Banco:** PostgreSQL 16 (Render Managed — plano free, expira 90 dias; upgrade pendente)
- **Dev backend:** `tsx watch` (porta 3334)
- **Deploy backend:** git push → Render auto-deploy via render.yaml (migrations aplicadas automaticamente no boot)
- **Deploy frontend:** `tsc && vite build` → SCP + SSH para SiteGround (ver DEPLOY.md)

## Regras críticas

- ⚠️ **NENHUM deploy em produção sem autorização explícita do Rafael**
- ⚠️ Validar localmente antes de propor qualquer deploy (ver DEPLOY.md)
- Variáveis de ambiente nunca commitar — usar .env local ou painel Render
- Migrations: `npm run prisma:migrate` (dev local) — NUNCA rodar em produção sem autorização. Em produção é o Render que executa `prisma migrate deploy` automaticamente no boot
- Sem framework de testes configurado atualmente — nenhum `npm test` funciona
- CORS do backend permite apenas: https://pateo.sougni.com e localhost:5173/5174/3000

## Skills ECC ativas para este projeto

| Situação | Skill a usar |
|----------|-------------|
| SQL, migrations, índices | `postgres-patterns` |
| Componentes React, hooks, estado | `react-patterns` |
| Performance React | `react-performance` |
| Testes React | `react-testing` |
| Deploy, CI/CD, produção | `deployment-patterns` |
| Review de segurança | `security-review` |
| Scan de vulnerabilidades | `security-scan` |
| Migrations de banco | `database-migrations` |
| Testes E2E | `e2e-testing` |

## Agents ECC disponíveis

- `database-reviewer` — revisar queries, schema, performance de banco
- `code-reviewer` — review geral de código
- `security-reviewer` — análise de segurança
- `architect` — decisões de arquitetura
- `build-error-resolver` — erros de build/deploy

## Comandos úteis

```bash
# Backend
cd backend && npm install
npm run dev              # desenvolvimento (tsx watch, porta 3334)
npm run build            # prisma generate + tsc
npm run prisma:migrate   # criar nova migration (dev local)
npm run prisma:deploy    # aplicar migrations pendentes (NÃO usar em prod manualmente)
npm run prisma:studio    # GUI do banco (Prisma Studio)

# Frontend
cd frontend && npm install
npm run dev          # desenvolvimento (Vite, porta 5173)
npm run build        # tsc + vite build → dist/

# Deploy backend (após autorização explícita)
git push             # Render auto-deploys via render.yaml

# Deploy frontend (após autorização explícita)
# Ver DEPLOY.md
```

## Padrões de código

- Português para nomes de domínio (produtos, pedidos, fornecedores, etc.)
- camelCase para variáveis/funções JS
- Commits em português descritivos
- Sem comentários óbvios — só comentar WHY quando não é evidente

## Ferramentas do ecossistema disponíveis

### Pake — app desktop do ERP
`C:\Projeto_pateo_Claude\Pake`

Transforma o frontend React em app desktop instalável no Windows (~5MB). Um comando empacota a URL de produção:
```bash
cd C:\Projeto_pateo_Claude\Pake
pnpm run cli:dev -- https://pateodealuz.com.br --name "Pateo da Luz" --width 1400 --height 900
```
Para gerar o instalador `.msi` final: `pnpm run build`

### OpenWA — WhatsApp para o ERP
`C:\Projeto_pateo_Claude\OpenWA`

API Gateway WhatsApp open-source (NestJS + Docker). Com OpenWA rodando, o backend do Pateo pode enviar mensagens WhatsApp ao Rafael:
- Alertas de estoque baixo
- Resumo diário de vendas/DRE
- Vencimentos de contas a pagar
- Confirmação de pedidos de compra

```typescript
// Integração simples no backend
await fetch('http://localhost:3000/api/messages/send', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer <API_KEY>' },
  body: JSON.stringify({ session: 'pateo', to: '55XX@s.whatsapp.net', text: '...' })
})
```

### Ponytail — sessões mais baratas
`C:\Projeto_pateo_Claude\ponytail`

Plugin "lazy senior dev" — reduz código em ~54%, sessões ~20% mais baratas. Complementa o ECC.
Skills: `/ponytail`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-review`

### Voicebox — voz no ERP
`C:\Projeto_pateo_Claude\voicebox`

MCP Server em `http://127.0.0.1:17493/mcp`. Com Voicebox rodando, o Claude consegue:
- Ler relatórios (DRE, fechamento) em voz alta via `voicebox.speak`
- Transcrever comandos de voz via `voicebox.transcribe`

### UI UX Pro Max — design intelligence
`C:\Projeto_pateo_Claude\ui-ux-pro-max-skill`

161 regras de design + 67 estilos de UI para o Claude. Skills: `ui-ux-pro-max`, `ui-styling`, `design-system`, `slides`. Usar ao criar/revisar qualquer componente React do ERP.

### Twenty — CRM open-source de referência
`C:\Projeto_pateo_Claude\twenty`

CRM #1 open-source (NestJS + React + GraphQL + PostgreSQL). Referência de arquitetura para módulos de clientes, pipeline e relacionamentos do Pateo.

### Agency Agents — agentes especializados
`C:\Projeto_pateo_Claude\agency-agents`

Coleção de agentes com domínio específico: engineering, finance, product, testing, security. Usar para delegar tarefas especializadas ao Claude.

### PM Skills — product management
`C:\Projeto_pateo_Claude\pm-skills`

68 skills de PM: `/discover`, `/write-prd`, `/prioritize`, `/north-star`. Usar para planejar novas features do ERP antes de implementar.

### TTS (Coqui) — voz local
`C:\Projeto_pateo_Claude\TTS`

Engine TTS Python 100% local (16 idiomas). Alternativa offline ao Voicebox para relatórios em áudio.

### Penpot — design de telas
`C:\Projeto_pateo_Claude\penpot`

MCP Server para criar/editar telas do ERP diretamente no editor Penpot via Claude.

### improve — auditoria e planos de implementação
`C:\Projeto_pateo_Claude\improve`

Skill que audita o codebase completo e gera planos priorizados para outros agentes executarem. Instalar via `npx skills add shadcn/improve`.
```
/improve deep           → auditoria exaustiva do ERP → planos em plans/
/improve security       → plano de hardening da API
/improve perf           → otimização de queries pesadas (DRE, CMV)
/improve plan <desc>    → especificar uma feature antes de implementar
```

### SkillSpector — scanner de segurança de skills
`C:\Projeto_pateo_Claude\SkillSpector`

Varre skills de agentes em busca de vulnerabilidades (26.1% das skills públicas têm falhas). Usar antes de ativar qualquer novo repo de skills:
```bash
pip install skillspector
skillspector scan "C:\Users\elioe\.claude\skills\ecc"
```

### Taste Skill — frontend anti-slop
`C:\Projeto_pateo_Claude\taste-skill`

Complementa o UI UX Pro Max com "gosto" de design — evita componentes genéricos e produz UI com qualidade profissional. Usar junto ao UI UX Pro Max ao redesenhar telas do ERP.

### Hermes Agent — agente com memória auto-aperfeiçoável
`C:\Projeto_pateo_Claude\hermes-agent`

Agente da Nous Research com loop de aprendizado embutido — cria skills a partir da experiência, persiste memória entre sessões. Padrão de referência para construir agente de compras que aprende preferências do Rafael. Complementa Graphify.

### Understand-Anything — knowledge graph do codebase
`C:\Projeto_pateo_Claude\Understand-Anything`

Transforma qualquer codebase em knowledge graph interativo. Útil para mapear dependências do ERP, encontrar todos os usos de uma função/tabela, ou onboarding rápido em módulos desconhecidos.

### compozy — orquestração de agentes
`C:\Projeto_pateo_Claude\compozy`

Pipeline completo de orquestração de agentes: da ideia ao código em produção. Go + TypeScript. Skills e agentes prontos em `.agents/` e `skills/`.

### CL4R1T4S — system prompts de referência
`C:\Projeto_pateo_Claude\CL4R1T4S`

25 system prompts extraídos de Anthropic, OpenAI, Cursor, Windsurf, Devin, Manus, etc. Referência para escrever melhores CLAUDE.md e agentes customizados para o ERP.

### turbovec — busca vetorial privada ultra-eficiente
`C:\Projeto_pateo_Claude\turbovec`

Motor vetorial Rust+Python baseado no TurboQuant do Google. 10M documentos em 4 GB (vs 31 GB com float32), mais rápido que FAISS, 100% local. Base para RAG privado do ERP:
- Busca semântica de produtos/fornecedores ("similar a este item")
- Base de conhecimento do agente de compras (histórico de preços, padrões)
- Substitui Pinecone/Weaviate com zero custo e dados locais
```python
pip install turbovec
index = turbovec.Index(dims=1536)
index.add(ids, vectors)
results = index.search(query_vec, k=10)
```

### OpenStock — referência de UI de estoque
`C:\Projeto_pateo_Claude\OpenStock`

Dashboard de estoque open-source (Next.js + TypeScript + Tailwind, AGPL-3.0). Referência direta para o módulo de estoque do Pateo: UI de produtos, movimentações e alertas de nível mínimo.

### phantom-ui — skeleton loaders automáticos
`C:\Projeto_pateo_Claude\phantom-ui`

Web Component (~8kb) que gera skeleton loaders medindo o DOM real. Plug-and-play no React:
```jsx
npm install @aejkatappaja/phantom-ui
<phantom-ui><MinhaTabela /></phantom-ui>
```
Melhora UX do ERP durante carregamento do DRE e relatórios pesados.

### langflow — builder visual de pipelines AI
`C:\Projeto_pateo_Claude\langflow`

Builder visual drag-and-drop para pipelines AI. Exporta como API REST ou MCP server. Usar para prototipar visualmente os agentes do ERP (compras + RAG + WhatsApp) antes de integrar ao backend.

### freellmapi — 1.7B tokens/mês grátis
`C:\Projeto_pateo_Claude\freellmapi`

Gateway OpenAI-compatível para 16 provedores free (Groq, Cerebras, Google, Mistral, etc.). Para agentes de baixo custo no ERP (alertas, resumos simples):
```bash
OPENAI_BASE_URL=https://freellmapi.co/v1
OPENAI_API_KEY=<key>
```

### memex — captura de fragmentos → dados estruturados
`C:\Projeto_pateo_Claude\memex`

Journal AI local-first com multi-agent para organizar fragmentos (voz, texto, fotos) em cards estruturados. Padrão de captura: Rafael dita uma compra → agente registra no ERP.

## Contexto de negócio

- Restaurante físico em operação
- Módulos: compras, estoque, fornecedores, financeiro, DRE, CMV real, pedidos de compra, fiscal (guias), cartões, receitas
- Rafael é o dono e único usuário do sistema
- Dados reais de produção — cuidado com seeds e resets
