// Rotas da Folha da Gorjeta (Comissão) — Fase A.
// Registrada em app.ts como:  app.use("/payroll/tip", tipCommissionRouter);

import { destinoSobraValido } from "./tip-rateio.js";
import crypto from "node:crypto";
import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { closeTipPeriod, ensureTipPeriod, findOverlappingPeriod, getServicePool, getServicePoolByRange, pontosBaseDoCadastro, reopenTipPeriod, syncParticipantsFromCadastro, tipPeriodBounds } from "./tip-commission.service.js";
import { previaSyncCadastro } from "./tip-sync-previa.service.js";
import { limparParticipaDeDesligados } from "./tip-desligados.service.js";
import { contarLancamentosExistentes, extrairTextoPdf, importExtrato, preverImportacao, lerTextoExtrato, onlyDigits, type ImportExtratoResult } from "./rh-extract.service.js";
import { lerDetalhesExtrato } from "./rh-extract-detalhes.js";
import { avisosDoExtrato } from "./rh-extract-store.service.js";
import { rhExtratosRouter } from "./rh-extratos.routes.js";
import { pdfDoCorpo } from "./pdf-corpo.js";
import { tipConferenciaRouter } from "./tip-conferencia.routes.js";
import { sincronizarSalariosCombinados } from "./salario-combinado.service.js";
import { type ResultadoAcertos, lancarAcertosDaLista } from "./acerto-lista.service.js";
import { tipValesRouter } from "./tip-vales.routes.js";
import { tipRecibosRouter } from "./recibo-pagamento.routes.js";
import { nomeCompleto } from "./nomes.js";
import { normalizarHorasDigitadas } from "./hora-extra.js";
import { fmtDay, parseDateUTC, barrouPorFechamento, parseYearMonth, numOrNull, intOrNull, intOrUndefined, textoOuNull, boolOrNull, boolOrUndefined, participantesTravadosPelaRescisao, calcularParaTela } from "./tip-routes-comum.js";
import { tipFuncoesRouter } from "./tip-funcoes.routes.js";
import { tipEquipeRouter } from "./tip-equipe.routes.js";
import { tipReservaRouter } from "./tip-reserva.routes.js";
import { tipRescisaoReciboRouter } from "./tip-rescisao-recibo.routes.js";

export const tipCommissionRouter = Router();
// Envio à contabilidade, conferência dos extratos, etapas e folha de líquidos.
tipCommissionRouter.use(tipConferenciaRouter);
tipCommissionRouter.use(tipValesRouter);
// Recibo do pagamento do mês (lista de pagamento) de quem não tem registro: só leitura.
tipCommissionRouter.use(tipRecibosRouter);
// Extratos do RH guardados (PDF + holerite por pessoa) para consulta e relatórios.
tipCommissionRouter.use(rhExtratosRouter);


tipCommissionRouter.get("/", async (request, response) => {
  const { year, month } = parseYearMonth(request.query as { year?: unknown; month?: unknown });
  const computation = await calcularParaTela(year, month, request);
  response.json(computation);
});

// Pool sugerido do faturamento, sem abrir o período (para pré-visualizar).
tipCommissionRouter.get("/pool", async (request, response) => {
  const { year, month } = parseYearMonth(request.query as { year?: unknown; month?: unknown });
  const { start, end, label } = tipPeriodBounds(year, month);
  const grossPool = await getServicePool(year, month);
  response.json({ year, month, label, periodStart: start, periodEnd: end, grossPool });
});

// ─── Elenco para o rateio ──────────────────────────────────
// A tela da gorjeta so precisa saber quem existe e como se chama. Ate aqui ela
// chamava GET /employees, que devolve a ficha inteira: CPF, RG, PIS, conta
// bancaria, agencia, PIX e salario-base. Isso obrigava quem opera o rateio a ter
// tambem permissao de Funcionarios — ou seja, delegar a gorjeta entregava junto o
// salario de todo mundo.
//
// Vivendo sob /payroll/tip, esta rota responde ao modulo payroll-tips (regra em
// menuFromRequest, que testa /payroll/tip antes de /payroll) e devolve apenas os
// quatro campos que a tela usa. Inativos entram: o rateio do mes inclui quem foi
// desligado no meio dele.
tipCommissionRouter.get("/roster", async (_request, response) => {
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, firstName: true, lastName: true, displayName: true, isActive: true },
    orderBy: [{ isActive: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
  });
  response.json(employees);
});

