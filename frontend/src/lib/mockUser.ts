// Mock user dev-only para revisar o shell sem backend ativo.
//
// Ativacao:
//   1) NODE_ENV=development / vite dev (isLocal=true), E
//   2) URL contem ?mock-user=1
//
// Ambos devem ser verdadeiros. Em prod (isLocal=false) o modulo e um no-op
// completo — os checks retornam false e installMockFetch nao faz nada.
//
// O que faz:
// - App.tsx pula getMe() / getMenuFavorites() / getStockCountSessions()
// - Injeta MOCK_USER (ADMIN, mustChangePassword=false) na sessao
// - installMockFetch() intercepta fetch da API e devolve respostas vazias
//   (listas [] e objetos {}) para nao gerar toast/erro visivel

import type { AppUser } from "../api/client";
import { API_BASE_URL } from "../api/client";
import { isLocal } from "../utils/env";

export const MOCK_USER: AppUser = {
  id: "mock-user",
  name: "Mock Admin",
  email: "mock@pateodaluz.local",
  role: "ADMIN",
  isActive: true,
  mustChangePassword: false
};

export function isMockUserMode(): boolean {
  if (!isLocal) return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("mock-user");
}

// URLs consideradas "de API" para intercept. Cobre:
// - http://localhost:3334/* (backend dev direto, sem proxy)
// - /api/* (proxy vite)
// - /auth/* (algumas rotas legadas)
// - API_BASE_URL configurado
function isApiUrl(url: string): boolean {
  if (url.includes(":3334")) return true;
  if (url.startsWith("/api/") || url === "/api") return true;
  if (url.startsWith("/auth/")) return true;
  if (API_BASE_URL && API_BASE_URL !== "/api" && url.startsWith(API_BASE_URL)) return true;
  return false;
}

function pathFrom(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname;
  } catch {
    return url;
  }
}

function mockResponseFor(url: string): unknown {
  const path = pathFrom(url);

  if (path.endsWith("/auth/me") || path.endsWith("/me")) return MOCK_USER;
  if (path.endsWith("/health")) return { status: "ok" };
  if (path.includes("/auth/logout")) return { ok: true };
  // Dashboard alerts endpoint returns shape `{ alerts: [...] }`, nao lista crua.
  if (path.endsWith("/dashboard/alerts")) return { alerts: [] };
  // Dashboard raiz e summary sao objetos — evita cair no fallback `{}` que
  // ja funciona, mas explicito ajuda a documentar.
  if (path.endsWith("/dashboard") || path.endsWith("/dashboard/summary")) return {};

  // Endpoints que sabidamente devolvem lista. Larga rede — qualquer
  // ambiguidade cai para [] em vez de {}, o que evita crashes de
  // `resposta.filter(...)` em callsites nao-defensivos.
  const listPatterns = [
    "favorites",
    "alerts",
    "sessions",
    "purchases",
    "suppliers",
    "products",
    "categories",
    "subcategories",
    "sectors",
    "units",
    "companies",
    "payables",
    "orders",
    "requisitions",
    "dishes",
    "cards",
    "cash-entries",
    "movements",
    "users",
    "audit",
    "payment-methods",
    "tax-payments",
    "dre",
    "menu-favorites",
    "stock",
    "cycles"
  ];
  if (listPatterns.some((p) => path.includes(p))) return [];

  // Fallback: objeto vazio. Paginas devem lidar com campos undefined
  // (a maioria ja faz por ter erro de rede em prod).
  return {};
}

let installed = false;

export function installMockFetch(): void {
  if (installed) return;
  if (!isMockUserMode()) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!isApiUrl(url)) return originalFetch(input, init);
    const body = mockResponseFor(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  installed = true;
  // eslint-disable-next-line no-console
  console.info("[mock-user] fetch interceptor ativo — respostas de API mockadas");
}
