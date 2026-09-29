// Nome da pessoa em todas as abas da gorjeta: o nome completo em cima (é o que está nos
// documentos e no extrato) e o apelido embaixo, quando existe. As abas que só têm o
// nome (extrato, folha) acham o apelido pelo funcionário, no contexto da página.
import { createContext, type ReactNode, useContext } from "react";

export const ApelidosContext = createContext<ReadonlyMap<string, string>>(new Map());

export function useApelido(employeeId: string | null | undefined, apelido?: string | null): string | null {
  const mapa = useContext(ApelidosContext);
  if (apelido !== undefined) return apelido;
  return employeeId ? mapa.get(employeeId) ?? null : null;
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
