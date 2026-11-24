// Brinde para os colaboradores (Natal etc.): regras puras, sem banco.
// A lista de elegíveis é a dos funcionários ativos na hora; a entrega guarda quem recebeu.

export type PessoaDoBrinde = {
  employeeId: string;
  nome: string;
  nomeCompleto: string;
  empresa: string | null;
  setor: string | null;
  cargo: string | null;
  ativo: boolean;
  /** Data de saída já lançada (ainda ativo, mas saindo): a tela avisa para o brinde não ir para quem já saiu. */
  saidaEm: string | null;
  entrega: { id: string; entregueEm: string; observacao: string | null; registradoPor: string | null } | null;
};

export type ResumoDoBrinde = {
  ativos: number;
  entregues: number;
  faltam: number;
  /** Receberam e hoje não estão mais ativos: ficam no registro, fora da conta de quem falta. */
  entreguesDeInativos: number;
};

export const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Data ISO (AAAA-MM-DD) que existe no calendário. */
export function diaIsoValido(valor: unknown): valor is string {
  if (typeof valor !== "string" || !ISO_DIA.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

export function resumirBrinde(pessoas: readonly PessoaDoBrinde[]): ResumoDoBrinde {
  let ativos = 0;
  let entregues = 0;
  let entreguesDeInativos = 0;
  for (const p of pessoas) {
    if (p.ativo) {
      ativos += 1;
      if (p.entrega) entregues += 1;
    } else if (p.entrega) {
      entreguesDeInativos += 1;
    }
  }
  return { ativos, entregues, faltam: ativos - entregues, entreguesDeInativos };
}

/** Ordem da lista: empresa, nome. Quem só aparece pela entrega (já saiu) vai no fim da empresa. */
export function ordenarPessoasDoBrinde<T extends Pick<PessoaDoBrinde, "empresa" | "nome" | "ativo">>(pessoas: readonly T[]): T[] {
  const cmp = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
  return [...pessoas].sort((a, b) => cmp(a.empresa, b.empresa) || Number(b.ativo) - Number(a.ativo) || cmp(a.nome, b.nome));
}
