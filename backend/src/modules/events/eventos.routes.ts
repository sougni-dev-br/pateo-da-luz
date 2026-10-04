import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { parseBody } from "../../shared/validate-body.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { chaveDoEvento, nomeDaSerie } from "./eventos-nome.js";
import { preverAlmoco } from "./eventos-previsao.js";
import { agendaDoMes, eventosPorData, fichaDaSerie, historicoParaPrevisao, limites, listaDeSeries } from "./eventos.service.js";

// Painel de eventos: o histórico dos eventos que trazem gente ao restaurante e a decisão
// de cada dia (modalidade, preço do buffet, comentário). O faturamento não é digitado:
// vem do PDV, ou do histórico da planilha para antes do PDV.
export const eventsRouter = Router();

const ORIGENS = ["CENTRO_CONVENCOES", "TEATRO", "GRUPO"] as const;
const AREAS = ["SAUDE", "CORPORATIVO", "TECNOLOGIA", "JURIDICO", "FINANCEIRO", "FEIRA_VAREJO", "EDUCACAO", "ENTRETENIMENTO", "OUTRO"] as const;
const MODALIDADES = ["BUFFET", "BUFFET_EXECUTIVO", "A_LA_CARTE"] as const;
/** Palavras que metade dos eventos tem: sozinhas não fazem dois nomes serem o mesmo evento. */
const GENERICAS = new Set(["BRASIL", "BRASILEIRO", "CONGRESSO", "INTERNACIONAL", "PAULISTA", "NACIONAL", "FORUM", "EXPO", "ENCONTRO", "SEMINARIO", "SIMPOSIO", "JORNADA", "SUMMIT", "FEIRA", "EVENTO", "AREA", "MEDICA", "SAO", "PAULO"]);
/** Um evento do centro de convenções não passa de uma semana; evita criar 300 dias por engano de data. */
const MAXIMO_DIAS_EDICAO = 10;

// Ano fora de 2000–2100 é erro de digitação e o Postgres recusaria parte deles.
function dataReal(s: string) {
  const t = Date.parse(`${s}T00:00:00Z`);
  const ano = Number(s.slice(0, 4));
  return !Number.isNaN(t) && ano >= 2000 && ano <= 2100 && new Date(t).toISOString().slice(0, 10) === s;
}
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida").refine(dataReal, "data inválida");
const textoOpcional = (max: number) => z.string().trim().max(max, "texto muito longo").nullable().optional()
  .transform((s) => (s ? s : null));
const horario = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horário inválido (use 08:30)").nullable().optional();

/** O servidor roda em UTC; o dia da operação é o de São Paulo. */
const hojeEmSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const ehDuplicado = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const dataUtc = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const diasEntre = (inicio: string, fim: string) => Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000) + 1;

function datasEntre(inicio: string, fim: string): string[] {
  const datas: string[] = [];
  for (let t = Date.parse(`${inicio}T00:00:00Z`); t <= Date.parse(`${fim}T00:00:00Z`); t += 86400000) datas.push(new Date(t).toISOString().slice(0, 10));
  return datas;
}

// ── Agenda ──

eventsRouter.get("/agenda", async (request, response) => {
  const ano = Number(request.query.year);
  const mes = Number(request.query.month);
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return response.status(400).json({ message: "Informe o mês (year e month)." });
  }
  response.json(await agendaDoMes(prisma, ano, mes));
});

// ── Decisão do dia ──

const decisaoSchema = z.object({
  serviceMode: z.enum(MODALIDADES).nullable().optional(),
  buffetPrice: z.coerce.number().min(0, "preço inválido").max(1000, "preço inválido").nullable().optional(),
  notes: textoOpcional(4000),
});

