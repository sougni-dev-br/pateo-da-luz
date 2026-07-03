// Screenshot full-page de uma rota do dev server (validacao visual Fase 5).
// Uso: node scripts/screenshot.mjs <url> <arquivo-saida> [seletor-espera]
import { chromium } from "playwright";

const [url, out, waitSel = "body"] = process.argv.slice(2);
if (!url || !out) {
  console.error("Uso: node scripts/screenshot.mjs <url> <saida.png> [seletor]");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(waitSel, { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("saved:", out);