// ─── Abrir/garantir o período (puxa o pool do Faturamento Salão) ────────────
tipCommissionRouter.post("/periods", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const { year, month } = parseYearMonth(request.body as { year?: unknown; month?: unknown });
  const period = await ensureTipPeriod(year, month, user.id);
  await auditLog({
    userId: user.id, action: "OPEN_TIP_PERIOD", entity: "TipPeriod", entityId: period.id,
    newValue: period, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.status(201).json(period);
});

// Editar pool bruto / % de dedução do período.
tipCommissionRouter.put("/periods/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const periodId = request.params.id;
  if (await barrouPorFechamento(periodId, response, "Alterar o período")) return;
  // Serviço, retenção, datas e pontos mudam o valor de todo mundo: fica no rastro.
  const antesDoPeriodo = await prisma.tipPeriod.findUnique({
    where: { id: periodId },
    select: {
      grossPool: true, servicoFaturamento: true, ajusteServico: true, ajusteServicoMotivo: true, deductionPercent: true,
      pointsTotal: true, periodStart: true, periodEnd: true, diasPadrao: true, reservaPontos: true,
      descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: true, descontaAfastamento: true, proporcionalEntrada: true,
      sobraRescisaoParaSaldo: true, quebraPct: true, destinoSobra: true,
    },
  });
  const gross = numOrNull(b.grossPool);
  const pointsTotalRaw = numOrNull(b.pointsTotal);
  const pointsTotal = pointsTotalRaw == null ? undefined : Math.max(1, Math.round(pointsTotalRaw));

  // ── Datas do período (opcionais). Se enviadas, controla duplicidade e recalcula o total. ──
  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;
  let label: string | undefined;
  let grossFromRange: number | undefined;
  const avisosPeriodo: string[] = [];

  if (b.periodStart != null || b.periodEnd != null) {
    const current = await prisma.tipPeriod.findUnique({ where: { id: periodId } });
    if (!current) return response.status(404).json({ message: "Período não encontrado." });
    const s = b.periodStart != null ? parseDateUTC(b.periodStart) : current.periodStart;
    const e = b.periodEnd != null ? parseDateUTC(b.periodEnd) : current.periodEnd;
    if (!s || !e) return response.status(400).json({ message: "Datas do período inválidas (use AAAA-MM-DD)." });
    if (s.getTime() > e.getTime()) return response.status(422).json({ message: "A data inicial não pode ser posterior à data final." });

    // Controle de duplicidade: não permite sobreposição com outro período.
    const overlap = await findOverlappingPeriod(s, e, periodId);
    if (overlap) {
      return response.status(422).json({
        message: `Este intervalo (${fmtDay(s)}–${fmtDay(e)}) sobrepõe o período "${overlap.label}" (${String(overlap.competenceMonth).padStart(2, "0")}/${overlap.competenceYear}). Para não pagar em duplicidade, ajuste as datas.`,
      });
    }
    // Sobreposicao ja e barrada acima. LACUNA nao era verificada, e ela custa o
    // contrario: sobrepor paga em duplicidade, mas deixar um buraco entre dois
    // periodos faz a taxa de servico daqueles dias NAO entrar em pool nenhum — dinheiro
    // cobrado do cliente que pertence aos funcionarios e que ninguem distribui, sem
    // nada indicando.
    //
    // Avisa em vez de barrar: pode haver motivo para pular dias (periodo em que a
    // gorjeta nao foi rateada), e so quem opera sabe. O aviso vai no retorno para
    // aparecer na tela, junto dos outros.
    const anterior = await prisma.tipPeriod.findFirst({
      where: { id: { not: periodId }, periodEnd: { lt: s } },
      orderBy: { periodEnd: "desc" },
      select: { label: true, periodEnd: true },
    });
    if (anterior) {
      const diaSeguinte = new Date(anterior.periodEnd.getTime() + 24 * 60 * 60 * 1000);
      const diasDeBuraco = Math.round((s.getTime() - diaSeguinte.getTime()) / (24 * 60 * 60 * 1000));
      if (diasDeBuraco > 0) {
        const [servico] = await prisma.$queryRaw<Array<{ v: unknown }>>`
          SELECT COALESCE(SUM("serviceAmount"), 0) AS v FROM "RevenueEntry"
          WHERE "status" = 'ACTIVE' AND "date" >= ${diaSeguinte} AND "date" < ${s}
        `;
        const valor = Number(servico?.v ?? 0);
        avisosPeriodo.push(
          `Ficam ${diasDeBuraco} dia(s) sem periodo de gorjeta entre "${anterior.label}" (termina ${fmtDay(anterior.periodEnd)}) e este (comeca ${fmtDay(s)})` +
          (valor > 0 ? `: R$ ${valor.toFixed(2)} de taxa de servico nao entram em pool nenhum.` : ".")
        );
      }
    }

    periodStart = s;
    periodEnd = e;
    label = `Gorjeta ${fmtDay(s)}–${fmtDay(e)}`;
    // Recalcula o total do Faturamento no novo intervalo, exceto se um total manual foi enviado.
    if (gross == null) {
      const endExclusive = new Date(e.getTime() + 24 * 60 * 60 * 1000);
      grossFromRange = await getServicePoolByRange(s, endExclusive);
    }
  }

  // Serviço arrecadado = faturamento + ajuste. Mudar as datas repuxa o faturamento
  // e mantém o ajuste; o ajuste (com motivo) é o jeito de somar serviço que não
  // passa pelo sistema. "grossPool" direto (legado) vira ajuste sobre o faturamento.
  const atual = await prisma.tipPeriod.findUniqueOrThrow({ where: { id: periodId }, select: { servicoFaturamento: true, ajusteServico: true } });
  const faturamento = grossFromRange ?? Number(atual.servicoFaturamento);
  let ajuste = numOrNull(b.ajusteServico) ?? Number(atual.ajusteServico);
  if (gross != null && b.ajusteServico === undefined) ajuste = gross - faturamento;
  const motivo = b.ajusteServicoMotivo !== undefined ? textoOuNull(b.ajusteServicoMotivo) : undefined;
  if (Math.abs(ajuste) >= 0.005 && motivo === null) {
    return response.status(422).json({ message: "Informe o motivo do ajuste no serviço arrecadado." });
  }
  // Destino da sobra: valor desconhecido é erro, não um "fundo" silencioso (é o que mexe no fundo de reserva).
  if (b.destinoSobra !== undefined && !["FUNDO", "LIVRE", "REDISTRIBUIR"].includes(String(b.destinoSobra))) {
    return response.status(422).json({ message: "Destino da sobra inválido: use FUNDO, LIVRE ou REDISTRIBUIR." });
  }
  const destinoSobraPut = b.destinoSobra === undefined ? undefined : destinoSobraValido(b.destinoSobra);
  // Retenção + quebra não passam de 100% do serviço (o líquido não pode ficar negativo).
  const retencaoFinal = numOrNull(b.deductionPercent) ?? Number(antesDoPeriodo?.deductionPercent ?? 20);
  const quebraFinal = numOrNull(b.quebraPct) == null ? Number(antesDoPeriodo?.quebraPct ?? 0) : Math.min(100, Math.max(0, numOrNull(b.quebraPct) as number));
  if (retencaoFinal < 0 || retencaoFinal + quebraFinal > 100) {
    return response.status(422).json({ message: "A retenção somada à quebra não pode passar de 100% do serviço." });
  }
  const grossFinal = Math.round((faturamento + ajuste) * 100) / 100;
  if (grossFinal < 0) return response.status(422).json({ message: "O serviço arrecadado não pode ficar negativo." });
  const period = await prisma.tipPeriod.update({
    where: { id: periodId },
    data: {
      grossPool: grossFinal,
      servicoFaturamento: faturamento,
      ajusteServico: ajuste,
      ajusteServicoMotivo: Math.abs(ajuste) < 0.005 ? null : motivo,
      poolSource: Math.abs(ajuste) >= 0.005 ? "MANUAL" : "REVENUE",
      deductionPercent: numOrNull(b.deductionPercent) ?? undefined,
      pointsTotal,
      diasPadrao: intOrUndefined(b.diasPadrao, 1, 31),
      descontaFalta: boolOrUndefined(b.descontaFalta),
      descontaAtestado: boolOrUndefined(b.descontaAtestado),
      descontaFerias: boolOrUndefined(b.descontaFerias),
      descontaOutros: boolOrUndefined(b.descontaOutros),
      descontaAfastamento: boolOrUndefined(b.descontaAfastamento),
      proporcionalEntrada: boolOrUndefined(b.proporcionalEntrada),
      sobraRescisaoParaSaldo: boolOrUndefined(b.sobraRescisaoParaSaldo),
      quebraPct: (() => { const n = numOrNull(b.quebraPct); return n == null ? undefined : Math.min(100, Math.max(0, n)); })(),
      destinoSobra: destinoSobraPut,
      reservaPontos: (() => { const n = numOrNull(b.reservaPontos); return n == null ? undefined : Math.max(0, n); })(),
      periodStart,
      periodEnd,
      label,
      updatedById: user.id,
    },
  });
  // O aviso de lacuna viaja junto do periodo para aparecer na tela.
  await auditLog({
    userId: user.id, action: "UPDATE_TIP_PERIOD", entity: "TipPeriod", entityId: periodId,
    previousValue: antesDoPeriodo,
    newValue: {
      grossPool: period.grossPool, servicoFaturamento: period.servicoFaturamento, ajusteServico: period.ajusteServico,
      ajusteServicoMotivo: period.ajusteServicoMotivo, deductionPercent: period.deductionPercent, pointsTotal: period.pointsTotal,
      periodStart: period.periodStart, periodEnd: period.periodEnd, diasPadrao: period.diasPadrao, reservaPontos: period.reservaPontos,
      descontaFalta: period.descontaFalta, descontaAtestado: period.descontaAtestado, descontaFerias: period.descontaFerias, descontaOutros: period.descontaOutros, descontaAfastamento: period.descontaAfastamento,
      proporcionalEntrada: period.proporcionalEntrada, sobraRescisaoParaSaldo: period.sobraRescisaoParaSaldo,
      quebraPct: period.quebraPct, destinoSobra: period.destinoSobra,
    },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json(avisosPeriodo.length > 0 ? { ...period, avisos: avisosPeriodo } : period);
});

// Busca de novo o serviço do faturamento no intervalo do período (ex.: depois de
// importar dias que faltavam). O ajuste manual continua valendo.
tipCommissionRouter.post("/periods/:id/refresh-service", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodId = request.params.id;
  if (await barrouPorFechamento(periodId, response, "Atualizar o serviço")) return;
  const p = await prisma.tipPeriod.findUnique({ where: { id: periodId } });
  if (!p) return response.status(404).json({ message: "Período não encontrado." });
  const faturamento = await getServicePoolByRange(p.periodStart, new Date(p.periodEnd.getTime() + 24 * 60 * 60 * 1000));
  const gross = Math.round((faturamento + Number(p.ajusteServico)) * 100) / 100;
  await prisma.tipPeriod.update({ where: { id: periodId }, data: { servicoFaturamento: faturamento, grossPool: gross, updatedById: user.id } });
  await auditLog({
    userId: user.id, action: "REFRESH_TIP_SERVICE", entity: "TipPeriod", entityId: periodId,
    previousValue: { servicoFaturamento: String(p.servicoFaturamento) }, newValue: { servicoFaturamento: faturamento },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ servicoFaturamento: faturamento, grossPool: gross });
});

// ─── Participantes: upsert em lote (pontos / cota fixa) ─────────────────────
// body: { periodId, participants: [{ employeeId, kind, points?, fixedAmount? }] }
tipCommissionRouter.put("/periods/:id/participants", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodId = request.params.id;
  const list = (request.body as { participants?: unknown }).participants;
  if (!Array.isArray(list)) return response.status(400).json({ message: "participants deve ser uma lista." });

  const periodBefore = await prisma.tipPeriod.findUnique({ where: { id: periodId } });
  if (!periodBefore) return response.status(404).json({ message: "Período não encontrado." });
  if (await barrouPorFechamento(periodId, response, "Alterar os participantes")) return;

  // Pontos-base vêm do cadastro (função + ponto extra) e não se editam aqui:
  // o período só guarda o ajuste do mês. Quem entra pela tela pega a base na hora.
  const novos = (list as Array<Record<string, unknown>>).map((raw) => String(raw.employeeId ?? "")).filter(Boolean);
  const cadastro = await prisma.employee.findMany({
    where: { id: { in: novos } },
    select: { id: true, pontosExtra: true, tipFunction: { select: { points: true } } },
  });
  const basePorFuncionario = new Map(cadastro.map((e) => [e.id, pontosBaseDoCadastro(e)]));

  // Ocorrências e dias são contagens dentro de um período de ~31 dias.
  const CAMPOS_DIAS: Array<[string, string]> = [
    ["faltas", "Faltas"], ["atestados", "Atestados"], ["ferias", "Férias"], ["outrosDias", "Outros dias"],
    ["diasPrevistosOverride", "Dias previstos"], ["diasSalarioOverride", "Dias de salário"],
  ];
  for (const raw of list as Array<Record<string, unknown>>) {
    for (const [campo, rotulo] of CAMPOS_DIAS) {
      const n = numOrNull(raw[campo]);
      if (n != null && (n < 0 || n > 31)) {
        return response.status(422).json({ message: `${rotulo}: ${n} não é possível num período (use de 0 a 31).` });
      }
    }
    const ajuste = numOrNull(raw.pointsAdjustment);
    if (ajuste != null && Math.abs(ajuste) > 100) {
      return response.status(422).json({ message: `Ajuste de pontos ${ajuste} fora do razoável (máximo ±100).` });
    }
    // Hora extra paga na lista de quem não tem registro: grava em h:mm e barra o absurdo.
    for (const [campo, rotulo] of [["horaExtra", "Hora extra"], ["adicionalNoturno", "Adicional noturno"]] as const) {
      const horas = normalizarHorasDigitadas(raw[campo], rotulo);
      if ("erro" in horas) return response.status(422).json({ message: horas.erro });
      raw[campo] = horas.texto;
    }
  }

  // Quem tem a gorjeta paga definida pela rescisão lançada (neste período) não muda
  // esse valor aqui: a rescisão é a fonte — ajuste lá, com justificativa.
  const idsDaLista = (list as Array<Record<string, unknown>>).map((x) => String(x.employeeId ?? ""));
  const travados = await participantesTravadosPelaRescisao(idsDaLista);
  const atuais = await prisma.tipParticipant.findMany({
    where: { periodId, employeeId: { in: idsDaLista } }, select: { id: true, employeeId: true, rescisaoValorFixo: true },
  });
  const gorjetaPelaRescisao = new Set(atuais.filter((p) => travados.has(p.id)).map((p) => p.employeeId));
  for (const raw of list as Array<Record<string, unknown>>) {
    const atual = atuais.find((p) => p.employeeId === String(raw.employeeId ?? ""));
    if (!atual || !gorjetaPelaRescisao.has(atual.employeeId) || raw.rescisaoValorFixo === undefined) continue;
    const novo = numOrNull(raw.rescisaoValorFixo);
    const antes = atual.rescisaoValorFixo == null ? null : Number(atual.rescisaoValorFixo);
    if ((novo == null) !== (antes == null) || (novo != null && antes != null && Math.round(Math.abs(novo - antes) * 100) >= 1)) {
      return response.status(409).json({ message: "Esta gorjeta paga veio da rescisão lançada: ajuste em RH → Rescisões → Ajustar rescisão." });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const raw of list as Array<Record<string, unknown>>) {
      const employeeId = String(raw.employeeId ?? "");
      if (!employeeId || !basePorFuncionario.has(employeeId)) continue;
      const kind = raw.kind === "FIXO" ? "FIXO" : "PONTOS";
      const texto = (v: unknown) => (v != null && String(v).trim() !== "" ? String(v).trim() : null);
      const dados = {
        kind,
        fixedAmount: kind === "FIXO" ? (numOrNull(raw.fixedAmount) ?? 0) : null,
        pointsAdjustment: numOrNull(raw.pointsAdjustment) ?? 0,
        faltas: intOrNull(raw.faltas),
        atestados: intOrNull(raw.atestados),
        ferias: intOrNull(raw.ferias),
        outrosDias: intOrNull(raw.outrosDias),
        diasPrevistosOverride: intOrNull(raw.diasPrevistosOverride),
        diasSalarioOverride: intOrNull(raw.diasSalarioOverride),
        rescisaoServicoBruto: numOrNull(raw.rescisaoServicoBruto),
        rescisaoValorFixo: numOrNull(raw.rescisaoValorFixo),
        // Regra própria da pessoa: true/false decide; null volta para a regra do período.
        descontaFalta: boolOrNull(raw.descontaFalta),
        descontaAtestado: boolOrNull(raw.descontaAtestado),
        descontaFerias: boolOrNull(raw.descontaFerias),
        descontaOutros: boolOrNull(raw.descontaOutros),
        descontaAfastamento: boolOrNull(raw.descontaAfastamento),
        proporcionalEntrada: boolOrNull(raw.proporcionalEntrada),
        horaExtra: texto(raw.horaExtra),
        adicionalNoturno: texto(raw.adicionalNoturno),
        justificada: Boolean(raw.justificada),
      } as const;
      const { rescisaoValorFixo, ...semGorjetaPaga } = dados;
      await tx.tipParticipant.upsert({
        where: { periodId_employeeId: { periodId, employeeId } },
        create: { id: crypto.randomUUID(), periodId, employeeId, basePoints: basePorFuncionario.get(employeeId) ?? 0, ...dados },
        // Sem valor quitado, o recibo lido do TRCT deixa de valer.
        update: gorjetaPelaRescisao.has(employeeId) ? semGorjetaPaga
          : rescisaoValorFixo == null ? { ...dados, rescisaoRecibo: Prisma.DbNull } : dados,
      });
    }
  });

  const period = await prisma.tipPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const computation = await calcularParaTela(period.competenceYear, period.competenceMonth, request);
  response.json(computation);
});

