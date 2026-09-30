// Nome da pessoa em todas as abas da gorjeta: o nome completo em cima (é o que está nos
// documentos e no extrato) e o apelido embaixo, quando existe. As abas que só têm o
// nome (extrato, folha) acham o apelido pelo funcionário, no contexto da página.
import { createContext, type ReactNode, useContext } from "react";

export const ApelidosContext = createContext<ReadonlyMap<string, string>>(new Map());

/** O apelido que veio na linha vale (mesmo null); sem ele, o do mapa pelo funcionário. */
export function resolverApelido(mapa: ReadonlyMap<string, string>, employeeId: string | null | undefined, apelido?: string | null): string | null {
  if (apelido !== undefined) return apelido;
  return employeeId ? mapa.get(employeeId) ?? null : null;
}

export function useApelido(employeeId: string | null | undefined, apelido?: string | null): string | null {
  return resolverApelido(useContext(ApelidosContext), employeeId, apelido);
}

type Props = {
  nome: string;
  employeeId?: string | null;
  /** Se vier, vale este; senão busca pelo employeeId no contexto. */
  apelido?: string | null;
  /** Selos/detalhes que vão na linha de baixo, junto do apelido. */
  children?: ReactNode;
};

export function NomePessoa({ nome, employeeId, apelido, children }: Props) {
  const a = useApelido(employeeId, apelido);
  return (
    <div className="nome-pessoa">
      <div className="nome-pessoa-nome">{nome}</div>
      {(a || children) && (
        <div className="nome-pessoa-extra">
          {a && <span className="nome-pessoa-apelido">“{a}”</span>}
          {children}
        </div>
      )}
    </div>
  );
}

/** Texto de busca de uma pessoa: nome e apelido juntos. */
export const textoPessoa = (nome: string, apelido?: string | null) => `${nome} ${apelido ?? ""}`;

/**
 * Nome numa linha só (opções de select): "Luiz Felipe Cardoso Silva (Luiz)". Sem apelido,
 * ou apelido igual ao nome, fica só o nome — nunca só o apelido.
 */
export function nomeComApelido(nome: string, apelido?: string | null): string {
  const n = nome.replace(/\s+/g, " ").trim();
  const a = (apelido ?? "").trim();
  if (!a || a.toLowerCase() === n.toLowerCase()) return n || a;
  return n ? `${n} (${a})` : a;
}
