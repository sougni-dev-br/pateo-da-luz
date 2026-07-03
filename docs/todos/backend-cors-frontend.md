# TODO — CORS backend vs frontend

Documenta o status do CORS do backend em relação ao PR do Design System.
**Não bloqueia o merge.** Fica como ticket futuro, acionável apenas se o domínio
do frontend mudar ou se o dev local precisar rodar em outra porta.

## Estado atual

Backend do Pateo da Luz (`backend/src/index.ts` ou config de origins no Render)
permite CORS apenas para:

- `https://pateo.sougni.com` (produção)
- `http://localhost:5173`
- `http://localhost:5174`
- `http://localhost:3000`

## Sintomas observados durante o PR do DS

- Em `?mock-user=1` (dev): funciona porque o `installMockFetch()` intercepta
  todas as chamadas de API antes de sair — CORS nunca é acionado. Este é o modo
  usado para toda a revisão visual do PR.
- Em modo real (dev com backend rodando local): funciona pelo proxy do Vite
  (`vite.config.ts` proxa `/api` → `http://127.0.0.1:3334`) ou por CORS explícito
  em `localhost:5174`.
- Em produção (frontend em `pateo.sougni.com` → backend em `pateo-backend.onrender.com`):
  funciona porque `pateo.sougni.com` está na whitelist.

## Cenários que quebrariam

- Frontend mover para outro domínio (ex.: `app.pateo.com`) sem atualizar a
  whitelist do backend. Sintoma: browser bloqueia `fetch` com "CORS preflight
  did not succeed"; app fica "carregando..." indefinidamente ou lança `TypeError:
  Failed to fetch`.
- Dev local rodar Vite em porta diferente (5175, 5176) por conflito de porta —
  hoje já tolerado no vite.config via `autoPort`, mas se a requisição sair
  diretamente pro backend em vez de passar pelo proxy, CORS bloqueia.

## Recomendação

- Ticket separado quando/se decidirem mudar o domínio do frontend ou adicionar
  ambientes (staging em outro subdomínio, PR previews).
- Alteração é simples: adicionar a nova origem ao array `allowedOrigins` no
  backend + deploy backend antes do frontend.
- Não incluído neste PR — decisão de infra.

## Referências
- `backend/src/index.ts` (ou onde o CORS é configurado — verificar)
- `frontend/vite.config.ts` (proxy `/api` → `127.0.0.1:3334`)
- `frontend/src/lib/mockUser.ts` (intercept que faz o CORS ficar irrelevante em dev)
