// Justificativas do fechamento guardam só o ID de quem as registrou. O resumo
// impresso é o documento que vai à contabilidade, e "quem" é metade do valor de
// uma justificativa: aqui o ID vira nome na hora de devolver o estado.

import type { ClosureJustification } from "./monthly-closure.service.js";

export type UsuarioDoFechamento = { id: string; name: string };

export function anexarNomes(
  justificativas: ClosureJustification[],
  usuarios: UsuarioDoFechamento[]
): ClosureJustification[] {
  const nomePorId = new Map(usuarios.map((u) => [u.id, u.name]));
  return justificativas.map((j) => ({
    ...j,
    justifiedByName: nomePorId.get(j.justifiedByUserId) ?? null
  }));
}
