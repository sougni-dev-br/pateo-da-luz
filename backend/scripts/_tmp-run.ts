import { readFileSync } from "node:fs";
const txt = readFileSync("C:/Users/elioe/.claude/projects/C--Projeto-pateo-Claude/secrets/pateo-backend.env", "utf8");
let url = txt.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))!.slice(13).replace(/^["']|["']$/g, "");
url = url.replace(/@(dpg-[a-z0-9-]+-a)(:\d+)?\//, (_x, h, p) => `@${h}.oregon-postgres.render.com${p ?? ""}/`);
if (!/sslmode=/.test(url)) url += (url.includes("?") ? "&" : "?") + "sslmode=require";
process.env.DATABASE_URL = url;
await import("./auditar-combinado.js");
