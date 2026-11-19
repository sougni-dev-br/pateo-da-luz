// Rotas da tabela de funções e pontos-base da gorjeta.
// Montado em tip-commission.routes.ts (mesmo prefixo /payroll/tip).

import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { registrarHistorico } from "./tip-historico.service.js";
import { parseDateUTC, numOrNull, textoOuNull, hojeSaoPaulo } from "./tip-routes-comum.js";

export const tipFuncoesRouter = Router();
const router = tipFuncoesRouter;

// ─── Tabela de funções e pontos-base ────────────────────────────────────────
// Versão da tabela de funções: muda a cada gravação. Quem edita manda a versão
// que abriu; se outra pessoa salvou no meio, o servidor recusa em vez de sobrescrever.
function funcaoParaTela(f: { id: string; name: string; points: unknown; minPoints: unknown; maxPoints: unknown; group: string | null; notes: string | null; sortOrder: number; isActive: boolean }) {
  return {
    id: f.id, name: f.name, points: Number(f.points),
    minPoints: f.minPoints == null ? null : Number(f.minPoints),
    maxPoints: f.maxPoints == null ? null : Number(f.maxPoints),
    group: f.group, notes: f.notes, sortOrder: f.sortOrder, isActive: f.isActive,
  };
}

function versaoDaTabela(funcoes: Array<{ updatedAt: Date }>): string {
  const ultima = funcoes.reduce((m, f) => Math.max(m, f.updatedAt.getTime()), 0);
  return `${funcoes.length}:${ultima}`;
}

router.get("/functions", async (_request, response) => {
  const funcoes = await prisma.tipFunction.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  response.json(funcoes.map(funcaoParaTela));
});

// Tabela para edição: as funções e a versão aberta (para não sobrescrever quem salvou antes).
router.get("/functions/table", async (_request, response) => {
  const funcoes = await prisma.tipFunction.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  response.json({ versao: versaoDaTabela(funcoes), funcoes: funcoes.map(funcaoParaTela) });
});

router.get("/functions/history", async (_request, response) => {
  const linhas = await prisma.tipFunctionHistory.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  response.json(linhas.map((l) => ({
    id: l.id, tipFunctionId: l.tipFunctionId, name: l.name,
    pointsBefore: l.pointsBefore == null ? null : Number(l.pointsBefore), pointsAfter: Number(l.pointsAfter),
    minPoints: l.minPoints == null ? null : Number(l.minPoints), maxPoints: l.maxPoints == null ? null : Number(l.maxPoints),
    createdAt: l.createdAt.toISOString(),
  })));
});

// Grava a tabela inteira (cria as novas, atualiza as existentes). Função não se
// apaga — desativa — porque funcionários e períodos antigos apontam para ela.
router.put("/functions", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const list = b.functions;
  if (!Array.isArray(list)) return response.status(400).json({ message: "functions deve ser uma lista." });

  const limpas = (list as Array<Record<string, unknown>>).map((raw, i) => ({
    id: raw.id ? String(raw.id) : null,
    name: String(raw.name ?? "").trim(),
    points: numOrNull(raw.points),
    minPoints: numOrNull(raw.minPoints),
    maxPoints: numOrNull(raw.maxPoints),
    group: raw.group ? String(raw.group).trim() : null,
    notes: raw.notes ? String(raw.notes).trim() : null,
    sortOrder: numOrNull(raw.sortOrder) ?? i + 1,
    isActive: raw.isActive !== false,
  }));
  const invalida = limpas.find((f) => !f.name || f.points == null || f.points < 0);
  if (invalida) return response.status(422).json({ message: `Função "${invalida.name || "sem nome"}": informe nome e pontos (≥ 0).` });
  const foraDaFaixa = limpas.find((f) => (f.minPoints != null && f.maxPoints != null && f.minPoints > f.maxPoints)
    || (f.minPoints != null && f.points! < f.minPoints) || (f.maxPoints != null && f.points! > f.maxPoints));
  if (foraDaFaixa) return response.status(422).json({ message: `Função "${foraDaFaixa.name}": os pontos precisam ficar entre o mínimo e o máximo.` });
  const nomes = new Set<string>();
  for (const f of limpas) {
    const k = f.name.toLocaleLowerCase("pt-BR");
    if (nomes.has(k)) return response.status(422).json({ message: `A função "${f.name}" aparece duas vezes.` });
    nomes.add(k);
  }

  const antes = await prisma.tipFunction.findMany();
  const versaoAberta = typeof b.baseVersion === "string" ? b.baseVersion : null;
  if (versaoAberta && versaoAberta !== versaoDaTabela(antes)) {
    return response.status(409).json({
      message: "A tabela de funções foi salva por outra pessoa depois que você começou a editar. Suas alterações continuam na tela: confira e salve de novo.",
    });
  }
  const antesPorId = new Map(antes.map((a) => [a.id, a]));
  const vigencia = parseDateUTC(b.validFrom) ?? hojeSaoPaulo();
  const motivo = textoOuNull((request.body as Record<string, unknown>).reason);
  await prisma.$transaction(async (tx) => {
    for (const f of limpas) {
      const dados = {
        name: f.name, points: f.points!, minPoints: f.minPoints, maxPoints: f.maxPoints,
        group: f.group, notes: f.notes, sortOrder: f.sortOrder, isActive: f.isActive,
      };
      const velha = f.id ? antesPorId.get(f.id) : undefined;
      const id = f.id ?? crypto.randomUUID();
      if (f.id) await tx.tipFunction.update({ where: { id }, data: dados });
      else await tx.tipFunction.create({ data: { id, ...dados } });
      const mudouPontos = !velha || Number(velha.points) !== f.points;
      const mudouNome = velha && velha.name !== f.name;
      const mudouFaixa = velha && (Number(velha.minPoints ?? -1) !== (f.minPoints ?? -1) || Number(velha.maxPoints ?? -1) !== (f.maxPoints ?? -1));
      if (mudouPontos || mudouNome || mudouFaixa) {
        await tx.tipFunctionHistory.create({
          data: {
            id: crypto.randomUUID(), tipFunctionId: id, name: f.name,
            pointsBefore: velha ? Number(velha.points) : null, pointsAfter: f.points!,
            minPoints: f.minPoints, maxPoints: f.maxPoints, changedById: user.id,
          },
        });
      }
      // Quem está nesta função tem a base alterada: fica no histórico dele.
      if (velha && (mudouPontos || mudouNome)) {
        const afetados = await tx.employee.findMany({ where: { tipFunctionId: id, deletedAt: null }, select: { id: true } });
        for (const a of afetados) {
          await registrarHistorico(tx, a.id, vigencia,
            user.id, motivo ?? `Tabela de funções: "${f.name}" ${mudouPontos ? `passou de ${Number(velha.points)} para ${f.points} pontos` : "mudou de nome"}`);
        }
      }
    }
  });
  await auditLog({
    userId: user.id, action: "UPDATE_TIP_FUNCTIONS", entity: "TipFunction", entityId: "tabela",
    previousValue: antes, newValue: limpas,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

