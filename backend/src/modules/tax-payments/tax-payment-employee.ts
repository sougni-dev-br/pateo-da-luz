import { prisma } from "../../config/database.js";

export type FuncionarioDaGuia = { ok: true; id: string | null } | { ok: false; message: string };

// Guia de FGTS de rescisão: o funcionário a que ela se refere. Só vale para FGTS e só para quem já está desligado.
export async function lerFuncionarioDaGuia(bruto: unknown, tipoDaGuia: string): Promise<FuncionarioDaGuia> {
  if (bruto == null || bruto === "") return { ok: true, id: null };
  if (typeof bruto !== "string") return { ok: false, message: "Funcionário inválido." };
  if (tipoDaGuia !== "FGTS") return { ok: false, message: "Só a guia de FGTS pode ser ligada a um funcionário." };
  const funcionario = await prisma.employee.findUnique({ where: { id: bruto }, select: { id: true, isActive: true, terminationDate: true } });
  if (!funcionario) return { ok: false, message: "Funcionário não encontrado." };
  if (funcionario.isActive && !funcionario.terminationDate) return { ok: false, message: "A guia de rescisão se liga a um funcionário desligado." };
  return { ok: true, id: funcionario.id };
}
