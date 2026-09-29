// Salário, PIX e CPF só para quem pode ver Funcionários — uma checagem para todas as rotas.
import type { Request } from "express";
import { userHasPermission } from "../security/menu-permissions.js";
import { getSessionUser, type SessionUser } from "../security/security-utils.js";

export async function podeVerDadosPessoais(request: Request): Promise<boolean> {
  const user = await getSessionUser(request);
  return user ? userHasPermission(user as SessionUser, "employees", "view") : false;
}
