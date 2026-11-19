import { Router } from "express";
import { z } from "zod";
import { custoVisivel } from "./buffet-costs.service.js";
import { KINDS, analiseDoBuffet } from "./buffet-analysis.service.js";
import { isRealDate, todayInSaoPaulo } from "./buffet-prints.routes.js";
import { addDays } from "./buffet-usage.js";
import { parseCorpo } from "./validacao.js";

// Análise do buffet: o que a pesagem mostra por dia e por prato. Sob /buffet-plates, com a permissão das plaquinhas;
// valores em R$ só para quem tem "inventory-costs".
export const buffetAnalysisRouter = Router();

const PERIODO_PADRAO_DIAS = 30;
const MAX_DIAS = 366;

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida").refine(isRealDate, "data inválida");
const consultaSchema = z.object({
  from: dia.optional(),
  to: dia.optional(),
  kind: z.enum(KINDS).default("BUFFET"),
});

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

buffetAnalysisRouter.get("/analysis", async (request, response) => {
  const consulta = parseCorpo(consultaSchema, request.query, response);
  if (!consulta) return;
  const to = consulta.to ?? todayInSaoPaulo();
  const from = consulta.from ?? addDays(to, -(PERIODO_PADRAO_DIAS - 1));
  if (from > to) return response.status(400).json({ message: "A data inicial é depois da final." });
  if (diasEntre(from, to) > MAX_DIAS) return response.status(400).json({ message: `Escolha um período de no máximo ${MAX_DIAS} dias.` });
  const verCusto = await custoVisivel(request);
  response.json(await analiseDoBuffet(from, to, consulta.kind, verCusto));
});
