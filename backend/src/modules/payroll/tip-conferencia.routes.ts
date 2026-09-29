// Depois da apuração: envio à contabilidade → extratos devolvidos (conferência)
// → OK dado → folha salarial líquidos (lista de pagamento no banco) → paga.
// Montado dentro de tipCommissionRouter (/payroll/tip).
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { computeTipCommission } from "./tip-commission.service.js";
import { onlyDigits, parseExtratoMensal } from "./rh-extract.service.js";
import {
  type Combinados, type ExtratoEmpresa, type LinhaExtrato, type PessoaApurada, conferir, ehPendente, montarFolhaLiquidos,
} from "./tip-conferencia.js";

export const tipConferenciaRouter = Router();

const LIMITE_PDF = 5 * 1024 * 1024;
const ETAPAS = ["ENVIADO_CONTABILIDADE", "OK_CONTABILIDADE", "FOLHA_PAGA"] as const;
type Etapa = (typeof ETAPAS)[number];

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

async function podeVerDadosPessoais(request: Request) {
  const user = await getSessionUser(request);
  return user ? userHasPermission(user as SessionUser, "employees", "view") : false;
}

async function periodoDe(request: Request, response: Response) {
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  const periodo = await prisma.tipPeriod.findUnique({ where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } } });
  if (!periodo) { response.status(404).json({ message: "Período não encontrado." }); return null; }
  return periodo;
}

// Estado atual de cada etapa: o último registro dela (marcou ou desmarcou).
async function estadoEtapas(periodId: string) {
  const eventos = await prisma.tipPeriodEtapa.findMany({ where: { periodId }, orderBy: { em: "asc" } });
  const estado: Record<Etapa, { marcada: boolean; em: string | null; por: string | null; obs: string | null }> = {
    ENVIADO_CONTABILIDADE: { marcada: false, em: null, por: null, obs: null },
    OK_CONTABILIDADE: { marcada: false, em: null, por: null, obs: null },
    FOLHA_PAGA: { marcada: false, em: null, por: null, obs: null },
  };
  for (const e of eventos) {
    if (!(e.etapa in estado)) continue;
    estado[e.etapa as Etapa] = { marcada: e.acao === "MARCOU", em: e.em.toISOString(), por: e.por, obs: e.obs };
  }
  return {
    estado,
    historico: eventos.map((e) => ({ etapa: e.etapa, acao: e.acao, em: e.em.toISOString(), por: e.por, obs: e.obs })),
  };
}

// Pessoas da apuração com o que a conferência e a folha precisam (PIX só com permissão).
async function pessoasApuradas(year: number, month: number, comPix: boolean): Promise<PessoaApurada[]> {
  const comp = await computeTipCommission(year, month, { incluirDadosPessoais: comPix });
  const ids = comp.participants.map((p) => p.employeeId);
  const cadastro = await prisma.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true, company: { select: { cnpj: true } } },
  });
  const porId = new Map(cadastro.map((e) => [e.id, e]));
  return comp.participants.map((p) => {
    const e = porId.get(p.employeeId);
    return {
      employeeId: p.employeeId,
      nome: p.employeeName,
      semRegistro: p.semRegistro,
      noPeriodo: p.tipoCalculo !== "FORA_DO_PERIODO",
      pagoNaRescisao: p.pagoNaRescisao,
      gorjetaLiquida: p.netCommission,
      totalAPagar: p.totalAPagar,
      cnpjEmpresa: e?.company?.cnpj ?? null,
      pix: comPix ? p.pixKey : null,
    };
  });
}

// Extratos gravados + quem do cadastro tem salário combinado mas não está na apuração.
async function extratosDoPeriodo(periodId: string) {
  const extratos = await prisma.tipExtrato.findMany({ where: { periodId }, orderBy: { empresa: "asc" } });
  return extratos.map((e) => ({
    meta: { id: e.id, empresa: e.empresa, cnpj: e.cnpj, arquivo: e.arquivo, hash: e.hash, importadoEm: e.importadoEm.toISOString(), importadoPor: e.importadoPor },
    dados: { id: e.id, empresa: e.empresa, cnpj: e.cnpj, linhas: e.linhas as LinhaExtrato[] } satisfies ExtratoEmpresa,
  }));
}

