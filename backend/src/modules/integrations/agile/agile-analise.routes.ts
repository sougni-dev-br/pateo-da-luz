import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { obterCancelamentos, obterDescontos, obterItensCancelados, obterVendasPorPessoa } from "./agile-analise.service.js";

export const agileAnaliseRouter = Router();

const MAX_DIAS = 366;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use o formato AAAA-MM-DD");

const periodoSchema = z
  .object({ inicio: dataIso, fim: dataIso })
  .superRefine((p, ctx) => {
    const de = Date.parse(`${p.inicio}T00:00:00.000Z`);
    const ate = Date.parse(`${p.fim}T00:00:00.000Z`);
    // "2026-02-30" pode virar 02/03 em vez de falhar: confere a data de ida e volta.
    const existe = !Number.isNaN(de) && !Number.isNaN(ate)
      && new Date(de).toISOString().slice(0, 10) === p.inicio
      && new Date(ate).toISOString().slice(0, 10) === p.fim;
    if (!existe) {
      ctx.addIssue({ code: "custom", message: "data inexistente" });
    } else if (ate < de) {
      ctx.addIssue({ code: "custom", message: "o fim não pode ser anterior ao início" });
    } else if ((ate - de) / UM_DIA_MS + 1 > MAX_DIAS) {
      ctx.addIssue({ code: "custom", message: `o período máximo é de ${MAX_DIAS} dias` });
    }
  });

// Ranking de funcionario e dado sensivel: modulo proprio no controle de acesso
// ("analise-salao"), que nasce desmarcado. O requireMenuAccess global ja barra pelo
// caminho; esta checagem repete na rota para que um erro de mapeamento nao abra a tela.
async function exigirAnaliseSalao(request: Request, response: Response, next: NextFunction) {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessão obrigatória." });
    return;
  }
  if (!(await userHasPermission(user as SessionUser, "analise-salao", "view"))) {
    response.status(403).json({ message: "Usuário sem permissão para a análise do salão." });
    return;
  }
  next();
}

function lerPeriodo(request: Request, response: Response) {
  const parsed = periodoSchema.safeParse(request.query);
  if (!parsed.success) {
    const problema = parsed.error.issues[0];
    const campo = problema?.path.join(".");
    response.status(400).json({ message: `Período inválido${campo ? ` (${campo})` : ""}: ${problema?.message ?? "confira início e fim"}` });
    return null;
  }
  return parsed.data;
}

agileAnaliseRouter.get("/cancelamentos", exigirAnaliseSalao, async (request, response) => {
  const periodo = lerPeriodo(request, response);
  if (!periodo) return;
  try {
    response.json(await obterCancelamentos(periodo));
  } catch (error: unknown) {
    console.error("Falha ao montar o relatório de cancelamentos do salão", error);
    response.status(500).json({ message: "Não foi possível gerar o relatório de cancelamentos." });
  }
});

agileAnaliseRouter.get("/vendas-por-pessoa", exigirAnaliseSalao, async (request, response) => {
  const periodo = lerPeriodo(request, response);
  if (!periodo) return;
  try {
    response.json(await obterVendasPorPessoa(periodo));
  } catch (error: unknown) {
    console.error("Falha ao montar o relatório de vendas por pessoa", error);
    response.status(500).json({ message: "Não foi possível gerar o relatório de vendas por pessoa." });
  }
});

agileAnaliseRouter.get("/itens-cancelados", exigirAnaliseSalao, async (request, response) => {
  const periodo = lerPeriodo(request, response);
  if (!periodo) return;
  try {
    response.json(await obterItensCancelados(periodo));
  } catch (error: unknown) {
    console.error("Falha ao montar o relatório de itens cancelados", error);
    response.status(500).json({ message: "Não foi possível gerar o relatório de itens cancelados." });
  }
});

agileAnaliseRouter.get("/descontos", exigirAnaliseSalao, async (request, response) => {
  const periodo = lerPeriodo(request, response);
  if (!periodo) return;
  try {
    response.json(await obterDescontos(periodo));
  } catch (error: unknown) {
    console.error("Falha ao montar o relatório de descontos", error);
    response.status(500).json({ message: "Não foi possível gerar o relatório de descontos." });
  }
});
