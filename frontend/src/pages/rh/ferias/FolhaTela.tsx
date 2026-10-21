import { Fragment } from "react";
import type { ListaFerias, PeriodoFerias, PessoaFerias } from "../../../api/client";
import { type Ausencia, type Eixo, coberturaPorDia, mesesDoEixo, retangulo, rotulosDosMeses, segundasDoEixo, trechosDeCobertura, xDoDia, zonasDaJanela } from "./eixoDoTempo";
import { type LinhaFerias, dataBr, plural, resumoProgramacao, rotuloDaSituacao, textoPrazo } from "./feriasFormato";
import { NOME_NA_FOLHA_PX, type OpcoesTela, larguraUtilPx, tituloDaFolha } from "./opcoesDaFolha";

type Comum = { lista: ListaFerias; opcoes: OpcoesTela; filtroRotulo: string; empresaDaTela: string };

const semEmpresa = (p: PessoaFerias) => p.empresa ?? "Sem empresa";
const resumoDoTopo = ({ lista, filtroRotulo, empresaDaTela }: Comum) =>
  `emitido em ${dataBr(lista.hoje)} · exibindo: ${filtroRotulo}${empresaDaTela ? ` · ${empresaDaTela}` : ""}`;

// ── Linha do tempo ─────────────────────────────────────────────────────────────────

type PropsLinha = Comum & { pessoas: PessoaFerias[]; eixo: Eixo; ausencias: Ausencia[] };

const LEGENDA: Array<[string, string]> = [
  ["seguro", "No prazo"], ["atencao", "Menos de 90 dias"], ["urgente", "Menos de 30 dias"], ["estouro", "Passou do prazo"],
  ["programada", "Programada (a empresa quer)"], ["pedido", "Pedido do colaborador"], ["limite", "Prazo limite"], ["gozada", "Gozada"],
];