async function combinadosDe(extratos: Array<{ dados: ExtratoEmpresa }>): Promise<Combinados> {
  const ids = extratos.flatMap((e) => e.dados.linhas.map((l) => l.employeeId)).filter((x): x is string => Boolean(x));
  const lista = await prisma.employee.findMany({ where: { id: { in: ids }, salarioCombinado: { not: null } }, select: { id: true, salarioCombinado: true } });
  return new Map(lista.map((e) => [e.id, Number(e.salarioCombinado)]));
}

async function montarConferencia(periodo: { id: string; competenceYear: number; competenceMonth: number }) {
  const [pessoas, extratos, aceites] = await Promise.all([
    pessoasApuradas(periodo.competenceYear, periodo.competenceMonth, false),
    extratosDoPeriodo(periodo.id),
    prisma.tipConferenciaAceite.findMany({ where: { periodId: periodo.id } }),
  ]);
  const linhas = conferir(pessoas, extratos.map((e) => e.dados), new Map(aceites.map((a) => [a.employeeKey, a.justificativa])), await combinadosDe(extratos));
  return {
    extratos: extratos.map((e) => ({ ...e.meta, pessoas: e.dados.linhas.length })),
    linhas,
    pendentes: linhas.filter((l) => ehPendente(l.status)).length,
  };
}

tipConferenciaRouter.get("/periods/:year/:month/conferencia", async (request, response) => {
  const periodo = await periodoDe(request, response);
  if (!periodo) return;
  const [conf, etapas] = await Promise.all([montarConferencia(periodo), estadoEtapas(periodo.id)]);
  response.json({ code: periodo.code, status: periodo.status, ...conf, etapas, podeVerFolha: await podeVerDadosPessoais(request) });
});

