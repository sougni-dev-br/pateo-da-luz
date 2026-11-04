import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { type MenuId, type PermissionAction, userHasPermission } from "../security/menu-permissions.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { importarCartaoPonto } from "./cartao-ponto.service.js";
import { PontoRecusa, apurarMes, batidasDoMes, faltasParaEscala, fecharMes, importarAfd, lancarDia, marcarFolgaBanco, parseMes, reabrirMes } from "./ponto.service.js";

// Ponto: apuração de horas pela CLT para o fechamento da folha. Montado sob /payroll, então o
// controle de acesso já resolve para o módulo da Folha (permissão por usuário, nunca por cargo).
// O que mexe no que vira pagamento pede mais: fechar e reabrir o mês, e lançar faltas na Escala,
// exigem "Aprovar" da Folha; tudo que grava na Escala exige também "Editar" na Escala.
export const pontoRouter = Router();

const MAX_AFD_CARACTERES = 5_000_000;
const MOTIVO_MINIMO_LETRAS = 5;

type Exigencia = [MenuId, PermissionAction];

const auditoria = (request: Request) => ({
  ipAddress: requestIp(request),
  userAgent: String(request.headers["user-agent"] ?? ""),
});

function responderErro(err: unknown, response: Response) {
  if (err instanceof PontoRecusa) return response.status(err.status).json({ message: err.message, codigo: err.codigo });
  throw err;
}

// Sessão válida e todas as permissões pedidas; responde 401/403 e devolve null quando falta alguma.
async function sessaoCom(request: Request, response: Response, exigencias: Exigencia[], acao: string): Promise<SessionUser | null> {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessão obrigatória." });
    return null;
  }
  for (const [modulo, permissao] of exigencias) {
    if (!(await userHasPermission(user as SessionUser, modulo, permissao))) {
      response.status(403).json({ message: `Sem permissão para ${acao}.` });
      return null;
    }
  }
  return user as SessionUser;
}

const letrasDoMotivo = (motivo: unknown): number => (typeof motivo === "string" ? (motivo.match(/\p{L}/gu) ?? []).length : 0);

// GET /payroll/ponto/mes?year=&month= — resumo de fechamento de todas as pessoas.
pontoRouter.get("/mes", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  try {
    const { year, month } = parseMes(request.query.year, request.query.month);
    return response.json({ year, month, pessoas: await apurarMes(year, month) });
  } catch (err) {
    return responderErro(err, response);
  }
});

// GET /payroll/ponto/dias?employeeId=&year=&month= — batidas lançadas, para a tela do papel.
pontoRouter.get("/dias", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  try {
    const { year, month } = parseMes(request.query.year, request.query.month);
    const employeeId = typeof request.query.employeeId === "string" ? request.query.employeeId : "";
    if (!employeeId) throw new PontoRecusa(400, "Funcionário é obrigatório.");
    return response.json(await batidasDoMes(employeeId, year, month));
  } catch (err) {
    return responderErro(err, response);
  }
});

// PUT /payroll/ponto/dia — digita ou corrige as batidas de um dia (lista vazia apaga o dia: pede "Excluir").
pontoRouter.put("/dia", async (request, response) => {
  const b = (request.body ?? {}) as Record<string, unknown>;
  const apagando = Array.isArray(b.marcacoes) && b.marcacoes.length === 0;
  const user = await sessaoCom(request, response, apagando ? [["payroll", "delete"]] : [], "lançar o ponto");
  if (!user) return;
  try {
    const { anterior, ...salvo } = await lancarDia({
      employeeId: String(b.employeeId ?? ""),
      date: String(b.date ?? ""),
      marcacoes: b.marcacoes,
      notes: b.notes,
      userId: user.id,
    });
    await auditLog({
      userId: user.id, action: "SAVE_PONTO_DIA", entity: "PontoDia", entityId: salvo.employeeId,
      previousValue: { date: salvo.date, marcacoes: anterior }, newValue: salvo, ...auditoria(request),
    });
    return response.json(salvo);
  } catch (err) {
    return responderErro(err, response);
  }
});

// PUT /payroll/ponto/folga-banco — { employeeId, date, ativo }: marca (ou desfaz) uma folga tirada contra o banco de horas.
// Grava na Escala: pede também "Editar" na Escala.
pontoRouter.put("/folga-banco", async (request, response) => {
  const user = await sessaoCom(request, response, [["schedule", "edit"]], "mudar a escala");
  if (!user) return;
  const b = (request.body ?? {}) as Record<string, unknown>;
  if (typeof b.ativo !== "boolean") return response.status(400).json({ message: "Informe se a folga do banco é para marcar (true) ou desfazer (false)." });
  try {
    const { anterior, ...r } = await marcarFolgaBanco({ employeeId: String(b.employeeId ?? ""), date: String(b.date ?? ""), ativo: b.ativo, userId: user.id });
    await auditLog({
      userId: user.id, action: r.ativo ? "SET_PONTO_FOLGA_BANCO" : "UNSET_PONTO_FOLGA_BANCO", entity: "EmployeeScheduleDay", entityId: r.employeeId,
      previousValue: { date: r.date, tipo: anterior }, newValue: r, ...auditoria(request),
    });
    return response.json(r);
  } catch (err) {
    return responderErro(err, response);
  }
});