// ─── Extrato Mensal do RH: leitura + conferência (não gera nada, só lê) ──────
// PDF do corpo da requisição (pdfDoCorpo): o arquivo vai para o banco e volta como
// application/pdf — por isso só entra o que começa como PDF e cabe em 5 MB.

tipCommissionRouter.post("/extrato/preview", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as { fileBase64?: unknown };
  const pdf = pdfDoCorpo(b.fileBase64);
  if (!("buffer" in pdf)) return response.status(pdf.status).json({ message: pdf.message });
  let parsed;
  let texto: string;
  try {
    texto = await extrairTextoPdf(pdf.buffer);
    parsed = lerTextoExtrato(texto);
  } catch (err) {
    return response.status(422).json({ message: "Não foi possível ler o PDF do extrato. " + (err as Error).message });
  }
  if (parsed.funcionarios.length === 0) {
    return response.status(422).json({ message: "Nenhum funcionário foi lido do extrato. Confira se o arquivo é o Extrato Mensal do RH." });
  }
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, firstName: true, lastName: true, displayName: true, cpf: true, isActive: true },
  });
  const byCpf = new Map(employees.map((e) => [onlyDigits(e.cpf), e]));
  const items = parsed.funcionarios.map((f) => {
    const emp = f.cpfNorm ? byCpf.get(f.cpfNorm) : undefined;
    return {
      // Só os dois últimos dígitos: bastam para conferir quem é, sem expor o CPF na tela.
      nome: f.nome, cpf: f.cpfNorm ? `•••.•••.•••-${f.cpfNorm.slice(-2)}` : "", liquido: f.liquido, gorjeta: f.gorjeta,
      matched: Boolean(emp),
      employeeId: emp?.id ?? null,
      employeeName: emp ? nomeCompleto(emp) : null,
      isActive: emp?.isActive ?? null,
    };
  });
  const detalhes = lerDetalhesExtrato(texto);
  const lancamentosExistentes = await contarLancamentosExistentes(
    items.flatMap((i) => (i.employeeId ? [{ employeeId: i.employeeId, liquido: i.liquido }] : [])),
    parsed.calculo, parsed.competenceYear, parsed.competenceMonth,
  );
  // O que vai acontecer de fato com cada pessoa (novo, atualizar, líquido zero, desligado…).
  const previsao = await preverImportacao(
    items.map((i) => ({ employeeId: i.employeeId, liquido: i.liquido })), parsed.calculo, parsed.competenceYear, parsed.competenceMonth,
  );
  const avisos = await avisosDoExtrato({
    detalhes, calculo: parsed.calculo, competenceYear: parsed.competenceYear, competenceMonth: parsed.competenceMonth,
    incluirDadosPessoais: await podeVerDadosPessoais(request),
  });
  response.json({
    calculo: parsed.calculo,
    empresa: parsed.empresa, cnpj: parsed.cnpj,
    competenceYear: parsed.competenceYear, competenceMonth: parsed.competenceMonth,
    totalLiquido: Math.round(items.reduce((a, i) => a + i.liquido, 0) * 100) / 100,
    matchedCount: items.filter((i) => i.matched).length,
    items,
    pessoasLidas: detalhes.pessoas.length,
    pessoasConferidas: detalhes.pessoas.filter((p) => p.conferido).length,
    lancamentosExistentes,
    previsao,
    avisos,
  });
});

