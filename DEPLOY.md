# Pateo da Luz - Deploy Architecture

## Topologia

```
pateo.sougni.com  (SiteGround Apache, static)  ──HTTPS──►  pateo-backend.onrender.com  (Render Node)
                                                                       │
                                                                       ▼
                                                        Render PostgreSQL 16 (managed)
```

## Frontend (SiteGround)

- Pasta no servidor: `public_html/pateo/` (subdomain pateo.sougni.com)
- Build: `cd frontend && npm run build`
- Vite produz `frontend/dist/`
- Conteúdo de `dist/` vai para a pasta do subdomain
- `.htaccess` (em `frontend/public/.htaccess`) reescreve rotas para SPA

## Backend (Render)

- Definição em `render.yaml` (blueprint)
- Serviço web em Node 22 + Postgres free
- Migrations aplicadas em cada deploy via `prisma migrate deploy`
- Health check: `/health`
- Variáveis críticas:
  - `DATABASE_URL` (gerado pelo Render)
  - `JWT_SECRET` (gerado pelo Render)
  - `CORS_ORIGIN=https://pateo.sougni.com`
  - `NODE_ENV=production`

## Credenciais iniciais

Email: `admin@pateodaluz.local`
Senha: `admin123`

**TROCAR IMEDIATAMENTE após primeiro login em produção.**

## Limitações do plano free Render

- Web service dorme após 15 min de inatividade. Primeira requisição após dormir leva 30-60s.
- Postgres free expira em 90 dias (precisa fazer upgrade ou criar novo banco).
- 750 horas/mês de uptime.

Para uso real considere o plano Starter ($7/mês) que mantém o serviço sempre ligado.
