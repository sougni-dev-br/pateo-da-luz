import { useId, useState, type ReactNode } from "react";
import { useAteLargura } from "./useEstreito";

// Título de uma subaba de edição (Premissas, Gastos, Caixa). Em telas até 1100px a explicação vira "Como funciona",
// aberta sob demanda: num notebook de 768px de altura ela empurrava o primeiro campo editável para fora da dobra.

const LARGURA_COMPACTA = 1100;

type Props = { titulo: string; descricao: ReactNode; controle?: ReactNode };

export function CabecalhoDaSecao({ titulo, descricao, controle }: Props) {
  const compacto = useAteLargura(LARGURA_COMPACTA);
  const [aberta, setAberta] = useState(false);
  const id = useId();
  return (
    <div className={`plan-cabecalho${controle ? " plan-cabecalho-com-controle" : ""}${compacto ? " plan-cabecalho-compacto" : ""}`}>
      <div>
        <div className="plan-cabecalho-linha">
          <h2 className="plan-titulo">{titulo}</h2>
          {compacto && (
            <button type="button" className="plan-link plan-ajuda-botao" aria-expanded={aberta} aria-controls={id} onClick={() => setAberta((a) => !a)}>
              {aberta ? "Fechar a explicação" : "Como funciona"}
            </button>
          )}
        </div>
        <p id={id} className="plan-sub" hidden={compacto && !aberta}>{descricao}</p>
      </div>
      {controle}
    </div>
  );
}
