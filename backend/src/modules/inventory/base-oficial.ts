// O que acontece com a base oficial de estoque quando o inventario que a gerou
// muda de estado.
//
// A base oficial (InventorySnapshot) nasce do inventario operacional aprovado e
// e o que o CMV do mes le. Os dois viviam soltos um do outro: cancelar o
// inventario nao encostava na base, entao o CMV continuava lendo o numero de um
// inventario que nao existia mais. Foi o que aconteceu com agosto/2026, que
// seguiu valendo R$ 137 mil depois do erro identificado.
//
// Fechar so o cancelamento cria um problema pior do outro lado: com a base
// cancelada e o ponteiro do inventario ainda apontando para ela, reaprovar
// devolve a base cancelada em vez de gerar uma nova, e o inventario termina
// aprovado sem base viva nenhuma. Por isso as tres decisoes moram juntas aqui:
// elas so fazem sentido como um ciclo.
//
//   aprovar   → cria a base
//   cancelar  → cancela a base (e o inicial clonado do mes seguinte)
//   reabrir   → solta o ponteiro para a base cancelada
//   aprovar   → como nao ha base viva, cria outra

/** Status da base vinculada. `null` = o inventario nunca gerou base. */
export type StatusDaBase = string | null;

export function baseEstaViva(status: StatusDaBase): boolean {
  return status != null && status !== "CANCELLED";
}

/**
 * Cancelar o inventario deve cancelar a base?
 *
 * So quando existe uma base viva. Base ja cancelada nao e recancelada: isso
 * sobrescreveria o motivo e a data do cancelamento original, apagando o rastro
 * de quem cancelou primeiro e por que.
 */
export function cancelamentoDeveCancelarBase(status: StatusDaBase): boolean {
  return baseEstaViva(status);
}

/**
 * Reabrir o inventario deve soltar o ponteiro para a base?
 *
 * Só quando a base esta cancelada. Se ela estiver viva, o ponteiro continua
 * valendo e reaprovar reaproveita a base — que e o comportamento correto para
 * reabrir um inventario apenas REJEITADO, onde nada foi cancelado.
 */
export function reaberturaDeveSoltarBase(status: StatusDaBase): boolean {
  return status != null && status === "CANCELLED";
}

/**
 * Aprovar pode reaproveitar a base que ja esta vinculada?
 *
 * Esta e a trava que evita gerar base duplicada quando o inventario e aprovado
 * duas vezes — mas ela nao pode valer para base cancelada.
 */
export function podeReaproveitarBase(status: StatusDaBase): boolean {
  return baseEstaViva(status);
}
