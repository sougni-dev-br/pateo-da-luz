// Batch capture das ondas 5B/5C/5D/5E via playwright.
//
// Uso:
//   node scripts/capture-fase5-batches.mjs         # captura tudo (23 PNGs)
//   node scripts/capture-fase5-batches.mjs B       # captura só onda B (6 PNGs)
//   node scripts/capture-fase5-batches.mjs C D     # captura ondas C+D
//   PREVIEW_URL=http://localhost:5175 node scripts/... # troca porta
//
// Saída: frontend/screenshots/{5B,5C,5D,5E}-{slug}.png em 1440x900 fullPage.
// Detecta ContentErrorBoundary por texto do <Alert tone="error"> e loga ⚠.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "screenshots");
const BASE = process.env.PREVIEW_URL ?? "http://localhost:5174";

// Rotas conferidas contra src/App.tsx antes de escrever o script.
// Ajustes vs. spec inicial: /cmv/real (nao /cmv/cmv-real) e /estoque/planejamento-compra
// (rota propria para <PurchasePlanning />, nao view interna de Inventory).
const WAVES = {
  B: [
    { slug: "5B-contas-a-pagar",       path: "/financeiro/contas-a-pagar" },
    { slug: "5B-faturamento",          path: "/financeiro/faturamento" },
    { slug: "5B-estoque-visao-geral",  path: "/estoque/visao-geral" },
    { slug: "5B-produtos",             path: "/estoque/produtos" },
    { slug: "5B-contagem-de-estoque",  path: "/estoque/contagens" },
    { slug: "5B-requisicoes",          path: "/estoque/requisicoes" }
  ],
  C: [
    { slug: "5C-dre",                    path: "/financeiro/dre" },
    { slug: "5C-caixa",                  path: "/financeiro/caixa" },
    { slug: "5C-movimentacoes",          path: "/estoque/movimentacoes" },
    { slug: "5C-inventario",             path: "/estoque/inventario" },
    { slug: "5C-planejamento-de-compra", path: "/estoque/planejamento-compra" },
    { slug: "5C-relatorios-de-estoque",  path: "/estoque/relatorios" }
  ],
  D: [
    { slug: "5D-pagamentos",       path: "/configuracoes/pagamentos" },
    { slug: "5D-cadastros-base",   path: "/configuracoes/cadastros-base" },
    { slug: "5D-usuarios",         path: "/configuracoes/usuarios" },
    { slug: "5D-fichas-tecnicas",  path: "/cardapio/fichas-tecnicas" },
    { slug: "5D-importacoes",      path: "/dados/importacoes" }
  ],
  E: [
    { slug: "5E-dashboard",         path: "/" },
    { slug: "5E-cartoes",           path: "/financeiro/cartoes" },
    { slug: "5E-auditoria",         path: "/configuracoes/auditoria" },
    { slug: "5E-fechamento-mensal", path: "/cmv/fechamento-mensal" },
    { slug: "5E-cmv-real",          path: "/cmv/real" },
    { slug: "5E-impostos",          path: "/financeiro/impostos" }
  ]
};

const wavesArg = process.argv.slice(2).map((s) => s.toUpperCase());
const wavesToRun = wavesArg.length > 0
  ? wavesArg.filter((w) => w in WAVES)
  : Object.keys(WAVES);

if (wavesArg.length > 0 && wavesToRun.length === 0) {
  console.error(`Ondas invalidas: ${wavesArg.join(", ")}. Valores aceitos: B C D E`);
  process.exit(1);
}

const shots = wavesToRun.flatMap((w) => WAVES[w]);
console.log(`→ Rodando ondas: ${wavesToRun.join(" ")} — ${shots.length} rotas`);
console.log(`  Base URL: ${BASE}`);
console.log(`  Output:   ${OUT_DIR}`);
console.log("");

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
const page = await context.newPage();

let saved = 0;
let boundaryHits = 0;
let failed = 0;

for (const shot of shots) {
  const url = `${BASE}${shot.path}${shot.path.includes("?") ? "&" : "?"}mock-user=1`;
  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForSelector(".content, .ds-login-shell", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(500);

    // Detecta ContentErrorBoundary: <Alert tone="error"> com texto "Esta pagina nao pode ser renderizada."
    const hitBoundary = await page.evaluate(() => {
      const alerts = document.querySelectorAll(".ds-alert-error");
      for (const el of alerts) {
        if (el.textContent && el.textContent.includes("não pôde ser renderizada")) return true;
      }
      return false;
    });

    const out = join(OUT_DIR, `${shot.slug}.png`);
    await page.screenshot({ path: out, fullPage: true });
    saved += 1;
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    if (hitBoundary) {
      boundaryHits += 1;
      console.log(`⚠ ${shot.slug} (${secs}s) — ContentErrorBoundary detected`);
    } else {
      console.log(`✓ ${shot.slug} (${secs}s)`);
    }
  } catch (err) {
    failed += 1;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`✗ ${shot.slug} (${secs}s) — ${err?.message ?? err}`);
  }
}

await browser.close();

console.log("");
console.log(`${saved} screenshots salvos em ${OUT_DIR}`);
if (boundaryHits > 0) console.log(`${boundaryHits} pagina(s) caiu(caíram) no ContentErrorBoundary`);
if (failed > 0) console.log(`${failed} rota(s) falhou(aram) antes do screenshot`);
