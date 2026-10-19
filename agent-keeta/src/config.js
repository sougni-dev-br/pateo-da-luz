import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { urlDoErpValida } from "./logica.js";

// config.json guarda a senha da Keeta e o token do ERP: fica FORA do controle de versão (git-ignored).
// Procura primeiro em C:\PateoAgentKeeta\config.json (produção) e cai para agent-keeta/config.json em dev.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATOS = [
  process.env.PATEO_KEETA_CONFIG,
  "C:\\PateoAgentKeeta\\config.json",
  path.resolve(__dirname, "..", "config.json")
].filter(Boolean);

const PADROES = {
  portal: { navegador: "msedge", headless: true, shopId: null },
  backend: { retryMaxAttempts: 3, retryDelayMs: 300000 },
  perfilDir: "C:\\PateoAgentKeeta\\perfil"
};

export async function loadConfig() {
  const erros = [];
  for (const candidato of CANDIDATOS) {
    try {
      const bruto = JSON.parse(await readFile(candidato, "utf-8"));
      const config = {
        ...bruto,
        portal: { ...PADROES.portal, ...bruto.portal },
        backend: { ...PADROES.backend, ...bruto.backend },
        perfilDir: bruto.perfilDir ?? PADROES.perfilDir
      };
      validar(config);
      return { config, caminho: candidato };
    } catch (err) {
      erros.push(`  ${candidato}: ${err.message}`);
    }
  }
  throw new Error(
    "Configuração não encontrada. Tentativas:\n" + erros.join("\n") +
    "\n\nCopie config.example.json para C:\\PateoAgentKeeta\\config.json e preencha os valores."
  );
}

export function validar(config) {
  const faltando = [];
  if (!Number.isInteger(config.portal?.shopId)) faltando.push("portal.shopId (número da loja na Keeta)");
  if (!urlDoErpValida(config.backend?.baseUrl)) faltando.push("backend.baseUrl (precisa ser https://, exceto http://localhost para teste)");
  if (!config.backend?.ingestToken || config.backend.ingestToken === "TROCAR") faltando.push("backend.ingestToken");
  // E-mail e senha só são exigidos para renovar o login sozinho; sem eles o agente avisa e espera.
  if (faltando.length > 0) throw new Error(`Campos obrigatórios ausentes: ${faltando.join(", ")}`);
}

/** Credenciais são opcionais: sem elas, quando o login cair o agente só avisa o ERP. */
export function temCredenciais(config) {
  const { email, senha } = config.portal ?? {};
  return Boolean(email && senha && senha !== "TROCAR");
}
