# Comandos — Ambiente Local (Pateo da Luz)

> Guia de referência para rodar **backend** e **frontend** na máquina local.
> Atualizado em 2026-06-24. Validado: ambos os builds passam (exit 0).

## ⚠️ REGRA OBRIGATÓRIA DE DEPLOY

**Qualquer deploy em produção — backend (Render), frontend (SiteGround) ou qualquer
outro ambiente — só pode ser executado após autorização explícita do Eli/Pateo na
conversa atual.** Diagnóstico, build e execução local NÃO são deploy e podem ser
feitos livremente. Ver [DEPLOY.md](../DEPLOY.md).

---

## Caminhos absolutos

| Parte | Caminho |
|---|---|
| Raiz do projeto | `C:\Projetos\CMV Loja\cmv-loja-claude-code` |
| Backend | `C:\Projetos\CMV Loja\cmv-loja-claude-code\backend` |
| Frontend | `C:\Projetos\CMV Loja\cmv-loja-claude-code\frontend` |

## Portas

| Serviço | Porta | Origem |
|---|---|---|
| Backend (Express) | **3334** | `backend/src/config/env.ts` (`PORT ?? 3334`) |
| Frontend (Vite dev) | **5174** | `frontend/vite.config.ts` (`PORT ?? 5174`) |

> Em desenvolvimento o frontend chama `/api`, e o Vite faz **proxy** de `/api` →
> `http://127.0.0.1:3334` (backend local). Ou seja, o front aponta para o backend
> local automaticamente — basta subir os dois.

---

## Subir o BACKEND local

```powershell
cd "C:\Projetos\CMV Loja\cmv-loja-claude-code\backend"
npm install            # só na primeira vez ou após mudar dependências
npx prisma generate    # regenera o Prisma Client
npm run dev            # sobe em http://localhost:3334 (tsx watch, hot reload)
```

Build de produção / checagem de TypeScript:

```powershell
npm run build          # = prisma generate && tsc  (gera dist/)
npm start              # roda o build: node dist/server.js
```

## Subir o FRONTEND local

```powershell
cd "C:\Projetos\CMV Loja\cmv-loja-claude-code\frontend"
npm install            # só na primeira vez ou após mudar dependências
npm run dev            # sobe em http://localhost:5174 (Vite, hot reload)
```

Build de produção:

```powershell
npm run build          # = tsc && vite build  (gera dist/)
npm run preview        # serve o build localmente para conferência
```

> **Ordem recomendada:** suba o **backend primeiro** (porta 3334), depois o
> **frontend** (5174). Assim o proxy `/api` encontra o backend no ar.

---

## Parar processos antigos (Windows / PowerShell)

```powershell
# Ver o que está ocupando as portas
netstat -ano | Select-String ":3334"
netstat -ano | Select-String ":5174"

# Matar o processo pelo PID mostrado acima
Stop-Process -Id <PID> -Force

# Matar todos os node (use com cuidado — derruba qualquer node em execução)
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## Verificar branch / commit

```powershell
cd "C:\Projetos\CMV Loja\cmv-loja-claude-code"
git status
git branch -vv
git log --oneline -10
git fetch --all --prune        # atualiza referências do remoto (NÃO altera arquivos)
```

- **Branch de produção:** `main` (Render faz auto-deploy do `origin/main`).
- Conferir se está sincronizado: `git status -sb` deve mostrar
  `## main...origin/main` sem `[ahead/behind]`.

---

## Variáveis de ambiente

> **Nunca commitar segredos.** Os arquivos `.env` reais ficam fora do git.

### Backend — `backend/.env`
| Variável | Para quê | Local |
|---|---|---|
| `DATABASE_URL` | conexão Postgres | aponta para **banco local** |
| `PORT` | porta do Express | `3334` |
| `JWT_SECRET` | assinatura de token | qualquer string secreta |
| `R2_ACCOUNT_ID` | Cloudflare R2 (storage) | opcional em dev |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 | opcional em dev |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 | opcional em dev |
| `R2_BUCKET_NAME` | Cloudflare R2 | opcional em dev |

Exemplo de referência: `backend/.env.example`.

### Frontend — `frontend/.env.local` (dev)
| Variável | Valor em dev | Efeito |
|---|---|---|
| `VITE_API_URL` | `/api` | usa o proxy do Vite → backend local 3334 |
| `VITE_BACKEND_URL` | `http://127.0.0.1:3334` | informativo (tela de login mostra o alvo) |

> Para apontar o front **dev** ao backend de produção (apenas para testes pontuais),
> trocar `VITE_API_URL` para `https://pateo-backend.onrender.com` e **reiniciar o
> Vite** (env é lido no boot). Reverter para `/api` ao terminar.

Build de produção do frontend usa `frontend/.env.production`.
