import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { chaveDoNome, validarPratoNovo } from "../waste/waste-ficha.js";
import { MAX_PRATOS_NO_CUSTO, custoVisivel, custosDosPratos, semValores } from "./buffet-costs.service.js";
import { parseCorpo } from "./validacao.js";

// Ligação dos pratos das plaquinhas às fichas técnicas (custo por kg na pesagem do buffet).
// Fica sob /buffet-plates, então usa a mesma permissão das plaquinhas.
export const buffetCostsRouter = Router();

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const MAX_BUSCA = 10;

/** Lançada dentro da transação para desfazer a ficha recém-criada quando outro pedido ligou o prato primeiro. */
class PratoJaLigado extends Error {}

const linkSchema = z.object({ dishId: z.string().trim().min(1, "informe a ficha").nullable() });

// Custo por kg dos pratos pedidos (ids separados por vírgula): a tela mostra o estado da ficha de cada prato do dia.
buffetCostsRouter.get("/item-costs", async (request, response) => {
  const ids = String(request.query.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_PRATOS_NO_CUSTO);
  const [custos, verCusto] = await Promise.all([custosDosPratos(ids), custoVisivel(request)]);
  response.json(Object.fromEntries([...custos].map(([id, c]) => [id, verCusto ? c : semValores(c)])));
});

// Busca de ficha para ligar ao prato: fichas ativas e as preparações de buffet que aguardam montagem.
buffetCostsRouter.get("/dish-search", async (request, response) => {
  const q = String(request.query.q ?? "").trim().slice(0, 80);
  if (q.length < 2) return response.json([]);
  const pratos = await prisma.dish.findMany({
    where: { AND: [{ OR: [{ isActive: true }, { fichaDeBuffet: true }] }, { name: { contains: q, mode: "insensitive" } }] },
    select: { id: true, name: true, yieldUnit: true, fichaPendente: true, fichaDeProducao: true },
    orderBy: { name: "asc" },
    take: MAX_BUSCA,
  });
  response.json(pratos.map((p) => ({ id: p.id, name: p.name, unit: p.yieldUnit, pending: p.fichaPendente, production: p.fichaDeProducao })));
});

// Liga (ou desliga, com dishId nulo) o prato da plaquinha a uma ficha técnica.
buffetCostsRouter.put("/items/:id/dish", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const data = parseCorpo(linkSchema, request.body, response);
  if (!data) return;
  const item = await prisma.buffetPlateItem.findUnique({ where: { id: request.params.id }, select: { id: true, namePt: true, dishId: true } });
  if (!item) return response.status(404).json({ message: "Prato não encontrado." });
  if (data.dishId) {
    const ficha = await prisma.dish.findUnique({ where: { id: data.dishId }, select: { id: true } });
    if (!ficha) return response.status(400).json({ message: "Ficha técnica não encontrada." });
  }
  const updated = await prisma.buffetPlateItem.update({ where: { id: item.id }, data: { dishId: data.dishId }, select: { id: true, dishId: true } });
  await auditLog({ userId: user.id, action: "LINK_BUFFET_PLATE_DISH", entity: "BuffetPlateItem", entityId: item.id, previousValue: { dishId: item.dishId }, newValue: { dishId: updated.dishId }, ...auditMeta(request) });
  response.json(updated);
});

// Prato sem ficha: cria a preparação de buffet (inativa, rende em kg, aguardando montagem) e já liga.
// Se já existe ficha com o mesmo nome, liga a ela em vez de duplicar.
buffetCostsRouter.post("/items/:id/dish/pending", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const item = await prisma.buffetPlateItem.findUnique({ where: { id: request.params.id }, select: { id: true, namePt: true, dishId: true } });
  if (!item) return response.status(404).json({ message: "Prato não encontrado." });
  if (item.dishId) return response.status(400).json({ message: "Este prato já tem ficha ligada." });

  const validado = validarPratoNovo({ name: item.namePt, unit: "KG" });
  if (!validado.ok) return response.status(400).json({ message: validado.erro });

  const chave = chaveDoNome(item.namePt);
  // Tudo numa transação com trava por nome: dois cliques (ou duas pessoas) no mesmo prato não criam duas fichas, e o
  // segundo encontra o vínculo já feito. A trava vale até o fim da transação.
  const resultado = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`buffet-ficha:${chave}`}))`;
    const atual = await tx.buffetPlateItem.findUnique({ where: { id: item.id }, select: { dishId: true } });
    if (atual?.dishId) return { conflito: true as const };

    // Fichas de mesmo nome (sem acento ou caixa): prefere a de buffet, depois a ativa; desempate fixo pelo id.
    const candidatas = (await tx.dish.findMany({ select: { id: true, name: true, fichaDeBuffet: true, isActive: true } }))
      .filter((d) => chaveDoNome(d.name) === chave)
      .sort((a, b) => Number(b.fichaDeBuffet) - Number(a.fichaDeBuffet) || Number(b.isActive) - Number(a.isActive) || a.id.localeCompare(b.id));
    const igual = candidatas[0];
    let id: string;
    let nome: string;
    if (igual) {
      id = igual.id;
      nome = igual.name;
    } else {
      const criado = await tx.dish.create({
        data: {
          name: validado.valor.name, yieldQty: 1, yieldUnit: "KG", isActive: false, fichaDeBuffet: true, fichaPendente: true,
          pendenteDesde: new Date(), pendentePorId: user.id, pendenteObservacao: "Criada pela pesagem do buffet",
        },
        select: { id: true, name: true },
      });
      id = criado.id;
      nome = criado.name;
    }
    const ligou = await tx.buffetPlateItem.updateMany({ where: { id: item.id, dishId: null }, data: { dishId: id } });
    if (ligou.count === 0) throw new PratoJaLigado();
    return { conflito: false as const, dishId: id, dishName: nome, reutilizada: Boolean(igual) };
  }).catch((e: unknown) => {
    if (e instanceof PratoJaLigado) return { conflito: true as const };
    throw e;
  });
  if (resultado.conflito) return response.status(409).json({ message: "Este prato já tem ficha ligada (outra pessoa acabou de ligar)." });

  const { dishId, dishName, reutilizada } = resultado;
  if (!reutilizada) {
    await auditLog({ userId: user.id, action: "CREATE_PENDING_DISH", entity: "Dish", entityId: dishId, newValue: { name: validado.valor.name, unit: "KG", origem: "pesagem do buffet" }, ...auditMeta(request) });
  }
  await auditLog({ userId: user.id, action: "LINK_BUFFET_PLATE_DISH", entity: "BuffetPlateItem", entityId: item.id, previousValue: { dishId: null }, newValue: { dishId }, ...auditMeta(request) });
  response.status(reutilizada ? 200 : 201).json({ dishId, dishName, reused: reutilizada });
});
