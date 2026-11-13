import type { ReactNode } from "react";
import "./folha-ui.css";

export type Passo = {
  titulo: string;
  detalhe: string;
  /** feito = concluído; atual = o que falta fazer agora; pendente = ainda não chegou a vez. */
  estado: "feito" | "atual" | "pendente";
  /** Botão do passo (só o atual costuma ter). */
  acao?: ReactNode;
};

/** Os três passos de um pagamento (conferir, lançar, pagar): mostra em qual deles a pessoa está. */
export function Passos({ passos, rotulo }: { passos: Passo[]; rotulo: string }) {
  return (
    <ol className="folha-passos" aria-label={rotulo}>
      {passos.map((p, i) => (
        <li key={p.titulo} className="folha-passo" data-estado={p.estado} aria-current={p.estado === "atual" ? "step" : undefined}>
          <span className="folha-passo-marca" aria-hidden="true">{p.estado === "feito" ? "✓" : i + 1}</span>
          <span className="folha-passo-titulo">{p.titulo}</span>
          <span className="folha-passo-detalhe">{p.detalhe}</span>
          {p.acao ? <div className="folha-passo-acao">{p.acao}</div> : null}
        </li>
      ))}
    </ol>
  );
}