// POST /payroll/ponto/faltas-para-escala — { year, month, simular? }: dia trabalhado sem batida vira FALTA na Escala
// (que a gorjeta, o VT e a folha leem). Com `simular`, só diz o que mudaria. Mexe em dinheiro: pede "Aprovar" na Folha e "Editar" na Escala.
pontoRouter.post("/faltas-para-escala", async (request, response) => {
  const user = await sessaoCom(request, response, [["payroll", "approve"], ["schedule", "edit"]], "lançar as faltas do ponto na escala");
  if (!user) return;
  try {
    const { year, month } = parseMes(request.body?.year, request.body?.month);
    const simular = request.body?.simular !== false;
    const r = await faltasParaEscala({ year, month, userId: user.id, simular });
    if (r.gravadas) {
      await auditLog({
        userId: user.id, action: "PONTO_FALTAS_PARA_ESCALA", entity: "EmployeeScheduleDay",
        previousValue: { diasEAntes: r.detalhe }, newValue: { year, month, faltas: r.faltas }, ...auditoria(request),
      });
    }
    return response.json({ faltas: r.faltas, pessoas: r.pessoas, gravadas: r.gravadas });
  } catch (err) {
    return responderErro(err, response);
  }
});

// POST /payroll/ponto/importar-afd — { texto } com o conteúdo do AFD do REP-P (Portaria 671).
pontoRouter.post("/importar-afd", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const texto = (request.body as { texto?: unknown } | undefined)?.texto;
  if (typeof texto !== "string" || texto.length === 0) return response.status(400).json({ message: "Envie o conteúdo do arquivo AFD." });
  if (texto.length > MAX_AFD_CARACTERES) return response.status(413).json({ message: "Arquivo AFD grande demais." });
  try {
    const resultado = await importarAfd(texto, user.id);
    await auditLog({
      userId: user.id, action: "IMPORT_PONTO_AFD", entity: "PontoDia",
      newValue: { ...resultado, avisos: resultado.avisos.length, arquivoSha256: createHash("sha256").update(texto).digest("hex") },
      ...auditoria(request),
    });
    return response.json(resultado);
  } catch (err) {
    return responderErro(err, response);
  }
});

// POST /payroll/ponto/importar-cartao — { texto, confirmar? } com o Cartão de Ponto em CSV do RHiD.
// Sem confirmar devolve só a prévia; com confirmar: true grava batidas e traduz folga, banco, feriado e falta para a Escala.
pontoRouter.post("/importar-cartao", async (request, response) => {
  const user = await sessaoCom(request, response, [["payroll", "approve"], ["schedule", "edit"]], "importar o cartão de ponto");
  if (!user) return;
  const corpo = request.body as { texto?: unknown; confirmar?: unknown } | undefined;
  const texto = corpo?.texto;
  if (typeof texto !== "string" || texto.length === 0) return response.status(400).json({ message: "Envie o conteúdo do Cartão de Ponto (CSV)." });
  if (texto.length > MAX_AFD_CARACTERES) return response.status(413).json({ message: "Arquivo grande demais." });
  const confirmar = corpo?.confirmar === true;
  try {
    const resultado = await importarCartaoPonto(texto, user.id, confirmar);
    if (confirmar) {
      await auditLog({
        userId: user.id, action: "IMPORT_PONTO_CARTAO", entity: "PontoDia",
        newValue: { ...resultado, divergencias: resultado.divergencias.length, arquivoSha256: createHash("sha256").update(texto).digest("hex") },
        ...auditoria(request),
      });
    }
    return response.json(resultado);
  } catch (err) {
    return responderErro(err, response);
  }
});

// POST /payroll/ponto/fechar — { year, month, confirmarAvisos? }.
pontoRouter.post("/fechar", async (request, response) => {
  const user = await sessaoCom(request, response, [["payroll", "approve"]], "fechar o ponto do mês");
  if (!user) return;
  try {
    const { year, month } = parseMes(request.body?.year, request.body?.month);
    const confirmouAvisos = request.body?.confirmarAvisos === true;
    const r = await fecharMes(year, month, user.id, { confirmarAvisos: confirmouAvisos });
    await auditLog({
      userId: user.id, action: "CLOSE_PONTO_MES", entity: "PontoFechamento",
      newValue: { year, month, ...r, confirmouAvisos }, ...auditoria(request),
    });
    return response.json(r);
  } catch (err) {
    return responderErro(err, response);
  }
});

// POST /payroll/ponto/reabrir — { year, month, motivo }. O fechamento completo vai para a auditoria.
pontoRouter.post("/reabrir", async (request, response) => {
  const user = await sessaoCom(request, response, [["payroll", "approve"]], "reabrir o ponto do mês");
  if (!user) return;
  const motivo = typeof request.body?.motivo === "string" ? request.body.motivo.trim().slice(0, 300) : "";
  if (letrasDoMotivo(motivo) < MOTIVO_MINIMO_LETRAS) {
    return response.status(400).json({ message: `Informe o motivo de reabrir o ponto (pelo menos ${MOTIVO_MINIMO_LETRAS} letras).` });
  }
  try {
    const { year, month } = parseMes(request.body?.year, request.body?.month);
    const { pessoas, ...r } = await reabrirMes(year, month);
    await auditLog({
      userId: user.id, action: "REOPEN_PONTO_MES", entity: "PontoFechamento",
      previousValue: { fechamento: pessoas }, newValue: { year, month, motivo, ...r }, ...auditoria(request),
    });
    return response.json(r);
  } catch (err) {
    return responderErro(err, response);
  }
});
