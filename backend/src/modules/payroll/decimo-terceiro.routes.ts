// 13º dos sem registro, em /payroll/decimo-terceiro. A prévia mostra salário: exige ver Funcionários.
import { Router } from "express";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { gerarDecimoTerceiroSR, listarDecimoTerceiroSR } from "./decimo-terceiro.service.js";

export const decimoTerceiroRouter = Router();

const MSG_SEM_PERMISSAO = "O 13º é calculado sobre o salário: exige a permissão de ver Funcionários.";

// Ausente = ano corrente. Informado e inválido = erro (gerar 13º no ano errado em silêncio é pior que recusar).
export function lerAno(v: unknown): number | null {
  if (v == null || v === "") return new Date().getFullYear();
  const n = Number(v);
  return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : null;
}

const MSG_ANO = "Ano inválido (use um ano entre 2020 e 2100).";

decimoTerceiroRouter.get("/", async (request, response) => {
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO });
  const ano = lerAno(request.query.year);
  if (ano == null) return response.status(400).json({ message: MSG_ANO });
  response.json({ ano, linhas: await listarDecimoTerceiroSR(ano) });
});

decimoTerceiroRouter.post("/generate", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO });
  const ano = lerAno((request.body ?? {}).year);
  if (ano == null) return response.status(400).json({ message: MSG_ANO });
  let resultado;
  try {
    resultado = await gerarDecimoTerceiroSR(ano, user.id);
  } catch (error) {
    // Mês de folha fechado: nada foi gravado, e quem gerou precisa saber por quê.
    return response.status(422).json({ message: error instanceof Error ? error.message : "Não foi possível gerar o 13º." });
  }
  // Só contagens: os nomes dos avisos já voltam na resposta, e o log não precisa deles.
  await auditLog({
    userId: user.id, action: "GENERATE_DECIMO_TERCEIRO", entity: "PayrollItem",
    newValue: { ano: resultado.ano, criadas: resultado.criadas, restauradas: resultado.restauradas, semCalculo: resultado.semCalculo, avisos: resultado.avisos.length },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json(resultado);
});