// Extrato de uma empresa: lê o PDF, confere a competência, casa cada pessoa com o
// cadastro (CPF; na falta, nome) e grava as linhas sem CPF. Reenviar a mesma empresa substitui.
tipConferenciaRouter.post("/periods/:year/:month/extratos", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodo = await periodoDe(request, response);
  if (!periodo) return;
  const b = request.body as { fileBase64?: unknown; fileName?: unknown };
  if (typeof b.fileBase64 !== "string" || !b.fileBase64) return response.status(400).json({ message: "Envie o PDF do extrato." });
  const buffer = Buffer.from(b.fileBase64.replace(/^data:[^,]*,/, ""), "base64");
  if (buffer.length > LIMITE_PDF) return response.status(413).json({ message: "Arquivo grande demais para um extrato (máximo 5 MB)." });
  let lido;
  try { lido = await parseExtratoMensal(buffer); } catch (err) {
    return response.status(422).json({ message: "Não foi possível ler o PDF do extrato. " + (err as Error).message });
  }
  if (!lido.cnpj || lido.funcionarios.length === 0) {
    return response.status(422).json({ message: "Não achei empresa ou funcionários no arquivo. Confira se é o Extrato Mensal da contabilidade." });
  }
  if (lido.competenceYear !== periodo.competenceYear || lido.competenceMonth !== periodo.competenceMonth) {
    return response.status(422).json({
      message: `O extrato é da competência ${String(lido.competenceMonth).padStart(2, "0")}/${lido.competenceYear}, e esta apuração é ${String(periodo.competenceMonth).padStart(2, "0")}/${periodo.competenceYear}.`,
    });
  }
  const etapas = await estadoEtapas(periodo.id);
  if (etapas.estado.OK_CONTABILIDADE.marcada) {
    return response.status(409).json({ message: "O OK à contabilidade já foi dado. Desmarque o OK para trocar o extrato." });
  }

  const cadastro = await prisma.employee.findMany({
    where: { deletedAt: null }, select: { id: true, cpf: true, firstName: true, lastName: true },
  });
  const porCpf = new Map(cadastro.map((e) => [onlyDigits(e.cpf), e.id]));
  const avisos: string[] = [];
  // Vínculos já confirmados num envio anterior do mesmo extrato continuam valendo.
  const anterior = await prisma.tipExtrato.findUnique({ where: { periodId_cnpj: { periodId: periodo.id, cnpj: lido.cnpj } }, select: { linhas: true } });
  const confirmados = new Map(((anterior?.linhas ?? []) as LinhaExtrato[])
    .filter((l) => l.vinculo === "CONFIRMADO" && l.employeeId).map((l) => [l.nome, l.employeeId!]));
  type Vinculo = { employeeId: string | null; vinculo: "CPF" | "NOME" | "CONFIRMADO" | undefined };
  const achar = (nome: string, cpfNorm: string): Vinculo => {
    const porDoc = cpfNorm ? porCpf.get(cpfNorm) : undefined;
    if (porDoc) return { employeeId: porDoc, vinculo: "CPF" };
    const jaConfirmado = confirmados.get(nome);
    if (jaConfirmado) return { employeeId: jaConfirmado, vinculo: "CONFIRMADO" };
    const alvo = semAcento(nome);
    const exato = cadastro.filter((e) => semAcento(`${e.firstName} ${e.lastName}`) === alvo);
    if (exato.length === 1) { avisos.push(`${nome}: CPF diferente do cadastro, reconhecido pelo nome — confirme.`); return { employeeId: exato[0].id, vinculo: "NOME" }; }
    // Nome do cadastro mais curto que o do extrato ("Anderson Fernandes" × "ANDERSON FERNANDES DOS SANTOS").
    const contido = cadastro.filter((e) => {
      const partes = semAcento(`${e.firstName} ${e.lastName}`).split(" ");
      return partes.length >= 2 && alvo.startsWith(partes[0] + " ") && partes.every((p) => alvo.split(" ").includes(p));
    });
    if (contido.length === 1) { avisos.push(`${nome}: reconhecido pelo nome parcial — confirme.`); return { employeeId: contido[0].id, vinculo: "NOME" }; }
    avisos.push(`${nome}: não achado no cadastro.`);
    return { employeeId: null, vinculo: undefined };
  };
  const linhas: LinhaExtrato[] = lido.funcionarios.map((f) => ({
    ...achar(f.nome, f.cpfNorm), nome: f.nome, liquido: f.liquido, gorjeta: f.gorjeta,
    adiantamento: f.adiantamento, situacao: f.situacao,
  }));
  const arquivo = String(b.fileName ?? "extrato.pdf").replace(/[^\p{L}\p{N}.\-() _]/gu, "_").slice(0, 120);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const dados = {
    empresa: lido.empresa, competenceYear: lido.competenceYear, competenceMonth: lido.competenceMonth,
    arquivo, hash, linhas, importadoPorId: user.id, importadoPor: user.name, importadoEm: new Date(),
  };
  await prisma.tipExtrato.upsert({
    where: { periodId_cnpj: { periodId: periodo.id, cnpj: lido.cnpj } },
    create: { id: crypto.randomUUID(), periodId: periodo.id, cnpj: lido.cnpj, ...dados },
    update: dados,
  });
  await auditLog({
    userId: user.id, action: "TIP_EXTRATO_CONFERENCIA", entity: "TipPeriod", entityId: periodo.code,
    newValue: { empresa: lido.empresa, cnpj: lido.cnpj, arquivo, hash, pessoas: linhas.length },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ...(await montarConferencia(periodo)), avisos });
});

tipConferenciaRouter.delete("/periods/:year/:month/extratos/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodo = await periodoDe(request, response);
  if (!periodo) return;
  if ((await estadoEtapas(periodo.id)).estado.OK_CONTABILIDADE.marcada) {
    return response.status(409).json({ message: "O OK à contabilidade já foi dado. Desmarque o OK para tirar o extrato." });
  }
  const r = await prisma.tipExtrato.deleteMany({ where: { id: request.params.id, periodId: periodo.id } });
  if (r.count === 0) return response.status(404).json({ message: "Extrato não encontrado." });
  await auditLog({ userId: user.id, action: "TIP_EXTRATO_REMOVIDO", entity: "TipPeriod", entityId: periodo.code, newValue: { id: request.params.id } });
  response.json(await montarConferencia(periodo));
});

