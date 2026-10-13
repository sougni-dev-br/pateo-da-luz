// Quebra e perda sao desperdicio: tem motivo, setor e valor proprios no modulo Desperdicio.
// Aceitar tambem como movimentacao deixaria dois caminhos para registrar a mesma coisa.
const TIPOS_DO_DESPERDICIO = new Set(["BREAKAGE", "LOSS"]);

/** Mensagem de recusa quando o tipo de movimentacao passou a ser registrado em outro modulo. */
export function mensagemDeTipoMigrado(type: string): string | null {
  return TIPOS_DO_DESPERDICIO.has(type)
    ? "Quebra e perda agora se registram em Desperdicio (menu Estoque), com motivo e valor."
    : null;
}