export function resumoDaImportacao(r: ImportExtratoResult) {
  return {
    rhExtractId: r.rhExtractId, calculo: r.calculo, competenceYear: r.competenceYear, competenceMonth: r.competenceMonth,
    companyId: r.companyId, empresa: r.empresa,
    titulosGerados: r.titulosGerados, titulosNovos: r.titulosNovos, titulosAtualizados: r.titulosAtualizados, titulosPulados: r.titulosPulados,
    excluidosAMao: r.excluidosAMao, zerados: r.zerados, desligados: r.desligados, jaPagos: r.jaPagos, comOutroRotulo: r.comOutroRotulo,
    pessoasLidas: r.pessoasLidas, pessoasConferidas: r.pessoasConferidas, funcionariosCadastrados: r.funcionariosCadastrados,
    extratoAtualizado: r.extratoAtualizado,
  };
}

// Importar o Extrato: gera os salários no Contas a Pagar + rastreabilidade (arquivo).
tipCommissionRouter.post("/extrato/import", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as { fileBase64?: unknown; fileName?: unknown; dueDay?: unknown };
  const pdf = pdfDoCorpo(b.fileBase64);
  if (!("buffer" in pdf)) return response.status(pdf.status).json({ message: pdf.message });
  try {
    const { buffer } = pdf;
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    // O PDF vai para o banco (RhExtract.arquivo). Antes ia para uploads/ no disco,
    // que o Render apaga a cada deploy — o arquivo se perdia.
    const safeName = String(b.fileName ?? "extrato.pdf").replace(/[^\w.\-() ]/g, "_").slice(0, 200);
    const result = await importExtrato({
      buffer, userId: user.id, fileName: safeName, sha256,
      dueDay: numOrNull(b.dueDay) ?? undefined,
      incluirDadosPessoais: await podeVerDadosPessoais(request),
    });
    // Só contadores e ids: a auditoria é lida por quem não vê Funcionários, e os avisos
    // e o total trazem nomes com valores (rescisão, salário divergente).
    await auditLog({
      userId: user.id, action: "IMPORT_RH_EXTRATO", entity: "RhExtract", entityId: result.rhExtractId,
      newValue: resumoDaImportacao(result), ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.status(201).json(result);
  } catch (err) {
    response.status(422).json({ message: (err as Error).message });
  }
});

// Recarregar participantes do cadastro (quem participa da gorjeta, inclusive desligados).
tipCommissionRouter.post("/periods/:id/sync", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodId = request.params.id;
  const period = await prisma.tipPeriod.findUnique({ where: { id: periodId } });
  if (!period) return response.status(404).json({ message: "Período não encontrado." });
  if (await barrouPorFechamento(periodId, response, "Recarregar os participantes")) return;
  const desligadosLimpos = await limparDesligadosAutomatico(request, user, "atualizar-do-cadastro");
  const { added, elegiveis, atualizados, removidos } = await syncParticipantsFromCadastro(periodId);
  const computation = await calcularParaTela(period.competenceYear, period.competenceMonth, request);
  response.json({ added, elegiveis, atualizados, removidos, desligadosLimpos, computation });
});

