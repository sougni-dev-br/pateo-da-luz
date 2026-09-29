// Nome das pessoas nas telas da gorjeta: o nome completo é o principal (é o que está nos
// documentos e no extrato); o apelido aparece embaixo, quando existe.
type ComNome = { firstName: string; lastName: string; displayName?: string | null };

export const nomeCompleto = (e: ComNome) => `${e.firstName} ${e.lastName}`.replace(/\s+/g, " ").trim();

export function apelidoDe(e: ComNome): string | null {
  const apelido = e.displayName?.trim();
  return apelido && apelido.toLowerCase() !== nomeCompleto(e).toLowerCase() ? apelido : null;
}