eventsRouter.put("/days/:date", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const date = request.params.date;
  if (!data.safeParse(date).success) return response.status(400).json({ message: "Data inválida." });
  const dados = parseBody(decisaoSchema, request.body, response);
  if (!dados) return;

  // A previsão fica congelada no momento da decisão: depois dá para medir o acerto. Dia que já
  // passou não congela: a "previsão" de agora usaria um histórico que na época não existia.
  const jaPassou = date < hojeEmSaoPaulo();
  const [eventos, historico, lim] = jaPassou ? [new Map(), [], null] : await Promise.all([eventosPorData(prisma, date, date), historicoParaPrevisao(prisma, date), limites(prisma)]);
  const previsao = lim ? preverAlmoco({ date, eventos: eventos.get(date) ?? [] }, historico, lim) : null;
  const anterior = await prisma.operationDay.findUnique({ where: { date: dataUtc(date) } });
  const gravar = {
    serviceMode: dados.serviceMode ?? null,
    buffetPrice: dados.buffetPrice ?? null,
    notes: dados.notes,
    updatedById: user.id,
    // Só congela na primeira decisão com previsão; editar o comentário depois não muda a aposta feita.
    ...(anterior?.forecastLunch == null && previsao
      ? { forecastLunch: previsao.almoco, forecastSize: previsao.tamanho, forecastBasis: previsao.base }
      : {}),
  };
  const salvo = await prisma.operationDay.upsert({ where: { date: dataUtc(date) }, create: { date: dataUtc(date), ...gravar }, update: gravar });
  await auditLog({ userId: user.id, action: "UPDATE_OPERATION_DAY", entity: "OperationDay", entityId: salvo.id, previousValue: anterior, newValue: salvo, ...auditMeta(request) });
  response.json({ ...salvo, date, buffetPrice: salvo.buffetPrice === null ? null : Number(salvo.buffetPrice) });
});

// ── Séries (a ficha do evento) ──

eventsRouter.get("/series", async (_request, response) => {
  response.json(await listaDeSeries(prisma));
});

/** Sugestões de série para um nome digitado da circular. */
eventsRouter.get("/series-match", async (request, response) => {
  const nome = String(request.query.name ?? "").trim().slice(0, 200);
  if (nome.length < 3) return response.json([]);
  const chave = chaveDoEvento(nome);
  const palavras = new Set(chave.split(" ").filter((p) => p.length >= 3 && !GENERICAS.has(p)));
  const series = await prisma.eventSeries.findMany({ select: { id: true, name: true, nameKey: true, aliasKeys: true, origin: true } });
  const pontuadas = series.map((s) => {
    if (s.nameKey === chave || s.aliasKeys.includes(chave)) return { s, pontos: 100 };
    const delas = s.nameKey.split(" ").filter((p) => !GENERICAS.has(p));
    const comuns = delas.filter((p) => palavras.has(p)).length;
    return { s, pontos: palavras.size ? Math.round((comuns / Math.max(palavras.size, delas.length)) * 100) : 0 };
  });
  response.json(pontuadas.filter((p) => p.pontos >= 34).sort((a, b) => b.pontos - a.pontos).slice(0, 5)
    .map(({ s, pontos }) => ({ id: s.id, name: s.name, origin: s.origin, exato: pontos === 100 })));
});

eventsRouter.get("/series/:id", async (request, response) => {
  const ficha = await fichaDaSerie(prisma, request.params.id);
  if (!ficha) return response.status(404).json({ message: "Evento não encontrado." });
  response.json(ficha);
});

const serieSchema = z.object({
  name: z.string().trim().min(2, "nome obrigatório").max(160, "nome muito longo"),
  origin: z.enum(ORIGENS),
  area: z.enum(AREAS),
  organizer: textoOpcional(160),
  notes: textoOpcional(4000),
});

eventsRouter.put("/series/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const anterior = await prisma.eventSeries.findUnique({ where: { id: request.params.id } });
  if (!anterior) return response.status(404).json({ message: "Evento não encontrado." });
  const dados = parseBody(serieSchema, request.body, response);
  if (!dados) return;
  // Renomear não troca a chave: a importação continua reconhecendo o nome da planilha.
  const salvo = await prisma.eventSeries.update({ where: { id: anterior.id }, data: dados });
  await auditLog({ userId: user.id, action: "UPDATE_EVENT_SERIES", entity: "EventSeries", entityId: salvo.id, previousValue: anterior, newValue: salvo, ...auditMeta(request) });
  response.json(salvo);
});

