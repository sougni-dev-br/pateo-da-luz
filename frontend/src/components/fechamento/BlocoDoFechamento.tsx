// Um bloco do fechamento: recolhido quando resolvido, aberto quando não.
//
// Antes cada bloco era um painel do mesmo tamanho, sempre aberto. Seis painéis
// iguais empilhados não dizem onde agir — e a tela crescia igual num mês limpo
// e num mês problemático.
//
// Recolher o que está resolvido faz a tela encurtar conforme o mês fecha, que é
// a única forma de o progresso ser visível sem uma barra dizendo isso.

import { Check, ChevronDown, Clock, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

export type EstadoDoBloco =
  /** Nada a fazer aqui. */
  | "OK"
  /** Falta algo, mas só se resolve no fim do mês. */
  | "AGUARDANDO"
  /** Falta algo que já era para estar lá, ou o que está lá não fecha. */
  | "ATENCAO"
  /** Pendente, porém justificado — não bloqueia. */
  | "JUSTIFICADO";

type Props = {
  numero: number;
  titulo: string;
  estado: EstadoDoBloco;
  /** Uma linha com o número que importa deste bloco. Aparece recolhido. */
  resumo?: ReactNode;
  children: ReactNode;
};

const ICONE: Record<EstadoDoBloco, ReactNode> = {
  OK: <Check size={15} />,
  AGUARDANDO: <Clock size={15} />,
  ATENCAO: <TriangleAlert size={15} />,
  JUSTIFICADO: <Check size={15} />
};

const ROTULO: Record<EstadoDoBloco, string> = {
  OK: "Pronto",
  AGUARDANDO: "Aguardando o mês",
  ATENCAO: "Precisa de atenção",
  JUSTIFICADO: "Justificado"
};

export function BlocoDoFechamento({ numero, titulo, estado, resumo, children }: Props) {
  // Abre sozinho no que precisa de atenção. Quem entra na tela para resolver
  // algo não deveria ter de caçar onde clicar.
  const [aberto, setAberto] = useState(estado === "ATENCAO");

  // O estado muda quando o mês vira ou uma justificativa é registrada; o bloco
  // acompanha, senão fica aberto mostrando algo já resolvido.
  useEffect(() => { setAberto(estado === "ATENCAO"); }, [estado]);

  return (
    <section className={`fbloco fbloco-${estado.toLowerCase()}`}>
      <button
        type="button"
        className="fbloco-topo"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <span className="fbloco-numero">{numero}</span>
        <span className="fbloco-titulo">{titulo}</span>
        {resumo != null && <span className="fbloco-resumo">{resumo}</span>}
        <span className="fbloco-estado">
          {ICONE[estado]}
          <span className="fbloco-estado-texto">{ROTULO[estado]}</span>
        </span>
        <ChevronDown size={16} className={`fbloco-seta${aberto ? " aberta" : ""}`} />
      </button>
      {aberto && <div className="fbloco-corpo">{children}</div>}
    </section>
  );
}
