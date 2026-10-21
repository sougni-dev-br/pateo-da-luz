import { Fragment } from "react";
import type { ListaFerias, PeriodoFerias, PessoaFerias } from "../../../api/client";
import { type Ausencia, type Eixo, coberturaPorDia, mesesDoEixo, quemEstaFora, retangulo, rotulosDosMeses, segundasDoEixo, trechosDeCobertura, xDoDia, zonasDaJanela } from "./eixoDoTempo";
import { type LinhaFerias, dataBr, plural, resumoProgramacao, rotuloDaSituacao, somaDias, textoPrazo } from "./feriasFormato";
import { ROTULO_DA_SITUACAO_DO_PEDIDO, compararPedido, diferencaEmPalavras } from "./pedido";
import { type ItemDoResumo, ordenarPorUrgencia, periodoDaFicha, proximoPasso, resumoDoQueFazer } from "./proximoPasso";
import { type OpcoesTela, escalaDaLetra, larguraUtilPx, nomeNaFolhaPx, tituloDaFolha } from "./opcoesDaFolha";

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

const ROTULO_DO_RESUMO: Record<ItemDoResumo["tipo"], (n: number) => string> = {
  vencido: (n) => `${n} ${plural(n, "prazo vencido", "prazos vencidos")}, definir a data já`,
  responder: (n) => `${n} ${plural(n, "pedido para responder", "pedidos para responder")}`,
  definir: (n) => `${n} ${plural(n, "pessoa para definir a data", "pessoas para definir a data")}`,
  avisar: (n) => `${n} ${plural(n, "aviso a fazer", "avisos a fazer")}`,
  confirmar: (n) => `${n} ${plural(n, "gozo para confirmar", "gozos para confirmar")}`,
};

