// Rastreabilidade do cadastro de cartão: transforma o "antes" e o "depois" guardados no
// AuditLog em frases curtas para a tela. Puro, sem banco.

type FinalSnapshot = { id: string; label: string; last4Digits: string; kind: string; isActive: boolean };

export type CartaoSnapshot = {
  name?: string;
  bankName?: string;
  closingDay?: number;
  dueDay?: number;
  isActive?: boolean;
  notes?: string | null;
  finais?: FinalSnapshot[];
};

const CAMPOS_DA_CONTA: Array<{ chave: keyof CartaoSnapshot; rotulo: string; formatar?: (valor: unknown) => string }> = [
  { chave: "name", rotulo: "Nome" },
  { chave: "bankName", rotulo: "Banco" },
  { chave: "closingDay", rotulo: "Fechamento", formatar: (v) => `dia ${v}` },
  { chave: "dueDay", rotulo: "Vencimento", formatar: (v) => `dia ${v}` },
  { chave: "isActive", rotulo: "Situação", formatar: (v) => (v ? "ativo" : "inativo") },
  { chave: "notes", rotulo: "Observações", formatar: (v) => (v ? String(v) : "(vazio)") }
];

function tipo(kind: string): string {
  return kind === "VIRTUAL" ? "virtual" : "físico";
}

function nomeDoCartao(final: FinalSnapshot): string {
  return `Cartão ${tipo(final.kind)} ·· ${final.last4Digits}`;
}

export function resumirAlteracao(antes: CartaoSnapshot | null, depois: CartaoSnapshot | null): string[] {
  if (!depois) return [];
  const linhas: string[] = [];

  if (!antes) {
    linhas.push(`Cartão criado: ${depois.name} (${depois.bankName})`);
  } else {
    for (const campo of CAMPOS_DA_CONTA) {
      const a = antes[campo.chave];
      const d = depois[campo.chave];
      if ((a ?? null) === (d ?? null)) continue;
      const formatar = campo.formatar ?? ((v: unknown) => String(v ?? "(vazio)"));
      linhas.push(`${campo.rotulo}: ${formatar(a)} → ${formatar(d)}`);
    }
  }

  const finaisAntes = new Map((antes?.finais ?? []).map((final) => [final.id, final]));
  for (const final of depois.finais ?? []) {
    const anterior = finaisAntes.get(final.id);
    if (!anterior) {
      linhas.push(`${nomeDoCartao(final)} cadastrado`);
      continue;
    }
    if (anterior.isActive !== final.isActive) {
      linhas.push(`${nomeDoCartao(final)} ${final.isActive ? "reativado" : "inativado"}`);
    }
    if (anterior.last4Digits !== final.last4Digits) {
      linhas.push(`Cartão ${tipo(final.kind)}: final ${anterior.last4Digits} → ${final.last4Digits}`);
    }
    if (anterior.label !== final.label) {
      linhas.push(`${nomeDoCartao(final)}: nome ${anterior.label} → ${final.label}`);
    }
  }
  return linhas;
}
