import { CheckCircle2, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { getDecimoTerceiro, getPagamentoMeio } from "../../api/client";
import { ROTAS_RH } from "../rh/rotasRh";
import { LinkInterno } from "./LinkInterno";
import { type Pendencia, pendenciaDoMeio, pendenciasDoDecimo } from "./pendencias";
import "./folha-ui.css";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "O que fazer neste mês": reúne o que ainda falta lançar nas telas de pagamento, com atalho para cada uma. */
export function PendenciasFolha({ year, month }: { year: number; month: number }) {
  const [itens, setItens] = useState<Pendencia[] | null>(null);
  const [incompleto, setIncompleto] = useState(false);

  useEffect(() => {
    let ativo = true;
    setItens(null);
    setIncompleto(false);
    void (async () => {
      const [adiant, quinz, decimo] = await Promise.allSettled([
        getPagamentoMeio(year, month, "ADIANTAMENTO"),
        getPagamentoMeio(year, month, "QUINZENA"),
        month >= 10 ? getDecimoTerceiro(year) : Promise.resolve(null),
      ]);
      if (!ativo) return;
      const lista: Pendencia[] = [];
      const q = pendenciaDoMeio("1ª quinzena (dia 15)", quinz.status === "fulfilled" ? quinz.value : null, ROTAS_RH.quinzena);
      const a = pendenciaDoMeio("Adiantamento (dia 20)", adiant.status === "fulfilled" ? adiant.value : null, ROTAS_RH.adiantamento);
      if (q) lista.push(q);
      if (a) lista.push(a);
      if (decimo.status === "fulfilled" && decimo.value) lista.push(...pendenciasDoDecimo(month, decimo.value.linhas, decimo.value.clt ?? [], ROTAS_RH.decimoTerceiro));
      setIncompleto([adiant, quinz, decimo].some((r) => r.status === "rejected"));
      setItens(lista);
    })();
    return () => { ativo = false; };
  }, [year, month]);

  if (!itens) return null;
  return (
    <section className="folha-pendencias" aria-label={`O que fazer em ${MESES[month - 1]}`} data-vazio={itens.length === 0 || undefined}>
      <div className="folha-pendencias-titulo">
        {itens.length === 0 ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
        <strong>{itens.length === 0 ? `Nada pendente em ${MESES[month - 1]}` : `O que fazer em ${MESES[month - 1]}`}</strong>
        {incompleto && <span className="folha-nota">não deu para verificar tudo agora</span>}
      </div>
      {itens.length > 0 && (
        <ul>
          {itens.map((p) => (
            <li key={p.chave}>
              <span>{p.texto}</span>
              <LinkInterno para={p.destino} className="folha-pendencia-link">Abrir</LinkInterno>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