/** O que fazer: as providências da folha somadas por tipo, com os nomes. */
function ResumoDoQueFazer({ pessoas, hoje }: { pessoas: PessoaFerias[]; hoje: string }) {
  const itens = resumoDoQueFazer(pessoas, hoje);
  return (
    <section className="fe-ti-resumo" aria-label="O que fazer">
      <h3>O que fazer</h3>
      {itens.length === 0 ? <p>Nada a decidir agora.</p> : (
        <ul>
          {itens.map((i) => (
            <li key={i.tipo} className={i.urgente ? "fe-ti-resumo--urgente" : undefined}><b>{ROTULO_DO_RESUMO[i.tipo](i.nomes.length)}:</b> {i.nomes.join(", ")}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FolhaTelaLinhaDoTempo(props: PropsLinha) {
  const { eixo, ausencias, opcoes, lista } = props;
  const pessoas = ordenarPorUrgencia(props.pessoas, lista.hoje);
  const util = larguraUtilPx(opcoes);
  const meses = mesesDoEixo(eixo);
  const rotulos = rotulosDosMeses(meses);
  const trechos = opcoes.cobertura ? trechosDeCobertura(coberturaPorDia(eixo, ausencias)) : [];
  const xHoje = lista.hoje >= eixo.inicio ? xDoDia(eixo, lista.hoje) + eixo.pxPorDia / 2 : -1;
  const agrupar = new Set(pessoas.map(semEmpresa)).size > 1;
  const maior = trechos.reduce<(typeof trechos)[number] | null>((m, t) => (!m || t.quantos > m.quantos ? t : m), null);
  const sobreposicao = maior && maior.quantos >= 2
    ? { quantos: maior.quantos, de: somaDias(eixo.inicio, maior.de), ate: somaDias(eixo.inicio, maior.ate), nomes: quemEstaFora(ausencias, somaDias(eixo.inicio, maior.de), somaDias(eixo.inicio, maior.ate)) }
    : null;
  const anoDeHoje = lista.hoje.slice(0, 4);
  const dm = (iso: string) => (iso.slice(0, 4) === anoDeHoje ? dataBr(iso).slice(0, 5) : `${dataBr(iso).slice(0, 5)}/${iso.slice(2, 4)}`);
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
    <div className="fe-ti" style={{ width: util, "--e": escalaDaLetra(opcoes.letra) } as React.CSSProperties}>
      <header className="fe-ti-topo">
        <h2>{tituloDaFolha("linha")}</h2>
        <p>{resumoDoTopo(props)}</p>
      </header>
      <ResumoDoQueFazer pessoas={pessoas} hoje={lista.hoje} />
      {opcoes.legenda && (
        <ul className="fe-ti-legenda" aria-label="Legenda">
          {LEGENDA.map(([tom, rotulo]) => <li key={tom}><i className={`fe-ti-amostra fe-ti-amostra--${tom}`} />{rotulo}</li>)}
          <li><i className="fe-ti-amostra fe-ti-amostra--hoje" />Hoje</li>
        </ul>
      )}
      <table className="fe-ti-tabela" style={{ width: util }}>
        <colgroup><col style={{ width: nomeNaFolhaPx(opcoes) }} /><col style={{ width: eixo.largura }} /></colgroup>
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
          {opcoes.cobertura && sobreposicao && (
            <tr className="fe-ti-pico">
              <td colSpan={2}>
                <b>Maior sobreposição:</b> {sobreposicao.quantos} pessoas fora ao mesmo tempo, de {dm(sobreposicao.de)} a {dm(sobreposicao.ate)} — {sobreposicao.nomes.join(", ")}.
              </td>
            </tr>
          )}
          {pessoas.map((pessoa, i) => (
            <Fragment key={pessoa.employeeId}>
              {agrupar && (i === 0 || semEmpresa(pessoas[i - 1]) !== semEmpresa(pessoa)) && (
                <tr className="fe-ti-grupo"><td colSpan={2}>{semEmpresa(pessoa)}</td></tr>
              )}
              <tr className={`fe-ti-linha${periodoDaFicha(pessoa) ? "" : " fe-ti-linha--vazia"}`}>
                <td className="fe-ti-nome">
                  <strong>{pessoa.nome}</strong>
                  <small>{[pessoa.setor, prazoDaPessoa(pessoa)].filter(Boolean).join(" · ")}</small>
                  <FichaImpressa pessoa={pessoa} hoje={lista.hoje} dm={dm} />
                </td>
                <td className="fe-ti-trilha">
                  <div className="fe-ti-pista" style={{ width: eixo.largura }}>
                    {grade}
                    {pessoa.periodos.map((p) => <Janela key={p.aquisitivoInicio} eixo={eixo} periodo={p} dm={dm} />)}
                    {pessoa.periodos.map((p) => {
                      const r = p.solicitacao ? retangulo(eixo, p.solicitacao.inicio, p.solicitacao.fim) : null;
                      return r && <span key={`pedido-${p.aquisitivoInicio}`} className="fe-ti-pedido" style={{ left: r.x, width: Math.max(r.largura, 3) }}>{r.largura >= 56 ? "pediu" : ""}</span>;
                    })}
                    {pessoa.periodos.flatMap((p) => p.programacoes.map((g) => {
                      if (!g.gozoInicio || !g.gozoFim) return null;
                      const r = retangulo(eixo, g.gozoInicio, g.gozoFim);
                      if (!r) return null;
                      const gozada = g.status === "GOZADA";
                      const texto = r.largura >= 70 ? `${dm(g.gozoInicio)}–${dm(g.gozoFim)}` : r.largura >= 34 ? dm(g.gozoInicio) : r.largura >= 18 ? `${g.dias}d` : "";
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

function Janela({ eixo, periodo: p, dm }: { eixo: Eixo; periodo: PeriodoFerias; dm: (iso: string) => string }) {
  // Em aquisição não tem o que decidir ainda: nada é desenhado (a faixa tracejada só atrapalhava a leitura).
  if (p.situacao === "GOZADA" || p.situacao === "EM_AQUISICAO") return null;
  const limite = p.diasPendentes > 0 && !p.doHistorico ? retangulo(eixo, p.limiteInicioGozo, p.limiteInicioGozo) : null;
  return (
    <>
      {zonasDaJanela(p).map((z) => {
        const r = retangulo(eixo, z.inicio, z.fim);
        return r ? <span key={z.tom} className={`fe-ti-zona fe-ti-zona--${z.tom}`} style={{ left: r.x, width: r.largura }} /> : null;
      })}
      {limite && <span className="fe-ti-limite" style={{ left: limite.x + limite.largura }} title={`Prazo limite para começar: ${dataBr(p.limiteInicioGozo)}`} />}
      {limite && <span className={`fe-ti-limite-tag${limite.x + limite.largura < 64 ? " fe-ti-limite-tag--direita" : ""}`} style={{ left: limite.x + limite.largura }}>limite {dm(p.limiteInicioGozo)}</span>}
    </>
  );
}

// ── Lista ──────────────────────────────────────────────────────────────────────────

type PropsLista = Comum & { linhas: LinhaFerias[] };

export function FolhaTelaLista(props: PropsLista) {
  const { linhas, opcoes } = props;
  const util = larguraUtilPx(opcoes);
  return (
    <div className="fe-ti" style={{ width: util, "--e": escalaDaLetra(opcoes.letra) } as React.CSSProperties}>
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

/** Pediu / Empresa quer / Limite / Próximo passo: o que falta para decidir, ao lado do nome. */
function FichaImpressa({ pessoa, hoje, dm }: { pessoa: PessoaFerias; hoje: string; dm: (iso: string) => string }) {
  const periodo = periodoDaFicha(pessoa);
  if (!periodo) return null;
  const pendente = periodo.diasPendentes > 0 && periodo.situacao !== "EM_AQUISICAO" && !periodo.doHistorico;
  const pedido = periodo.solicitacao ?? null;
  const comparacao = compararPedido(periodo);
  const empresa = periodo.programacoes.filter((g) => g.gozoInicio !== null);
  const passo = proximoPasso(periodo, hoje);
  const trecho = (inicio: string, fim: string | null, dias: number, abono: number) => `${dm(inicio)} a ${dm(fim ?? inicio)} · ${dias} d${abono > 0 ? ` + abono ${abono}` : ""}`;
  return (
    <ul className="fe-ti-ficha">
      {(pedido || pendente) && (
        <li><b>Pediu</b> {pedido ? trecho(pedido.inicio, pedido.fim, pedido.dias, pedido.diasAbono) : <span className="fe-ti-mudo">sem pedido</span>}</li>
      )}
      {(empresa.length > 0 || pendente) && (
        <li><b>Empresa quer</b> {empresa.length > 0
          ? empresa.map((g) => `${g.status === "GOZADA" ? "✓ " : ""}${trecho(g.gozoInicio as string, g.gozoFim, g.dias, g.diasAbono)}`).join("; ")
          : <span className="fe-ti-mudo">ainda sem data</span>}</li>
      )}
      {pendente && <li><b>Limite</b> começar até {dm(periodo.limiteInicioGozo)}</li>}
      {comparacao && (
        <li className={`fe-ti-situacao fe-ti-situacao--${comparacao.situacao.toLowerCase()}`}>
          {ROTULO_DA_SITUACAO_DO_PEDIDO[comparacao.situacao]}
          {comparacao.situacao === "DIFERENTE" && diferencaEmPalavras(comparacao.diferencaEmDias) ? ` (${diferencaEmPalavras(comparacao.diferencaEmDias)})` : ""}
          {comparacao.passaDoPrazo ? " · passa do prazo" : ""}
        </li>
      )}
      {passo && <li className={`fe-ti-passo${passo.urgente ? " fe-ti-passo--urgente" : ""}`}>→ {passo.texto}</li>}
    </ul>
  );
}