// Aceitar uma divergência (com justificativa) ou desfazer o aceite.
tipConferenciaRouter.put("/periods/:year/:month/conferencia/aceites", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodo = await periodoDe(request, response);
  if (!periodo) return;
  const b = request.body as { chave?: unknown; justificativa?: unknown };
  const chave = String(b.chave ?? "").trim();
  const justificativa = String(b.justificativa ?? "").trim();
  if (!chave) return response.status(400).json({ message: "Informe de quem é a divergência." });
  if (justificativa.length < 5) return response.status(422).json({ message: "Escreva a justificativa (pelo menos 5 letras)." });
  await prisma.tipConferenciaAceite.upsert({
    where: { periodId_employeeKey: { periodId: periodo.id, employeeKey: chave } },
    create: { id: crypto.randomUUID(), periodId: periodo.id, employeeKey: chave, justificativa, porId: user.id, por: user.name },
    update: { justificativa, porId: user.id, por: user.name, em: new Date() },
  });
  await auditLog({ userId: user.id, action: "TIP_CONFERENCIA_ACEITE", entity: "TipPeriod", entityId: periodo.code, newValue: { chave, justificativa } });
  response.json(await montarConferencia(periodo));
});

tipConferenciaRouter.delete("/periods/:year/:month/conferencia/aceites", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodo = await periodoDe(request, response);
  if (!periodo) return;
  const chave = String((request.query as Record<string, unknown>).chave ?? "");
  await prisma.tipConferenciaAceite.deleteMany({ where: { periodId: periodo.id, employeeKey: chave } });
  await auditLog({ userId: user.id, action: "TIP_CONFERENCIA_ACEITE_DESFEITO", entity: "TipPeriod", entityId: periodo.code, newValue: { chave } });
  response.json(await montarConferencia(periodo));
});

// Marcar/desmarcar uma etapa. Cada etapa exige a anterior; o OK exige a conferência sem pendência.
tipConferenciaRouter.post("/periods/:year/:month/etapas", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodo = await periodoDe(request, response);
  if (!periodo) return;
  const b = request.body as { etapa?: unknown; acao?: unknown; obs?: unknown };
  const etapa = String(b.etapa ?? "") as Etapa;
  const acao = b.acao === "DESMARCOU" ? "DESMARCOU" : "MARCOU";
  if (!ETAPAS.includes(etapa)) return response.status(400).json({ message: "Etapa desconhecida." });
  // Dar o OK e marcar a folha como paga autorizam o pagamento: exigem "Aprovar".
  if (etapa !== "ENVIADO_CONTABILIDADE" && !(await userHasPermission(user as SessionUser, "payroll-tips", "approve"))) {
    return response.status(403).json({ message: "Dar o OK e marcar a folha como paga exigem a permissão de aprovar a gorjeta." });
  }
  const { estado } = await estadoEtapas(periodo.id);
  const i = ETAPAS.indexOf(etapa);
  if (acao === "MARCOU") {
    if (periodo.status !== "CLOSED") return response.status(409).json({ message: "Feche o período da gorjeta antes: os valores enviados não podem mudar depois." });
    if (i > 0 && !estado[ETAPAS[i - 1]].marcada) return response.status(409).json({ message: "Marque a etapa anterior primeiro." });
    if (etapa === "OK_CONTABILIDADE") {
      const conf = await montarConferencia(periodo);
      if (conf.extratos.length === 0) return response.status(409).json({ message: "Carregue o extrato de cada empresa antes de dar o OK." });
      if (conf.pendentes > 0) return response.status(409).json({ message: `Ainda há ${conf.pendentes} divergência(s) na conferência. Corrija ou aceite com justificativa.` });
    }
  } else if (i < ETAPAS.length - 1 && estado[ETAPAS[i + 1]].marcada) {
    return response.status(409).json({ message: "Desmarque a etapa seguinte primeiro." });
  }
  await prisma.tipPeriodEtapa.create({
    data: { id: crypto.randomUUID(), periodId: periodo.id, etapa, acao, obs: b.obs ? String(b.obs).trim().slice(0, 300) : null, porId: user.id, por: user.name },
  });
  await auditLog({ userId: user.id, action: `TIP_ETAPA_${acao}`, entity: "TipPeriod", entityId: periodo.code, newValue: { etapa } });
  response.json(await estadoEtapas(periodo.id));
});