/** Juntar: duas séries que são o mesmo evento escrito de jeitos diferentes. */
eventsRouter.post("/series/:id/merge", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const dados = parseBody(z.object({ intoId: z.string().trim().min(1, "escolha o evento de destino") }), request.body, response);
  if (!dados) return;
  if (dados.intoId === request.params.id) return response.status(400).json({ message: "Escolha outro evento para juntar." });
  const [origem, destino] = await Promise.all([
    prisma.eventSeries.findUnique({ where: { id: request.params.id }, include: { editions: { select: { id: true, startDate: true } } } }),
    prisma.eventSeries.findUnique({ where: { id: dados.intoId }, include: { editions: { select: { startDate: true } } } }),
  ]);
  if (!origem || !destino) return response.status(404).json({ message: "Evento não encontrado." });
  const conflito = origem.editions.find((e) => destino.editions.some((d) => iso(d.startDate) === iso(e.startDate)));
  if (conflito) {
    return response.status(409).json({ message: `Os dois têm uma edição começando em ${iso(conflito.startDate).split("-").reverse().join("/")}. Apague a repetida antes de juntar.` });
  }
  // O que se sabia do evento absorvido não se perde: organizador e área entram onde o destino
  // está vazio, e as anotações das duas fichas ficam juntas.
  const notas = [destino.notes, origem.notes].filter(Boolean).join("\n\n") || null;
  try {
    await prisma.$transaction([
      prisma.eventEdition.updateMany({ where: { seriesId: origem.id }, data: { seriesId: destino.id } }),
      prisma.eventSeries.update({
        where: { id: destino.id },
        data: {
          aliasKeys: [...new Set([...destino.aliasKeys, origem.nameKey, ...origem.aliasKeys])],
          organizer: destino.organizer ?? origem.organizer,
          area: destino.area === "OUTRO" ? origem.area : destino.area,
          notes: notas,
        },
      }),
      prisma.eventSeries.delete({ where: { id: origem.id } }),
    ]);
  } catch (e) {
    if (ehDuplicado(e)) return response.status(409).json({ message: "Alguém lançou uma edição nesses eventos agora mesmo. Recarregue e tente de novo." });
    throw e;
  }
  await auditLog({ userId: user.id, action: "MERGE_EVENT_SERIES", entity: "EventSeries", entityId: destino.id, previousValue: { absorvida: origem.name, id: origem.id }, newValue: { em: destino.name }, ...auditMeta(request) });
  response.json({ ok: true, id: destino.id });
});

// ── Edições (o que vem na circular) ──

const edicaoSchema = z.object({
  seriesId: z.string().trim().min(1).nullable().optional(),
  newSeriesName: z.string().trim().max(160, "nome muito longo").nullable().optional(),
  newSeriesOrigin: z.enum(ORIGENS).optional(),
  title: z.string().trim().min(2, "nome da edição obrigatório").max(200, "nome muito longo"),
  startDate: data,
  endDate: data,
  announcedAudience: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  floor: textoOpcional(60),
  contact: textoOpcional(200),
  notes: textoOpcional(4000),
}).refine((e) => e.endDate >= e.startDate, { message: "o fim é antes do início", path: ["endDate"] })
  .refine((e) => diasEntre(e.startDate, e.endDate) <= MAXIMO_DIAS_EDICAO, { message: `no máximo ${MAXIMO_DIAS_EDICAO} dias`, path: ["endDate"] });

eventsRouter.post("/editions", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const dados = parseBody(edicaoSchema, request.body, response);
  if (!dados) return;

  let seriesId = dados.seriesId ?? null;
  if (!seriesId) {
    const nome = nomeDaSerie(dados.newSeriesName || dados.title);
    const chave = chaveDoEvento(nome);
    if (!chave) return response.status(400).json({ message: "Nome do evento inválido." });
    const existente = await prisma.eventSeries.findFirst({ where: { OR: [{ nameKey: chave }, { aliasKeys: { has: chave } }] } });
    if (existente) seriesId = existente.id;
    else {
      try {
        seriesId = (await prisma.eventSeries.create({ data: { name: nome, nameKey: chave, origin: dados.newSeriesOrigin ?? "CENTRO_CONVENCOES" } })).id;
      } catch (e) {
        // Duas pessoas lançando o mesmo evento novo ao mesmo tempo: fica a série que chegou primeiro.
        if (!ehDuplicado(e)) throw e;
        seriesId = (await prisma.eventSeries.findUnique({ where: { nameKey: chave } }))!.id;
      }
    }
  } else if (!(await prisma.eventSeries.findUnique({ where: { id: seriesId } }))) {
    return response.status(404).json({ message: "Evento não encontrado." });
  }

  try {
    const criada = await prisma.eventEdition.create({
      data: {
        seriesId,
        title: dados.title,
        startDate: dataUtc(dados.startDate),
        endDate: dataUtc(dados.endDate),
        announcedAudience: dados.announcedAudience ?? null,
        floor: dados.floor,
        contact: dados.contact,
        notes: dados.notes,
        source: "CIRCULAR",
        days: { create: datasEntre(dados.startDate, dados.endDate).map((d) => ({ date: dataUtc(d) })) },
      },
    });
    await auditLog({ userId: user.id, action: "CREATE_EVENT_EDITION", entity: "EventEdition", entityId: criada.id, newValue: criada, ...auditMeta(request) });
    response.status(201).json({ id: criada.id, seriesId });
  } catch (e) {
    if (ehDuplicado(e)) {
      return response.status(409).json({ message: "Esse evento já tem uma edição começando nessa data." });
    }
    throw e;
  }
});

