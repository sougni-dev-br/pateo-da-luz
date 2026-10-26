import { useState } from "react";
import type { PeriodoFerias, PessoaFerias } from "../../../api/client";
import { Button } from "../../../design-system";
import { type ItemDeDecisao, decidirHoje } from "./direito";

const LIMITE_DA_LISTA = 5;

type Props = { pessoas: PessoaFerias[]; hoje: string; onProgramar: (pessoa: PessoaFerias, periodo: PeriodoFerias) => void };

function Lista({ titulo, vazio, tom, itens, onProgramar }: { titulo: string; vazio: string; tom: "atraso" | "pode"; itens: ItemDeDecisao[]; onProgramar: Props["onProgramar"] }) {
  const [todas, setTodas] = useState(false);
  const visiveis = todas ? itens : itens.slice(0, LIMITE_DA_LISTA);
  return (
    <section className={`fe-decidir-lista fe-decidir-lista--${tom}`} aria-label={titulo}>
      <h3>{titulo} <span>{itens.length}</span></h3>
      {itens.length === 0 ? <p className="fe-decidir-vazio">{vazio}</p> : (
        <ul>
          {visiveis.map((i) => (
            <li key={`${i.pessoa.employeeId}|${i.periodo.aquisitivoInicio}`}>
              <div className="fe-decidir-quem"><strong>{i.pessoa.nome}</strong><span>{i.detalhe}</span></div>
              <div className={`fe-decidir-prazo fe-decidir-prazo--${i.tom}`}><b>{i.destaque}</b><span>{i.prazo}</span></div>
              <Button size="sm" variant={tom === "atraso" ? "primary" : "secondary"} aria-label={`Escolher datas das férias de ${i.pessoa.nome}`} onClick={() => onProgramar(i.pessoa, i.periodo)}>Escolher datas</Button>
            </li>
          ))}
        </ul>
      )}
      {itens.length > LIMITE_DA_LISTA && (
        <button type="button" className="fe-decidir-mais" aria-expanded={todas} onClick={() => setTodas((v) => !v)}>
          {todas ? "Mostrar menos" : `Ver todas (${itens.length})`}
        </button>
      )}
    </section>
  );
}

/** O que olhar hoje: quem está em atraso e quem tem ciclo completo e já pode ter as férias programadas. */
export function DecidirHoje({ pessoas, hoje, onProgramar }: Props) {
  const { atraso, podeProgramar } = decidirHoje(pessoas, hoje);
  return (
    <div className="fe-decidir">
      <Lista titulo="Em atraso" tom="atraso" itens={atraso} vazio="Ninguém com prazo vencido." onProgramar={onProgramar} />
      <Lista titulo="Pode programar agora" tom="pode" itens={podeProgramar} vazio="Ninguém com ciclo completo para programar." onProgramar={onProgramar} />
    </div>
  );
}
