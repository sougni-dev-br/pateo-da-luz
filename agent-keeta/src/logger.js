import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redigirSegredos } from "./logica.js";

// Log por dia em logs/keeta-YYYY-MM-DD.log e também no stdout (o Agendador de Tarefas captura).
// NUNCA registre senha, token ou cookie: só o que ajuda a entender o que o agente fez.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASTAS = [process.env.PATEO_KEETA_LOG_DIR ?? "C:\\PateoAgentKeeta\\logs", path.resolve(__dirname, "..", "logs")];

let pastaEscolhida = null;
let segredos = [];

/** Valores que nunca podem aparecer no log (senha, e-mail, token). */
export function definirSegredos(lista) {
  segredos = lista.filter((v) => typeof v === "string" && v.length > 0);
}

export function redigir(texto) {
  return redigirSegredos(texto, segredos);
}

async function pasta() {
  if (pastaEscolhida) return pastaEscolhida;
  for (const candidata of PASTAS) {
    try {
      await mkdir(candidata, { recursive: true });
      pastaEscolhida = candidata;
      return candidata;
    } catch {
      // tenta a próxima
    }
  }
  throw new Error("Não consegui criar a pasta de logs.");
}

export async function pastaDeLogs() {
  return pasta();
}

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function escrever(nivel, mensagem, extra) {
  const linha = redigir(`${new Date().toISOString()} [${nivel}] ${mensagem}${extra ? " " + JSON.stringify(extra) : ""}`);
  console.log(linha);
  try {
    await appendFile(path.join(await pasta(), `keeta-${hoje()}.log`), linha + "\n");
  } catch {
    // log em disco é conveniência: nunca derruba a sincronização
  }
}

export const logger = {
  info: (m, e) => escrever("INFO", m, e),
  warn: (m, e) => escrever("WARN", m, e),
  error: (m, e) => escrever("ERRO", m, e)
};