// Prévia do "Atualizar do cadastro": só leitura. O que mudaria no período, quem está fora do
// rateio e por quê. A tela usa para avisar que o cadastro mudou.
tipCommissionRouter.get("/periods/:id/sync-preview", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const period = await prisma.tipPeriod.findUnique({ where: { id: request.params.id }, select: { id: true, status: true } });
  if (!period) return response.status(404).json({ message: "Período não encontrado." });
  if (period.status === "CLOSED") return response.json({ diferencas: [], foraDoRateio: [], desligadosComParticipaMarcado: 0, desligadosParaLimpar: [] });
  response.json(await previaSyncCadastro(period.id));
});

// Tira "Participa da gorjeta" de quem já saiu e cujo ciclo da saída já fechou. Grava histórico e
// auditoria; o ciclo aberto não é afetado (só entra quem não precisa mais dele).
async function registrarLimpezaDeDesligados(request: Request, user: { id: string }, limpos: Array<{ employeeId: string; nome: string; terminationDate: Date }>, origem: string) {
  if (limpos.length === 0) return;
  await auditLog({
    userId: user.id, action: "CLEAR_TIP_PARTICIPA_DESLIGADOS", entity: "Employee", entityId: limpos.map((l) => l.employeeId).join(","),
    newValue: { origem, pessoas: limpos.map((l) => ({ employeeId: l.employeeId, nome: l.nome, saida: l.terminationDate })) },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
}

// O sistema faz sozinho: ao fechar o mês e ao atualizar do cadastro, quem saiu e já teve o ciclo da
// saída fechado deixa de constar como participante. Uma falha aqui nunca derruba a operação
// principal: fica no log e a pessoa continua aparecendo na limpeza manual.
async function limparDesligadosAutomatico(request: Request, user: { id: string }, origem: string): Promise<string[]> {
  try {
    const limpos = await limparParticipaDeDesligados(user);
    await registrarLimpezaDeDesligados(request, user, limpos, origem);
    return limpos.map((l) => l.nome);
  } catch (err) {
    console.error("[gorjeta] limpeza automática de desligados falhou:", err);
    return [];
  }
}

tipCommissionRouter.post("/periods/:id/limpar-desligados", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const period = await prisma.tipPeriod.findUnique({ where: { id: request.params.id }, select: { id: true } });
  if (!period) return response.status(404).json({ message: "Período não encontrado." });
  if (await barrouPorFechamento(period.id, response, "Limpar o cadastro")) return;
  const ids = (request.body as { employeeIds?: unknown } | undefined)?.employeeIds;
  const employeeIds = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : undefined;
  const limpos = await limparParticipaDeDesligados(user, employeeIds);
  await registrarLimpezaDeDesligados(request, user, limpos, "manual");
  response.json({ limpos: limpos.length, nomes: limpos.map((l) => l.nome) });
});

// Remover um participante do período.
// Gorjeta real no lugar da calculada (valor null tira o ajuste). Os outros não mudam;
// a diferença vai para o livre para distribuir. Justificativa obrigatória e auditoria.
tipCommissionRouter.put("/participants/:id/gorjeta-real", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const p = await prisma.tipParticipant.findUnique({
    where: { id: request.params.id },
    select: {
      id: true, periodId: true, employeeId: true, kind: true, foraDaGorjeta: true, gorjetaReal: true, gorjetaRealMotivo: true,
      period: { select: { competenceYear: true, competenceMonth: true, periodEnd: true } },
      employee: { select: { terminationDate: true } },
    },
  });
  if (!p) return response.status(404).json({ message: "Participante não encontrado." });
  if (await barrouPorFechamento(p.periodId, response, "Mudar a gorjeta de alguém")) return;
  if (p.foraDaGorjeta) return response.status(422).json({ message: "Esta pessoa não participa da gorjeta: está na lista só pelo salário." });
  if (p.kind !== "PONTOS") return response.status(422).json({ message: "Cota fixa já é um valor: mude a cota na própria linha." });
  const saida = p.employee.terminationDate;
  if (saida && saida <= p.period.periodEnd) {
    return response.status(422).json({ message: "Quem saiu no período usa a gorjeta paga em \"Rescisões do período\" (ou na própria rescisão)." });
  }

  const b = request.body as { valor?: unknown; motivo?: unknown };
  const tirar = b.valor == null || b.valor === "";
  const valor = tirar ? null : Number(b.valor);
  if (valor != null && (!Number.isFinite(valor) || valor < 0 || valor > 1_000_000)) {
    return response.status(422).json({ message: "Gorjeta real inválida (use um valor entre 0 e 1.000.000)." });
  }
  const motivo = typeof b.motivo === "string" ? b.motivo.trim().slice(0, 500) : "";
  if (motivo.length < 10) return response.status(422).json({ message: "Explique por que a gorjeta real é outra (pelo menos 10 letras)." });

  await prisma.tipParticipant.update({
    where: { id: p.id },
    data: {
      gorjetaReal: valor == null ? null : Math.round(valor * 100) / 100,
      gorjetaRealMotivo: valor == null ? null : motivo,
      gorjetaRealPor: valor == null ? null : user.name,
      gorjetaRealEm: valor == null ? null : new Date(),
    },
  });
  await auditLog({
    userId: user.id, action: valor == null ? "REMOVE_TIP_GORJETA_REAL" : "SET_TIP_GORJETA_REAL", entity: "TipParticipant", entityId: p.id,
    previousValue: { gorjetaReal: p.gorjetaReal == null ? null : Number(p.gorjetaReal), motivo: p.gorjetaRealMotivo },
    newValue: { gorjetaReal: valor, motivo },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  const computation = await calcularParaTela(p.period.competenceYear, p.period.competenceMonth, request);
  response.json(computation);
});

tipCommissionRouter.delete("/participants/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const participantId = request.params.id;
  // Fotografa antes: sair do rateio muda o valor de todo mundo (o ponto do
  // removido volta para o bolo), e até aqui isso não deixava nenhum registro.
  const antes = await prisma.tipParticipant.findUnique({
    where: { id: participantId },
    select: {
      id: true, periodId: true, employeeId: true, kind: true, points: true,
      fixedAmount: true, netCommission: true,
      employee: { select: { displayName: true, firstName: true, lastName: true } },
    },
  });
  if (!antes) return response.status(404).json({ message: "Participante não encontrado." });
  if (await barrouPorFechamento(antes.periodId, response, "Remover um participante")) return;
  if ((await participantesTravadosPelaRescisao([antes.employeeId])).has(antes.id)) {
    return response.status(409).json({ message: "Esta pessoa tem a rescisão lançada com a gorjeta deste período: exclua a rescisão antes de tirá-la da apuração." });
  }
  await prisma.tipParticipant.delete({ where: { id: participantId } });
  await auditLog({
    userId: user.id, action: "DELETE_TIP_PARTICIPANT", entity: "TipParticipant",
    entityId: participantId,
    previousValue: {
      periodId: antes.periodId,
      funcionario: antes.employee?.displayName || `${antes.employee?.firstName ?? ""} ${antes.employee?.lastName ?? ""}`.trim() || antes.employeeId,
      kind: antes.kind, points: antes.points,
      fixedAmount: antes.fixedAmount == null ? null : String(antes.fixedAmount),
      netCommission: antes.netCommission == null ? null : String(antes.netCommission),
    },
    newValue: null,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// Vales: em tip-vales.routes.ts (lançar, corrigir, cancelar, relatório).

// Depois do fechamento gravado: falha aqui (ex.: mês travado) não desfaz o fechamento,
// vira aviso. Quem não vê Funcionários recebe só quantos salários mudaram. Sincronizar
// grava no SALARIO da Folha: sem a permissão de editar a Folha, fecha sem sincronizar.
async function sincronizarAposFechar(request: Request, year: number, month: number, usuario: { id: string; name: string; role: string }) {
  if (!(await userHasPermission(usuario as SessionUser, "payroll", "edit"))) {
    return {
      atualizados: 0, detalhes: null, erro: null,
      aviso: "Salários combinados não atualizados: exige a permissão de editar a Folha. Quem tiver a permissão atualiza pela Folha de líquidos.",
    };
  }
  try {
    const r = await sincronizarSalariosCombinados(year, month, { id: usuario.id, name: usuario.name });
    return { atualizados: r.alterados.length, detalhes: (await podeVerDadosPessoais(request)) ? r : null, erro: null };
  } catch (err) {
    return { atualizados: 0, detalhes: null, erro: (err as Error).message };
  }
}

// O resultado dos acertos para a tela: nomes e valores só para quem vê Funcionários.
function acertosParaTela(r: ResultadoAcertos, podeVer: boolean) {
  return { criados: r.criados.length, atualizados: r.atualizados.length, detalhes: podeVer ? r : null, avisos: podeVer ? r.avisos : r.avisosSemValor };
}

// Fechado o mês, o acerto de cada sem registro (lista de pagamento) vira título no Contas a
// Pagar. Como a sincronização acima: grava na Folha (exige editar a Folha) e falha não desfaz
// o fechamento — vira aviso.
async function lancarAcertosAposFechar(request: Request, year: number, month: number, usuario: { id: string; name: string; role: string }) {
  if (!(await userHasPermission(usuario as SessionUser, "payroll", "edit"))) {
    return {
      criados: 0, atualizados: 0, detalhes: null, erro: null, avisos: [],
      aviso: "Acertos da lista de pagamento não lançados no Contas a Pagar: exige a permissão de editar a Folha. Quem tiver a permissão lança pela aba Lista de pagamento.",
    };
  }
  try {
    const r = await lancarAcertosDaLista(year, month, { id: usuario.id, name: usuario.name });
    return { ...acertosParaTela(r, await podeVerDadosPessoais(request)), erro: null };
  } catch (err) {
    return { criados: 0, atualizados: 0, detalhes: null, erro: (err as Error).message, avisos: [] };
  }
}

// ─── Fechar o período (recalcula, persiste e trava a conferência) ───────────
tipCommissionRouter.post("/periods/:year/:month/close", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  try {
    const result = await closeTipPeriod(year, month, { id: user.id, name: user.name });
    await auditLog({
      userId: user.id, action: "CLOSE_TIP_PERIOD", entity: "TipPeriod", entityId: result.code ?? `${year}-${month}`,
      newValue: { registro: result.fechamento?.code ?? null, ...result.totals }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    const usuario = { id: user.id, name: user.name, role: user.role };
    // Fechado o mês, o salário de quem tem salário combinado passa ao valor integral.
    const salariosCombinados = await sincronizarAposFechar(request, year, month, usuario);
    // O ciclo que acabou de fechar libera a limpeza de quem saiu nele.
    const desligadosLimpos = await limparDesligadosAutomatico(request, user, "fechamento");
    response.json({ ...result, salariosCombinados, desligadosLimpos, acertosLista: await lancarAcertosAposFechar(request, year, month, usuario) });
  } catch (err) {
    response.status(422).json({ message: (err as Error).message });
  }
});

// ─── Lançar os acertos da lista de pagamento no Contas a Pagar (botão) ─────
// Só com a apuração fechada: com ela aberta os valores são parciais (o mês ainda corre) e
// virariam títulos que alguém pode pagar. O fechamento já lança sozinho; o botão serve para
// atualizar depois (vencimento, valor ainda não pago). Regra do dono, 02/10/2026.
tipCommissionRouter.post("/periods/:year/:month/acertos-lista", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await userHasPermission(user as SessionUser, "payroll", "edit"))) {
    return response.status(403).json({ message: "Lançar os acertos grava na Folha: exige a permissão de editar a Folha." });
  }
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return response.status(400).json({ message: "Competência inválida." });
  }
  const periodo = await prisma.tipPeriod.findUnique({
    where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } }, select: { status: true },
  });
  if (!periodo) {
    return response.status(409).json({ message: `Não há apuração de ${String(month).padStart(2, "0")}/${year}: abra e feche o período antes de lançar os acertos.` });
  }
  if (periodo.status !== "CLOSED") {
    return response.status(409).json({
      message: `A apuração de ${String(month).padStart(2, "0")}/${year} ainda está aberta: feche a apuração antes de lançar os acertos (o fechamento já lança).`,
    });
  }
  try {
    const r = await lancarAcertosDaLista(year, month, { id: user.id, name: user.name });
    const tela = acertosParaTela(r, await podeVerDadosPessoais(request));
    response.json({ criados: tela.criados, atualizados: tela.atualizados, semMudanca: r.semMudanca, detalhes: tela.detalhes, avisos: tela.avisos });
  } catch (err) {
    response.status(409).json({ message: (err as Error).message });
  }
});

