import { Router } from "express";
import { z } from "zod";
import { carregarComparativo } from "./planejamento.service.js";

// Planejamento > Comparativo. Só leitura. O acesso vem do módulo "planning" (ver), aplicado pelo
// middleware de permissões por prefixo de rota (menu-permissions.ts).
export const planningRouter = Router();

const ANO_MINIMO = 2020;
const ANO_MAXIMO = 2100;

const consultaDoComparativo = z.object({
  anoBase: z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO),
  anoComparado: z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO)
});

planningRouter.get("/comparativo", async (request, response) => {
  const consulta = consultaDoComparativo.safeParse({
    anoBase: request.query.anoBase ?? new Date().getFullYear() - 1,
    anoComparado: request.query.anoComparado ?? new Date().getFullYear()
  });
  if (!consulta.success) {
    response.status(400).json({ message: "Informe anos válidos entre 2020 e 2100." });
    return;
  }
  const { anoBase, anoComparado } = consulta.data;
  if (anoBase === anoComparado) {
    response.status(400).json({ message: "Escolha dois anos diferentes para comparar." });
    return;
  }
  response.json(await carregarComparativo(anoBase, anoComparado));
});
