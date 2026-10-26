// Validação dos cartões (físico/virtual) enviados junto com o cadastro da conta.

export type FinalEntrada = {
  id?: string;
  label: string;
  last4Digits: string;
  kind: "PHYSICAL" | "VIRTUAL";
  isActive: boolean;
};

export function validarFinais(brutos: unknown): { finais: FinalEntrada[] } | { erro: string } {
  if (!Array.isArray(brutos)) return { erro: "A lista de cartões da conta é inválida." };

  const finais: FinalEntrada[] = [];
  for (const bruto of brutos as Array<Record<string, unknown>>) {
    const last4Digits = String(bruto?.last4Digits ?? "").trim();
    const kind = String(bruto?.kind ?? "").toUpperCase();
    if (!/^\d{4}$/.test(last4Digits)) {
      return { erro: "Os 4 últimos dígitos de cada cartão devem ser só números (4 dígitos)." };
    }
    if (kind !== "PHYSICAL" && kind !== "VIRTUAL") {
      return { erro: "O tipo de cada cartão deve ser físico ou virtual." };
    }
    const label = String(bruto?.label ?? "").trim() || (kind === "VIRTUAL" ? "Cartão virtual" : "Cartão físico");
    finais.push({
      id: bruto?.id ? String(bruto.id) : undefined,
      label,
      last4Digits,
      kind,
      isActive: bruto?.isActive === undefined ? true : Boolean(bruto.isActive)
    });
  }

  const vistos = new Set<string>();
  for (const final of finais) {
    if (vistos.has(final.last4Digits)) return { erro: `Há dois cartões com o final ${final.last4Digits} nesta conta.` };
    vistos.add(final.last4Digits);
  }
  if (finais.filter((final) => final.kind === "PHYSICAL" && final.isActive).length > 1) {
    return { erro: "A conta só pode ter um cartão físico ativo; os demais devem ser virtuais." };
  }
  return { finais };
}
