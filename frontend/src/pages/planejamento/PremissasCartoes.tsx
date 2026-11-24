import type { PlanejamentoPremissasDoMes, PlanejamentoProjecao } from "../../api/client";
import { NOMES_DOS_MESES, NOMES_DOS_MESES_CURTOS } from "./formato";
import { CampoPercentual, COLUNAS, Efeito, type Coluna } from "./premissasCampos";

// Premissas no celular e no tablet: um cartão por mês, com os cinco campos numa matriz pequena (clientes e ticket por
// turno, e o CMV) e o efeito nas vendas no topo do cartão. O cartão "Todos os meses" vem primeiro e só aplica no Enter.

type Celula = { chave: Coluna; turno: "Almoço" | "Jantar" | null };
const LINHAS: { rotulo: string; celulas: Celula[] }[] = [
  { rotulo: "Clientes", celulas: [{ chave: "clientesAlmoco", turno: "Almoço" }, { chave: "clientesJantar", turno: "Jantar" }] },
  { rotulo: "Ticket", celulas: [{ chave: "ticketAlmoco", turno: "Almoço" }, { chave: "ticketJantar", turno: "Jantar" }] },
  { rotulo: "CMV", celulas: [{ chave: "cmv", turno: null }] }
];
const rotuloDe = (chave: Coluna) => COLUNAS.find((c) => c.chave === chave)?.rotulo ?? chave;

type MatrizProps = {
  valorDe: (chave: Coluna) => number | null;
  rotuloDoCampo: (rotulo: string) => string;
  desabilitado: boolean;
  adiado?: boolean;
  vaiMudar?: (chave: Coluna) => boolean;
  onPrevia?: (chave: Coluna, valor: number | null | undefined) => void;
  onMudar: (chave: Coluna, valor: number | null) => void;
};

/** Clientes e ticket em % sobre o ano-base, por turno; CMV em % das vendas do mês. */
function Matriz({ valorDe, rotuloDoCampo, desabilitado, adiado = false, vaiMudar, onPrevia, onMudar }: MatrizProps) {
  return (
    <div className="plan-premissa-matriz">
      <span aria-hidden />
      <span className="plan-premissa-turno" aria-hidden>Almoço %</span>
      <span className="plan-premissa-turno" aria-hidden>Jantar %</span>
      {LINHAS.map((linha) => (
        <div key={linha.rotulo} className="plan-premissa-linha">
          <span className="plan-premissa-rotulo" aria-hidden>{linha.rotulo}</span>
          {linha.celulas.map(({ chave }) => (
            <span key={chave} className={chave === "cmv" ? "plan-premissa-cmv" : undefined}>
              <CampoPercentual
                valor={valorDe(chave)}
                rotulo={rotuloDoCampo(rotuloDe(chave))}
                desabilitado={desabilitado}
                aceitaVazio={chave === "cmv"}
                adiado={adiado}
                vaiMudar={vaiMudar?.(chave) ?? false}
                onPrevia={onPrevia ? (v) => onPrevia(chave, v) : undefined}
                onMudar={(v) => onMudar(chave, v)}
              />
              {chave === "cmv" && <span className="plan-premissa-dica" aria-hidden>% das vendas</span>}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

type Props = {
  premissas: PlanejamentoPremissasDoMes[];
  projecao?: PlanejamentoProjecao | null;
  desabilitado: boolean;
  dicaDoTodos: string;
  valorComum: (coluna: Coluna) => number | null;
  vaiMudar: (p: PlanejamentoPremissasDoMes, coluna: Coluna) => boolean;
  onPreviaDoTodos: (coluna: Coluna, valor: number | null | undefined) => void;
  onMudarTodos: (coluna: Coluna, valor: number | null) => void;
  onMudarMes: (mes: number, coluna: Coluna, valor: number | null) => void;
};

export function PremissasCartoes({ premissas, projecao, desabilitado, dicaDoTodos, valorComum, vaiMudar, onPreviaDoTodos, onMudarTodos, onMudarMes }: Props) {
  return (
    <div className="plan-premissas-cartoes">
      <section className="plan-premissa-cartao plan-premissa-cartao-todos" aria-labelledby="plan-premissa-todos">
        <div className="plan-premissa-topo">
          <h3 id="plan-premissa-todos" className="plan-premissa-mes">Todos os meses</h3>
          <span className="plan-todos-dica" aria-live="polite">{dicaDoTodos}</span>
        </div>
        <Matriz
          valorDe={valorComum}
          rotuloDoCampo={(r) => `${r}, todos os meses`}
          desabilitado={desabilitado}
          adiado
          onPrevia={onPreviaDoTodos}
          onMudar={onMudarTodos}
        />
      </section>
      <ul className="plan-premissa-lista" aria-label="Premissas mês a mês">
        {premissas.map((p) => {
          const rotuloCurto = NOMES_DOS_MESES_CURTOS[p.mes - 1];
          return (
            <li key={p.mes} className="plan-premissa-cartao">
              <div className="plan-premissa-topo">
                <h3 className="plan-premissa-mes">{NOMES_DOS_MESES[p.mes - 1]}</h3>
                <span className="plan-premissa-efeito"><span className="plan-sr">Efeito nas vendas: </span><Efeito projecao={projecao} mes={p.mes} /></span>
              </div>
              <Matriz
                valorDe={(chave) => p[chave]}
                rotuloDoCampo={(r) => `${r} em ${rotuloCurto}`}
                desabilitado={desabilitado}
                vaiMudar={(chave) => vaiMudar(p, chave)}
                onMudar={(chave, v) => onMudarMes(p.mes, chave, v)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
