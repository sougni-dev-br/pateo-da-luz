import { Router } from "express";
import { prisma } from "../../config/database.js";
import { requireMenuPermission } from "../security/security-utils.js";
import { validarConversaoManual } from "../../shared/unidades/conversao-manual.js";
import { aplicarUmaConversao, carregarProdutosParaConversao } from "../products/conversao-automatica.service.js";
import { montarPendencias } from "./conversoes-pendentes.js";

// Aba do estoquista: o que falta converter e o cadastro da conversão na hora. Quem tem acesso a Requisições
// vê e cadastra; o fator passa por validarConversaoManual e a conversão entra na auditoria.
export const conversoesPendentesRouter = Router();

conversoesPendentesRouter.get("/", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  const [carregados, estoque, controla] = await Promise.all([
    carregarProdutosParaConversao(),
    prisma.$queryRaw<Array<{ productId: string; currentQuantity: string }>>`SELECT "productId", "currentQuantity"::text AS "currentQuantity" FROM "InventoryStock"`,
    prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Product" WHERE "isActive" = true AND "controlsStock" IS NOT FALSE`
  ]);
  const saldos = new Map(estoque.map((e) => [e.productId, Number(e.currentQuantity)]));
  response.json({ produtos: montarPendencias(carregados, saldos, new Set(controla.map((c) => c.id))) });
});

conversoesPendentesRouter.post("/", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  const productId = String(request.body?.productId ?? "").trim();
  if (!productId) return void response.status(400).json({ message: "Escolha o produto." });

  const [carregado] = await carregarProdutosParaConversao([productId]);
  if (!carregado) return void response.status(404).json({ message: "Produto não encontrado ou inativo." });

  const validada = validarConversaoManual({ fromUnit: request.body?.fromUnit, factor: request.body?.factor }, carregado.contagem, carregado.entrada.cadastradas);
  if (!validada.ok) return void response.status(validada.conflito ? 409 : 400).json({ message: validada.erro });
  const { fromUnit, toUnit, factor, jaCadastrada } = validada.valor;
  if (jaCadastrada) return void response.status(200).json({ criada: false, comprasConvertidas: 0, comprasEmPeriodoFechado: 0, conversao: { fromUnit, toUnit, factor } });

  const aplicada = await aplicarUmaConversao({
    productId,
    nome: carregado.nome,
    fromUnit,
    toUnit,
    factor,
    motivo: `Manual (estoquista): 1 ${fromUnit} = ${factor.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} ${toUnit}.`,
    origem: "MANUAL",
    userId: user.id
  });
  response.status(201).json({ ...aplicada, conversao: { fromUnit, toUnit, factor } });
});
