// TEMPORARIO — cria um usuario de QA no banco LOCAL para validar a tela de
// leitura de documentos. Recusa rodar se o DATABASE_URL nao for localhost.
import crypto from "node:crypto";
import fs from "node:fs";
import { prisma } from "../src/config/database.js";
import { hashPassword } from "../src/modules/security/security-utils.js";

const EMAIL = "qa.doc-intake@pateodaluz.local";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error("ABORTADO: DATABASE_URL nao aponta para localhost. Este script nunca roda contra producao.");
  }

  const senha = crypto.randomBytes(18).toString("base64url");
  const destino = process.argv[2];
  if (!destino) throw new Error("Informe o caminho do arquivo onde gravar a senha.");

  const existente = await prisma.user.findUnique({ where: { email: EMAIL } });
  const passwordHash = hashPassword(senha);

  if (existente) {
    await prisma.user.update({ where: { email: EMAIL }, data: { passwordHash, isActive: true, role: "ADMIN" } });
    console.log("usuario de QA atualizado:", EMAIL);
  } else {
    await prisma.user.create({
      // O modelo User nao tem default de id — precisa vir pronto.
      data: { id: crypto.randomUUID(), email: EMAIL, name: "QA Leitura de Documentos", passwordHash, role: "ADMIN", isActive: true },
    });
    console.log("usuario de QA criado:", EMAIL);
  }

  fs.writeFileSync(destino, senha, "utf8");
  console.log("senha gravada em:", destino, `(${senha.length} caracteres)`);
}

main().catch((erro) => { console.error(erro instanceof Error ? erro.message : erro); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
