// Captura /login (sem mock-user, backend indisponivel → cai no <Login/>).
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "screenshots");
const BASE = process.env.PREVIEW_URL ?? "http://localhost:5174";

const tag = process.argv[2] ?? "login";
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
const page = await context.newPage();

// Bloqueia auth/me para forcar fallback pro Login.
await page.route("**/auth/me", (route) => route.abort("failed"));
await page.route("**/health", (route) => route.abort("failed"));

const url = `${BASE}/`;
process.stdout.write(`→ ${tag}.png  (${url}, auth/me bloqueado)  ... `);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector(".ds-login-shell", { timeout: 10_000 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT_DIR, `${tag}.png`), fullPage: false });
console.log("ok");

await browser.close();
