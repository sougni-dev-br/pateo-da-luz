import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Log rotativo por dia. Todos os eventos vão para logs/sync-YYYY-MM-DD.log
// e também para stdout — quando o agente roda pelo Agendador de Tarefas,
// o stdout é capturado pelo próprio Windows Task History.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOG_DIR = process.env.PATEO_AGENT_LOG_DIR
  ?? "C:\\PateoAgent\\logs";
const FALLBACK_LOG_DIR = path.resolve(__dirname, "..", "logs");

let resolvedDir = null;

async function ensureDir() {
  if (resolvedDir) return resolvedDir;
  for (const candidate of [LOG_DIR, FALLBACK_LOG_DIR]) {
    try {
      await mkdir(candidate, { recursive: true });
      resolvedDir = candidate;
      return candidate;
    } catch {
      // tenta o próximo
    }
  }
  throw new Error("Não consegui criar diretório de logs.");
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timestamp() {
  return new Date().toISOString();
}

async function write(level, message, extra) {
  const dir = await ensureDir();
  const file = path.join(dir, `sync-${today()}.log`);
  const extraText = extra ? " " + JSON.stringify(extra) : "";
  const line = `[${timestamp()}] ${level} ${message}${extraText}\n`;
  await appendFile(file, line, "utf-8");
  process.stdout.write(line);
}

export const logger = {
  info: (message, extra) => write("INFO", message, extra),
  warn: (message, extra) => write("WARN", message, extra),
  error: (message, extra) => write("ERROR", message, extra)
};