// ─── Reabrir um período fechado (correções de RH/rateio; exige novo fechamento) ──
tipCommissionRouter.post("/periods/:year/:month/reopen", async (request, response) => {
  // Reabrir é ação sensível (destrava um período selado) → continua restrita, mas por
  // PERMISSÃO e não por cargo: exige a ação "Administrar" em Fechamento de Gorjetas.
  // O ADMIN sempre a possui; assim o dono delega sem precisar promover ninguém a ADMIN.
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await userHasPermission(user as SessionUser, "payroll-tips", "admin"))) {
    return response.status(403).json({ message: "Usuário sem permissão para reabrir um período fechado." });
  }
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  try {
    const motivo = String((request.body as { motivo?: unknown } | undefined)?.motivo ?? "");
    const result = await reopenTipPeriod(year, month, { id: user.id, name: user.name }, motivo);
    await auditLog({
      userId: user.id, action: "REOPEN_TIP_PERIOD", entity: "TipPeriod", entityId: result.code ?? `${year}-${month}`,
      newValue: { competenceYear: year, competenceMonth: month, motivo }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.json(result);
  } catch (err) {
    response.status(422).json({ message: (err as Error).message });
  }
});


// Tabela de funções, equipe, fundo de reserva, registro dos fechamentos e recibo da rescisão
// moram em arquivos próprios (caminhos distintos, a ordem não muda nada).
tipCommissionRouter.use(tipFuncoesRouter);
tipCommissionRouter.use(tipEquipeRouter);
tipCommissionRouter.use(tipReservaRouter);
tipCommissionRouter.use(tipRescisaoReciboRouter);
