// Captura screenshots do dev server via playwright para validacao visual.
// Uso: npm run dev (em outra shell), depois `node scripts/capture-screenshots.mjs`.
// Saidas: frontend/screenshots/*.png (gitignored).

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "screenshots");
const BASE = process.env.PREVIEW_URL ?? "http://localhost:5174";

const CAPTURES = [
  { name: "04a-fix-viewport.png", path: "/?mock-user=1", waitFor: ".mock-user-badge" },
  { name: "04b-fix-badge.png", path: "/?mock-user=1", waitFor: ".mock-user-badge" },
  { name: "04c-fix-subcategories.png", path: "/estoque/produtos?mock-user=1", waitFor: ".content" },
  { name: "05-shell-completo-fix.png", path: "/estoque/produtos?mock-user=1", waitFor: ".content" }
];

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
const page = await context.newPage();

for (const shot of CAPTURES) {
  const url = `${BASE}${shot.path}`;
  process.stdout.write(`→ ${shot.name}  (${url})  ... `);
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForSelector(shot.waitFor, { timeout: 10_000 }).catch(() => undefined);
    // Aguarda pulso da badge / animacoes assentarem.
    await page.waitForTimeout(600);
    const out = join(OUT_DIR, shot.name);
    await page.screenshot({ path: out, fullPage: false });
    console.log("ok");
  } catch (err) {
    console.log(`FAILED: ${err?.message ?? err}`);
  }
}

await browser.close();
console.log(`\nCaptured to ${OUT_DIR}`);
