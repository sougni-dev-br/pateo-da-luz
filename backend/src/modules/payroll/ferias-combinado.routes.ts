// RH → Férias: soma ao título de férias (do recibo da contabilidade) a diferença do salário combinado e da
// gorjeta integral. POST /payroll/ferias/combinado  { payrollItemId, aplicar, gorjetasInformadas? }
//   aplicar=false → prévia (nada é gravado); aplicar=true → grava no título em aberto.
//   gorjetasInformadas: { "AAAA-MM": valor } — gorjeta integral de meses sem apuração no ERP, informada à mão.
// Montado em /payroll/ferias: o controle de acesso resolve pelo prefixo /payroll (mesmo módulo da Folha).
import { Router } from "express";
import { userHasPermission } from "../security/menu-permissions.js";
import { getSessionUser, type SessionUser } from "../security/security-utils.js";
import { RecusaFerias, somarCombinadoAFerias } from "./ferias-combinado.service.js";

export const feriasCombinadoRouter = Router();

feriasCombinadoRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  // Combinado, gorjeta e média são dado de salário: só quem vê Funcionários (mesma regra do detalhe do título no Contas a Pagar).
  if (!(await userHasPermission(user as SessionUser, "employees", "view"))) {
    return response.status(403).json({ message: "Sem permissão para ver salários: o complemento do combinado exige acesso a Funcionários." });
  }
  const b = (request.body ?? {}) as { payrollItemId?: unknown; aplicar?: unknown; gorjetasInformadas?: unknown };
  if (typeof b.payrollItemId !== "string" || !b.payrollItemId) return response.status(400).json({ message: "Informe o título de férias (payrollItemId)." });
  if (b.gorjetasInformadas != null && (typeof b.gorjetasInformadas !== "object" || Array.isArray(b.gorjetasInformadas))) {
    return response.status(400).json({ message: "gorjetasInformadas deve ser um objeto { \"AAAA-MM\": valor }." });
  }
  try {
    const r = await somarCombinadoAFerias({
      payrollItemId: b.payrollItemId, aplicar: b.aplicar === true, usuario: { id: user.id, name: user.name ?? "" },
      informadas: (b.gorjetasInformadas ?? undefined) as Record<string, unknown> | undefined,
    });
    return response.json(r);
  } catch (err) {
    if (err instanceof RecusaFerias) return response.status(err.status).json({ message: err.message });
    throw err;
  }
});