export function FolhaTelaLinhaDoTempo(props: PropsLinha) {
  const { pessoas, eixo, ausencias, opcoes, lista } = props;
  const util = larguraUtilPx(opcoes);
  const meses = mesesDoEixo(eixo);
  const rotulos = rotulosDosMeses(meses);
  const trechos = opcoes.cobertura ? trechosDeCobertura(coberturaPorDia(eixo, ausencias)) : [];
  const xHoje = lista.hoje >= eixo.inicio ? xDoDia(eixo, lista.hoje) + eixo.pxPorDia / 2 : -1;
  const agrupar = new Set(pessoas.map(semEmpresa)).size > 1;
  // No trimestre cada dia pesa bastante: marcas por semana (segundas-feiras) ajudam a ler as datas.
  const semanas = opcoes.meses === 3 ? segundasDoEixo(eixo) : [];

  const grade = (
    <>
      {semanas.map((w) => <i key={`s${w.x}`} className="fe-ti-semana" style={{ left: w.x }} />)}
      {meses.map((m) => <i key={m.iso} className={`fe-ti-grade${m.viraAno ? " fe-ti-grade--ano" : ""}`} style={{ left: m.x }} />)}
      {xHoje >= 0 && xHoje <= eixo.largura && <i className="fe-ti-hoje" style={{ left: xHoje }} />}
    </>
  );

  return (
    <div className="fe-ti" style={{ width: util }}>
      <header className="fe-ti-topo">
        <h2>{tituloDaFolha("linha")}</h2>
        <p>{resumoDoTopo(props)}</p>
      </header>
      {opcoes.legenda && (
        <ul className="fe-ti-legenda" aria-label="Legenda">
          {LEGENDA.map(([tom, rotulo]) => <li key={tom}><i className={`fe-ti-amostra fe-ti-amostra--${tom}`} />{rotulo}</li>)}
          <li><i className="fe-ti-amostra fe-ti-amostra--hoje" />Hoje</li>
        </ul>
      )}
      <table className="fe-ti-tabela" style={{ width: util }}>
        <colgroup><col style={{ width: NOME_NA_FOLHA_PX }} /><col style={{ width: eixo.largura }} /></colgroup>
        <thead>
          <tr>
            <th className="fe-ti-nome">Funcionário</th>
            <th className="fe-ti-trilha">
              <div className={`fe-ti-meses${semanas.length > 0 ? " fe-ti-meses--semanas" : ""}`} style={{ width: eixo.largura }}>
                {meses.map((m, i) => (
                  <span key={m.iso} style={{ left: m.x, width: m.largura }}>{m.largura >= 22 ? `${rotulos[i].nome}${rotulos[i].ano ? ` ${rotulos[i].ano}` : ""}` : ""}</span>
                ))}
                {semanas.map((w) => <em key={`n${w.x}`} className="fe-ti-seg" style={{ left: w.x }}>{w.dia}</em>)}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {opcoes.cobertura && (
            <tr className="fe-ti-linha">
              <td className="fe-ti-nome"><strong>Quem está fora</strong></td>
              <td className="fe-ti-trilha">
                <div className="fe-ti-pista" style={{ width: eixo.largura }}>
                  {grade}
                  {trechos.map((t) => (
                    <b key={t.de} className={`fe-ti-calor fe-ti-calor--${Math.min(t.quantos, 4)}`}
                      style={{ left: t.de * eixo.pxPorDia, width: (t.ate - t.de + 1) * eixo.pxPorDia }}>
                      {(t.ate - t.de + 1) * eixo.pxPorDia >= 12 ? t.quantos : ""}
                    </b>
                  ))}
                </div>
              </td>
            </tr>
          )}
          {pessoas.map((pessoa, i) => (
            <Fragment key={pessoa.employeeId}>
              {agrupar && (i === 0 || semEmpresa(pessoas[i - 1]) !== semEmpresa(pessoa)) && (
                <tr className="fe-ti-grupo"><td colSpan={2}>{semEmpresa(pessoa)}</td></tr>
              )}
              <tr className="fe-ti-linha">
                <td className="fe-ti-nome">
                  <strong>{pessoa.nome}</strong>
                  <small>{[pessoa.setor, prazoDaPessoa(pessoa)].filter(Boolean).join(" · ")}</small>
                </td>
                <td className="fe-ti-trilha">
                  <div className="fe-ti-pista" style={{ width: eixo.largura }}>
                    {grade}
                    {pessoa.periodos.map((p) => <Janela key={p.aquisitivoInicio} eixo={eixo} periodo={p} />)}
                    {pessoa.periodos.map((p) => {
                      const r = p.solicitacao ? retangulo(eixo, p.solicitacao.inicio, p.solicitacao.fim) : null;
                      return r && <span key={`pedido-${p.aquisitivoInicio}`} className="fe-ti-pedido" style={{ left: r.x, width: Math.max(r.largura, 3) }} />;
                    })}
                    {pessoa.periodos.flatMap((p) => p.programacoes.map((g) => {
                      if (!g.gozoInicio || !g.gozoFim) return null;
                      const r = retangulo(eixo, g.gozoInicio, g.gozoFim);
                      if (!r) return null;
                      const gozada = g.status === "GOZADA";
                      const texto = r.largura >= 78 ? `${dataBr(g.gozoInicio).slice(0, 5)}–${dataBr(g.gozoFim).slice(0, 5)}` : r.largura >= 24 ? `${g.dias}d` : "";
                      return <span key={g.id} className={`fe-ti-barra fe-ti-barra--${gozada ? "gozada" : "programada"}`} style={{ left: r.x, width: Math.max(r.largura, 3) }}>{gozada && r.largura >= 40 ? "✓ " : ""}{texto || (gozada ? "✓" : "")}</span>;
                    }))}
                  </div>
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      <footer className="fe-ti-rodape">{pessoas.length} {plural(pessoas.length, "pessoa", "pessoas")} · período de {eixo.totalDias} dias</footer>
    </div>
  );
}

/** O prazo mais urgente da pessoa, em palavras (o que a coluna do nome mostra na tela). */
function prazoDaPessoa(pessoa: PessoaFerias): string {
  const p = pessoa.periodos.find((x) => x.nivel !== "ok" && x.situacao !== "EM_AQUISICAO" && x.diasPendentes > 0)
    ?? pessoa.periodos.find((x) => x.situacao !== "EM_AQUISICAO" && x.diasPendentes > 0);
  return p ? textoPrazo(p) : "";
}

function Janela({ eixo, periodo: p }: { eixo: Eixo; periodo: PeriodoFerias }) {
  if (p.situacao === "GOZADA") return null;
  if (p.situacao === "EM_AQUISICAO") {
    const r = retangulo(eixo, p.aquisitivoInicio, p.aquisitivoFim);
    return r ? <span className="fe-ti-aquisicao" style={{ left: r.x, width: r.largura }} /> : null;
  }
  const limite = p.diasPendentes > 0 && !p.doHistorico ? retangulo(eixo, p.limiteInicioGozo, p.limiteInicioGozo) : null;
  return (
    <>
      {zonasDaJanela(p).map((z) => {
        const r = retangulo(eixo, z.inicio, z.fim);
        return r ? <span key={z.tom} className={`fe-ti-zona fe-ti-zona--${z.tom}`} style={{ left: r.x, width: r.largura }} /> : null;
      })}
      {limite && <span className="fe-ti-limite" style={{ left: limite.x + limite.largura }} title={`Prazo limite para começar: ${dataBr(p.limiteInicioGozo)}`} />}
    </>
  );
}

// ── Lista ──────────────────────────────────────────────────────────────────────────

type PropsLista = Comum & { linhas: LinhaFerias[] };

export function FolhaTelaLista(props: PropsLista) {
  const { linhas, opcoes } = props;
  const util = larguraUtilPx(opcoes);
  return (
    <div className="fe-ti" style={{ width: util }}>
      <header className="fe-ti-topo">
        <h2>{tituloDaFolha("lista")}</h2>
        <p>{resumoDoTopo(props)}</p>
      </header>
      <table className="fe-ti-tabela fe-ti-tabela--lista" style={{ width: util }}>
        <thead>
          <tr><th>Funcionário</th><th>Período aquisitivo</th><th>Começar até</th><th>Situação</th><th>Programação</th></tr>
        </thead>
        <tbody>
          {linhas.map(({ pessoa, periodo: p }) => (
            <tr key={`${pessoa.employeeId}|${p.aquisitivoInicio}`} className="fe-ti-linha">
              <td><strong>{pessoa.nome}</strong><small>{[pessoa.setor, pessoa.empresa].filter(Boolean).join(" · ")}</small></td>
              <td>{dataBr(p.aquisitivoInicio)} a {dataBr(p.aquisitivoFim)}</td>
              <td><strong>{dataBr(p.limiteInicioGozo)}</strong><small>{textoPrazo(p)}</small></td>
              <td>{rotuloDaSituacao(p)}{p.diasPendentes > 0 && p.situacao !== "EM_AQUISICAO" ? <small>{p.diasPendentes} {plural(p.diasPendentes, "dia", "dias")} a programar</small> : null}</td>
              <td>{p.programacoes.length === 0 ? "—" : p.programacoes.map((g) => <span key={g.id} className="fe-ti-prog">{g.status === "GOZADA" ? "Gozou: " : ""}{resumoProgramacao(g)}</span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="fe-ti-rodape">{linhas.length} {plural(linhas.length, "período", "períodos")}</footer>
    </div>
  );
}
