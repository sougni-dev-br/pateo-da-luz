// 13º dos sem registro, em /payroll/decimo-terceiro. A prévia mostra salário: exige ver Funcionários.
import { Router } from "express";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { gerarDecimoTerceiroSR, listarDecimoTerceiroSR } from "./decimo-terceiro.service.js";

export const decimoTerceiroRouter = Router();

const MSG_SEM_PERMISSAO = "O 13º é calculado sobre o salário: exige a permissão de ver Funcionários.";

function lerAno(v: unknown): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : new Date().getFullYear();
}

decimoTerceiroRouter.get("/", async (request, response) => {
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO });
  const ano = lerAno(request.query.year);
  response.json({ ano, linhas: await listarDecimoTerceiroSR(ano) });
});

decimoTerceiroRouter.post("/generate", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO });
  const resultado = await gerarDecimoTerceiroSR(lerAno((request.body ?? {}).year), user.id);
  await auditLog({
    userId: user.id, action: "GENERATE_DECIMO_TERCEIRO", entity: "PayrollItem", newValue: resultado,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json(resultado);
});
