// Captura shell (Sidebar + AppShell + mock) para auditoria por fase.
// Uso: node scripts/capture-shell.mjs <fase-tag>
// Ex.: node scripts/capture-shell.mjs 4B-sidebar-shell
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "screenshots");
const BASE = process.env.PREVIEW_URL ?? "http://localhost:5174";

const tag = process.argv[2] ?? "shell";
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
const page = await context.newPage();

const url = `${BASE}/?mock-user=1`;
process.stdout.write(`→ ${tag}.png  (${url})  ... `);
await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForSelector(".ds-sidebar, aside.sidebar", { timeout: 10_000 }).catch(() => undefined);
await page.waitForTimeout(700);
await page.screenshot({ path: join(OUT_DIR, `${tag}.png`), fullPage: false });
console.log("ok");

await browser.close();
