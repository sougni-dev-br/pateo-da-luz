import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// config.json fica fora do controle de versão (git-ignored). Este loader
// procura primeiro em C:\PateoAgent\config.json (padrão de produção)
// e cai para <repo>/agent-pdv/config.json em dev. Ambos os caminhos são
// tentados sem side-effects — se nenhum existir, a mensagem de erro
// aponta o caminho esperado.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  process.env.PATEO_AGENT_CONFIG,
  "C:\\PateoAgent\\config.json",
  path.resolve(__dirname, "..", "config.json")
].filter(Boolean);

export async function loadConfig() {
  const errors = [];
  for (const candidate of CANDIDATES) {
    try {
      const raw = await readFile(candidate, "utf-8");
      const parsed = JSON.parse(raw);
      validate(parsed);
      return { config: parsed, path: candidate };
    } catch (err) {
      errors.push(`  ${candidate}: ${err.message}`);
    }
  }
  throw new Error(
    "Configuração não encontrada. Tentativas:\n" + errors.join("\n") +
    "\n\nCopie config.example.json para C:\\PateoAgent\\config.json e preencha os valores."
  );
}

function validate(cfg) {
  const missing = [];
  if (!cfg.agileReport?.baseUrl) missing.push("agileReport.baseUrl");
  if (!cfg.agileReport?.usuario) missing.push("agileReport.usuario");
  if (!cfg.agileReport?.senha || cfg.agileReport.senha === "TROCAR") missing.push("agileReport.senha");
  if (!cfg.backend?.baseUrl) missing.push("backend.baseUrl");
  if (!cfg.backend?.ingestToken || cfg.backend.ingestToken === "TROCAR") missing.push("backend.ingestToken");
  if (missing.length > 0) {
    throw new Error(`Campos obrigatórios ausentes: ${missing.join(", ")}`);
  }
}