const edicaoEditarSchema = z.object({
  title: z.string().trim().min(2, "nome da edição obrigatório").max(200, "nome muito longo"),
  announcedAudience: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  floor: textoOpcional(60),
  contact: textoOpcional(200),
  notes: textoOpcional(4000),
  days: z.array(z.object({ date: data, startTime: horario, endTime: horario })).max(MAXIMO_DIAS_EDICAO).optional(),
});

eventsRouter.put("/editions/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const anterior = await prisma.eventEdition.findUnique({ where: { id: request.params.id }, include: { days: true } });
  if (!anterior) return response.status(404).json({ message: "Edição não encontrada." });
  const dados = parseBody(edicaoEditarSchema, request.body, response);
  if (!dados) return;
  const { days, ...campos } = dados;
  const diasDaEdicao = new Set(anterior.days.map((d) => iso(d.date)));
  const fora = days?.find((d) => !diasDaEdicao.has(d.date));
  if (fora) return response.status(400).json({ message: `O dia ${fora.date.split("-").reverse().join("/")} não é desta edição.` });

  await prisma.$transaction([
    prisma.eventEdition.update({ where: { id: anterior.id }, data: { ...campos, announcedAudience: campos.announcedAudience ?? null } }),
    ...(days ?? []).map((d) => prisma.eventEditionDay.update({
      where: { editionId_date: { editionId: anterior.id, date: dataUtc(d.date) } },
      data: { startTime: d.startTime ?? null, endTime: d.endTime ?? null },
    })),
  ]);
  await auditLog({ userId: user.id, action: "UPDATE_EVENT_EDITION", entity: "EventEdition", entityId: anterior.id, previousValue: anterior, newValue: dados, ...auditMeta(request) });
  response.json({ ok: true });
});

eventsRouter.delete("/editions/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const anterior = await prisma.eventEdition.findUnique({ where: { id: request.params.id }, include: { days: true } });
  if (!anterior) return response.status(404).json({ message: "Edição não encontrada." });
  // O dia do restaurante (faturamento, comentário) não é apagado: ele não é do evento.
  await prisma.eventEdition.delete({ where: { id: anterior.id } });
  await auditLog({ userId: user.id, action: "DELETE_EVENT_EDITION", entity: "EventEdition", entityId: anterior.id, previousValue: anterior, ...auditMeta(request) });
  response.json({ ok: true });
});

// ── Configuração ──

eventsRouter.get("/settings", async (_request, response) => {
  response.json(await limites(prisma));
});

const configSchema = z.object({
  smallMaxLunch: z.coerce.number().int().min(1).max(2000),
  largeMinLunch: z.coerce.number().int().min(1).max(2000),
  lunchCapacity: z.coerce.number().int().min(1).max(5000).nullable().optional(),
}).refine((c) => c.largeMinLunch > c.smallMaxLunch, { message: "o limite do Grande tem de ser maior que o do Pequeno", path: ["largeMinLunch"] });

eventsRouter.put("/settings", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const dados = parseBody(configSchema, request.body, response);
  if (!dados) return;
  const anterior = await prisma.eventSettings.findUnique({ where: { id: "singleton" } });
  const gravar = { ...dados, lunchCapacity: dados.lunchCapacity ?? null };
  const salvo = await prisma.eventSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...gravar }, update: gravar });
  await auditLog({ userId: user.id, action: "UPDATE_EVENT_SETTINGS", entity: "EventSettings", entityId: "singleton", previousValue: anterior, newValue: salvo, ...auditMeta(request) });
  response.json(salvo);
});