// Folha salarial líquidos (lista do banco). Tem salário e PIX: exige a permissão de Funcionários.
tipConferenciaRouter.get("/periods/:year/:month/folha-liquidos", async (request, response) => {
  if (!(await podeVerDadosPessoais(request))) {
    return response.status(403).json({ message: "A folha de líquidos tem salários e PIX: exige permissão de ver Funcionários." });
  }
  const periodo = await periodoDe(request, response);
  if (!periodo) return;
  const [pessoas, extratos, etapas] = await Promise.all([
    pessoasApuradas(periodo.competenceYear, periodo.competenceMonth, true),
    extratosDoPeriodo(periodo.id),
    estadoEtapas(periodo.id),
  ]);
  const linhas = montarFolhaLiquidos(pessoas, extratos.map((e) => e.dados), await combinadosDe(extratos));
  const combinados = await prisma.employee.findMany({
    where: { salarioCombinado: { not: null }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, displayName: true, salarioCombinado: true, salarioCombinadoMotivo: true },
  });
  response.json({
    code: periodo.code, label: periodo.label, linhas,
    total: Math.round(linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100,
    extratos: extratos.map((e) => e.meta.empresa),
    etapas,
    salariosCombinados: combinados.map((c) => ({
      employeeId: c.id, nome: (c.displayName || `${c.firstName} ${c.lastName}`).trim(),
      valor: Number(c.salarioCombinado), motivo: c.salarioCombinadoMotivo,
    })),
  });
});

// Salário combinado de uma pessoa (null tira). Dado sensível: exige a permissão de Funcionários.
tipConferenciaRouter.put("/team/:employeeId/salario-combinado", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: "Exige permissão de ver Funcionários." });
  const b = request.body as { valor?: unknown; motivo?: unknown };
  const valor = b.valor == null || b.valor === "" ? null : Number(b.valor);
  if (valor != null && (!Number.isFinite(valor) || valor <= 0 || valor > 100000)) return response.status(422).json({ message: "Salário combinado inválido." });
  const motivo = b.motivo ? String(b.motivo).trim().slice(0, 300) : null;
  if (valor != null && (!motivo || motivo.length < 5)) return response.status(422).json({ message: "Explique o salário combinado (pelo menos 5 letras)." });
  const antes = await prisma.employee.findFirst({ where: { id: request.params.employeeId, deletedAt: null }, select: { id: true, salarioCombinado: true, salarioCombinadoMotivo: true } });
  if (!antes) return response.status(404).json({ message: "Funcionário não encontrado." });
  await prisma.employee.update({ where: { id: antes.id }, data: { salarioCombinado: valor, salarioCombinadoMotivo: valor == null ? null : motivo, updatedById: user.id } });
  await auditLog({
    userId: user.id, action: "UPDATE_SALARIO_COMBINADO", entity: "Employee", entityId: antes.id,
    previousValue: { valor: antes.salarioCombinado == null ? null : Number(antes.salarioCombinado), motivo: antes.salarioCombinadoMotivo },
    newValue: { valor, motivo }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// Confirmar (ou recusar) que a pessoa do extrato, achada pelo nome, é quem o cadastro diz.
tipConferenciaRouter.put("/periods/:year/:month/extratos/:id/vinculo", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodo = await periodoDe(request, response);
  if (!periodo) return;
  if ((await estadoEtapas(periodo.id)).estado.OK_CONTABILIDADE.marcada) {
    return response.status(409).json({ message: "O OK à contabilidade já foi dado. Desmarque o OK para mudar a conferência." });
  }
  const b = request.body as { nome?: unknown; confirma?: unknown };
  const nome = String(b.nome ?? "");
  const extrato = await prisma.tipExtrato.findFirst({ where: { id: request.params.id, periodId: periodo.id } });
  if (!extrato) return response.status(404).json({ message: "Extrato não encontrado." });
  const linhas = extrato.linhas as LinhaExtrato[];
  const alvo = linhas.find((l) => l.nome === nome && l.vinculo === "NOME");
  if (!alvo) return response.status(404).json({ message: "Não há vínculo a confirmar para essa pessoa." });
  const confirma = b.confirma !== false;
  const novas = linhas.map((l) => (l === alvo
    ? (confirma ? { ...l, vinculo: "CONFIRMADO" as const } : { ...l, employeeId: null, vinculo: undefined })
    : l));
  await prisma.tipExtrato.update({ where: { id: extrato.id }, data: { linhas: novas } });
  await auditLog({
    userId: user.id, action: confirma ? "TIP_EXTRATO_VINCULO_CONFIRMADO" : "TIP_EXTRATO_VINCULO_RECUSADO", entity: "TipPeriod",
    entityId: periodo.code, newValue: { empresa: extrato.empresa, nome, employeeId: confirma ? alvo.employeeId : null },
  });
  response.json(await montarConferencia(periodo));
});
