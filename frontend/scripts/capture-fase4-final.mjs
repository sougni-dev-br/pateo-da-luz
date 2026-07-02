// Batch capture das 4 telas-chave para gate humano final da Fase 4.
// Salva em frontend/screenshots/4E-*.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "screenshots");
const BASE = process.env.PREVIEW_URL ?? "http://localhost:5174";

await mkdir(OUT_DIR, { recursive: true });

const SHOTS = [
  { tag: "4E-final-dashboard", path: "/?mock-user=1", wait: ".ds-topbar" },
  { tag: "4E-final-produtos", path: "/estoque/produtos?mock-user=1", wait: ".ds-topbar" },
  { tag: "4E-final-fornecedores", path: "/cadastros/fornecedores?mock-user=1", wait: ".ds-topbar" },
  { tag: "4E-final-login", path: "/", wait: ".ds-login-shell", blockAuth: true }
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
const page = await context.newPage();

// Bloqueio de auth so aplica em SHOT com blockAuth. Usamos rota condicional
// dinamica via cabecalho — solucao simples: cria nova pagina por SHOT quando
// precisa bloquear.
for (const shot of SHOTS) {
  const p = shot.blockAuth ? await context.newPage() : page;
  if (shot.blockAuth) {
    await p.route("**/auth/me", (route) => route.abort("failed"));
    await p.route("**/health", (route) => route.abort("failed"));
  }
  const url = `${BASE}${shot.path}`;
  process.stdout.write(`→ ${shot.tag}.png  (${url})  ... `);
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await p.waitForSelector(shot.wait, { timeout: 10_000 }).catch(() => undefined);
  await p.waitForTimeout(700);
  await p.screenshot({ path: join(OUT_DIR, `${shot.tag}.png`), fullPage: false });
  if (shot.blockAuth) await p.close();
  console.log("ok");
}

await browser.close();
