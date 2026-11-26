import type { ReactNode } from "react";
import type { PlanejamentoComentario, PlanejamentoComparativo } from "../../../api/client";
import { textoDaEpoca } from "../comentarios/epoca";
import { dataEHora, valorEmTexto } from "../comentarios/formatoComentario";
import { chaveDoPonto, metricaDaGrandeza, ROTULO_DA_METRICA, textoDaContagem, turnoDaTela } from "../comentarios/ponto";
import { descricaoDoPeriodo, NOMES_DOS_MESES_CURTOS, textoDaVariacao } from "../formato";
import { fraseDoVeredito, oQueMaisPesou } from "../PainelComparativo";
import { celula, TURNOS_DO_QUADRO, type GrandezaDoQuadro } from "../TabelaMensal";
import { notasDaFolha, type NotasDaFolha } from "./notasDaFolha";
import "./folhaDoComparativo.css";

// Folha do Comparativo para papel (A4 deitado): veredito, os nove indicadores, as três grandezas mês a mês e os
// comentários marcados "Sai na impressão" como notas numeradas. Os não marcados só aparecem como contagem.

type Props = { dados: PlanejamentoComparativo; comentarios: readonly PlanejamentoComentario[]; geradoPor: string; geradoEm: Date };
type ChaveDoTurno = "almoco" | "jantar" | "total";

const GRANDEZAS: GrandezaDoQuadro[] = ["vendas", "clientes", "ticket"];
const UNIDADE: Record<GrandezaDoQuadro, string> = { vendas: "R$ mil", clientes: "pessoas", ticket: "R$" };

function Marcas({ numeros }: { numeros: readonly number[] }): ReactNode {
  return numeros.length > 0 ? <sup className="fcmp-nota">{numeros.join(",")}</sup> : null;
}

function Indicadores({ dados }: { dados: PlanejamentoComparativo }) {
  const { acumulado: a, anoBase, anoComparado } = dados;
  return (
    <table className="fcmp-tabela">
      <thead><tr><th scope="col">Indicador</th><th scope="col">{anoBase}</th><th scope="col">{anoComparado}</th><th scope="col">Variação</th></tr></thead>
      <tbody>
        {GRANDEZAS.flatMap((g) => [...TURNOS_DO_QUADRO].reverse().map(({ chave, rotulo }) => (
          <tr key={`${g}-${chave}`}>
            <th scope="row">{ROTULO_DA_METRICA[metricaDaGrandeza(g)]} · {rotulo.toLowerCase()}</th>
            <td>{valorEmTexto(g, a.base[g][chave], false)}</td>
            <td>{valorEmTexto(g, a.comparado[g][chave], false)}</td>
            <td>{textoDaVariacao(a.variacao[g][chave])}</td>
          </tr>
        )))}
      </tbody>
    </table>
  );
}

function QuadroMensal({ dados, grandeza, notas }: { dados: PlanejamentoComparativo; grandeza: GrandezaDoQuadro; notas: NotasDaFolha }) {
  const { meses, acumulado, anoBase, anoComparado } = dados;
  const marcas = (mes: number | null, turno: ChaveDoTurno) => (
    <Marcas numeros={notas.numerosDe(chaveDoPonto({ mes, metrica: metricaDaGrandeza(grandeza), turno: turnoDaTela(turno) }))} />
  );
  return (
    <section className="fcmp-bloco">
      <h2>{ROTULO_DA_METRICA[metricaDaGrandeza(grandeza)]} mês a mês <span className="fcmp-unidade">{UNIDADE[grandeza]}</span></h2>
      <table className="fcmp-tabela fcmp-mensal">
        <thead><tr><th scope="col">Turno</th>{meses.map((m) => <th key={m.mes} scope="col">{NOMES_DOS_MESES_CURTOS[m.mes - 1]}</th>)}<th scope="col">Acumulado</th></tr></thead>
        <tbody>
          {TURNOS_DO_QUADRO.flatMap(({ chave, rotulo }) => [
            <tr key={`${chave}-b`}><th scope="row">{rotulo} {anoBase}</th>{meses.map((m) => <td key={m.mes}>{celula(grandeza, m.base[grandeza][chave], false)}</td>)}<td>{celula(grandeza, acumulado.base[grandeza][chave], false)}</td></tr>,
            <tr key={`${chave}-c`}><th scope="row">{rotulo} {anoComparado}</th>{meses.map((m) => <td key={m.mes}>{celula(grandeza, m.comparado[grandeza][chave], false)}</td>)}<td>{celula(grandeza, acumulado.comparado[grandeza][chave], false)}</td></tr>,
            <tr key={`${chave}-v`} className="fcmp-var">
              <th scope="row">variação {rotulo.toLowerCase()}</th>
              {meses.map((m) => <td key={m.mes}>{textoDaVariacao(m.variacao[grandeza][chave])}{marcas(m.mes, chave)}</td>)}
              <td>{textoDaVariacao(acumulado.variacao[grandeza][chave])}{marcas(null, chave)}</td>
            </tr>
          ])}
        </tbody>
      </table>
    </section>
  );
}

function ListaDeComentarios({ notas }: { notas: NotasDaFolha }) {
  if (notas.notas.length === 0 && notas.naoIncluidos === 0) return null;
  return (
    <section className="fcmp-bloco fcmp-comentarios">
      <h2>Comentários</h2>
      {notas.notas.length > 0 && (
        <ol className="fcmp-notas">
          {notas.notas.map((n) => (
            <li key={n.comentario.id} value={n.numero}>
              <strong>{n.rotulo}</strong>
              <span className="fcmp-texto">{n.comentario.texto}</span>
              {textoDaEpoca(n.comentario, false) && <span className="fcmp-epoca">{textoDaEpoca(n.comentario, false)}</span>}
              <span className="fcmp-autor">{n.comentario.autorNome}, {dataEHora(n.comentario.criadoEm)}</span>
            </li>
          ))}
        </ol>
      )}
      {notas.naoIncluidos > 0 && <p className="fcmp-aviso">{textoDaContagem(notas.naoIncluidos)} não {notas.naoIncluidos === 1 ? "incluído" : "incluídos"} nesta impressão.</p>}
    </section>
  );
}

export function FolhaDoComparativo({ dados, comentarios, geradoPor, geradoEm }: Props) {
  const notas = notasDaFolha(comentarios, dados.anoComparado);
  const v = dados.acumulado.variacao;
  const explicacao = oQueMaisPesou(v.clientes.total, v.ticket.total);
  return (
    <article className="fcmp">
      <header className="fcmp-topo">
        <p className="fcmp-casa">Pateo da Luz · Planejamento do Salão</p>
        <h1>Comparativo {dados.anoComparado} contra {dados.anoBase}</h1>
        <p className="fcmp-periodo">Meses comparados: {descricaoDoPeriodo(dados.acumulado.mesesComparados)}. Gerado por {geradoPor} em {dataEHora(geradoEm.toISOString())}.</p>
        <p className="fcmp-veredito">{fraseDoVeredito(v.vendas.total, dados.anoBase, dados.anoComparado)}.{explicacao ? ` ${explicacao}` : ""}</p>
      </header>
      <section className="fcmp-bloco"><h2>Os nove indicadores</h2><Indicadores dados={dados} /></section>
      {GRANDEZAS.map((g) => <QuadroMensal key={g} dados={dados} grandeza={g} notas={notas} />)}
      <ListaDeComentarios notas={notas} />
    </article>
  );
}
