import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { PlanejamentoLinhaDeGasto, PlanejamentoProjecao, PlanejamentoResultado } from "../../api/client";
import { IconButton, Table } from "../../design-system";
import { CampoNumerico } from "./CampoNumerico";
import { NOMES_DOS_MESES_CURTOS, percentualParaTexto, reaisParaTexto, ROTULO_DO_GRUPO, textoParaPercentual, textoParaReais } from "./formato";
import { PesoNaMargem, ReferenciaDoAnoBase, type RealizadoDoAnoBase } from "./gastosLeitura";
import { Quadro } from "./Quadro";
import { emMil, Reais } from "./Reais";
import { useOculto } from "./useOculto";

// As linhas de gasto em duas formas. No computador, uma planilha de meio ano por vez (Jan–Jun | Jul–Dez): cabe sem
// rolar e o rodapé soma os gastos do mês contra a margem bruta. No celular e no tablet, um cartão por linha, com os
// 12 meses numa grade rotulada: todos os campos à vista e editáveis com o toque e com Tab.

const VALOR_MAXIMO_EM_REAIS = 1_000_000_000;
const dentroDoReal = (v: number) => v >= 0 && v <= VALOR_MAXIMO_EM_REAIS;
const dentroDoPercentual = (v: number) => v >= 0 && v <= 1;
const LARGURA_DO_CAMPO = 84;
const SEMESTRES = [{ rotulo: "Jan–Jun", meses: [0, 1, 2, 3, 4, 5] }, { rotulo: "Jul–Dez", meses: [6, 7, 8, 9, 10, 11] }] as const;

export type PropsDasLinhas = {
  anoBase: number;
  gastos: PlanejamentoLinhaDeGasto[];
  desabilitado: boolean;
  projecao?: PlanejamentoProjecao | null;
  resultado?: PlanejamentoResultado | null;
  realizado?: RealizadoDoAnoBase;
  onMudarLinha: (indice: number, mes: number | "todos", valor: number | null) => void;
  onMudarPago: (indice: number, valor: number | null) => void;
  onRemover: (indice: number) => void;
};

const valorComum = (g: PlanejamentoLinhaDeGasto): number | null => (g.valores.every((v) => v === g.valores[0]) ? g.valores[0] : null);

function CampoDoGasto({ linha, valor, rotulo, largura = LARGURA_DO_CAMPO, desabilitado, onMudar }: { linha: PlanejamentoLinhaDeGasto; valor: number | null; rotulo: string; largura?: number | string; desabilitado: boolean; onMudar: (v: number | null) => void }) {
  const percentual = linha.modo === "PERCENTUAL";
  return (
    <CampoNumerico
      valor={valor}
      rotulo={rotulo}
      desabilitado={desabilitado}
      interpretar={percentual ? textoParaPercentual : textoParaReais}
      formatar={percentual ? percentualParaTexto : reaisParaTexto}
      valido={percentual ? dentroDoPercentual : dentroDoReal}
      largura={largura}
      onMudar={onMudar}
    />
  );
}

function CampoDoPago({ linha, desabilitado, largura = 72, onMudar }: { linha: PlanejamentoLinhaDeGasto; desabilitado: boolean; largura?: number | string; onMudar: (v: number | null) => void }) {
  return <CampoNumerico valor={linha.pagoNoMes} rotulo={`${linha.nome}, % pago no mês`} desabilitado={desabilitado} interpretar={textoParaPercentual} formatar={percentualParaTexto} valido={dentroDoPercentual} largura={largura} onMudar={onMudar} />;
}

function TotalDoAno({ linha }: { linha: PlanejamentoLinhaDeGasto }) {
  if (linha.modo === "PERCENTUAL") {
    const media = linha.valores.reduce((s, v) => s + v, 0) / 12;
    return <span className="plan-total-linha"><span className="plan-total-rotulo">média</span> {percentualParaTexto(media)}%</span>;
  }
  return <span className="plan-total-linha"><Reais valor={linha.valores.reduce((s, v) => s + v, 0)} moeda={false} /></span>;
}

function Identificacao({ linha, indice, props }: { linha: PlanejamentoLinhaDeGasto; indice: number; props: PropsDasLinhas }) {
  const percentual = linha.modo === "PERCENTUAL";
  const grupo = linha.nome === ROTULO_DO_GRUPO[linha.grupo] ? "" : `${ROTULO_DO_GRUPO[linha.grupo]} · `;
  return (
    <span className="plan-gasto-nome">
      <span className="plan-gasto-titulo">{linha.nome}</span>
      <span className="plan-gasto-meta">{grupo}{percentual ? "% das vendas" : "R$ por mês"}</span>
      <PesoNaMargem linha={linha} projecao={props.projecao} />
      <ReferenciaDoAnoBase linha={linha} indice={indice} gastos={props.gastos} anoBase={props.anoBase} realizado={props.realizado} />
    </span>
  );
}

function Remover({ linha, indice, props }: { linha: PlanejamentoLinhaDeGasto; indice: number; props: PropsDasLinhas }) {
  if (props.desabilitado) return null;
  return <IconButton variant="danger" size="md" className="plan-remover" icon={<Trash2 size={15} aria-hidden />} label={`Remover ${linha.nome}`} onClick={() => props.onRemover(indice)} />;
}

/** Gastos do mês (do cálculo do servidor) contra a margem bruta do mês: o mês em que os gastos passam a margem fica vermelho. */
function RodapeDoMes({ mes, projecao, resultado, comMargem = true }: { mes: number; projecao?: PlanejamentoProjecao | null; resultado?: PlanejamentoResultado | null; comMargem?: boolean }) {
  const hidden = useOculto();
  const gastos = resultado?.meses[mes]?.gastosTotal ?? null;
  const margem = projecao?.meses[mes]?.margemBruta ?? null;
  if (gastos === null) return <span className="plan-sem-base-curto">sem base</span>;
  const passa = margem !== null && gastos > margem;
  return (
    <span className={`plan-total-mes${passa ? " plan-total-mes-passa" : ""}`}>
      <Reais valor={gastos} moeda={false} />
      {comMargem && margem !== null && <span className="plan-total-mes-margem">margem {hidden ? "••••" : emMil(margem)}</span>}
    </span>
  );
}

export function GastosTabela(props: PropsDasLinhas) {
  const { gastos, desabilitado, projecao, resultado, onMudarLinha, onMudarPago } = props;
  const [semestre, setSemestre] = useState(0);
  const meses = SEMESTRES[semestre].meses;
  const colunas = 4 + meses.length;
  return (
    <div className="plan-gastos-planilha">
      <div className="plan-semestres" role="group" aria-label="Meses à vista na tabela de gastos">
        <span className="plan-semestres-rotulo">Mostrando {SEMESTRES[semestre].rotulo} · 6 de 12 meses</span>
        {SEMESTRES.map((s, i) => (
          <button key={s.rotulo} type="button" className="plan-semestre" aria-pressed={semestre === i} onClick={() => setSemestre(i)}>{s.rotulo}</button>
        ))}
      </div>
      <Quadro rotulo={`Gastos do cenário, ${SEMESTRES[semestre].rotulo}`} editavel className="plan-quadro-gastos">
        <Table aria-label={`Gastos do cenário por mês, ${SEMESTRES[semestre].rotulo}`}>
          <Table.Head>
            <Table.Row>
              <Table.Th scope="col" className="plan-col-rotulo plan-col-gasto">Gasto</Table.Th>
              <Table.Th align="right" title="Parte do gasto paga no mês do gasto (regime de caixa); o resto sai no mês seguinte">Pago no mês %</Table.Th>
              <Table.Th align="right">Todos</Table.Th>
              {meses.map((m) => <Table.Th key={m} align="right">{NOMES_DOS_MESES_CURTOS[m]}</Table.Th>)}
              <Table.Th align="right" className="plan-col-total-ano">Total do ano</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {gastos.length === 0 && (
              <Table.Row>
                <Table.Td colSpan={colunas} className="plan-celula-vazia">Nenhuma linha de gasto: sem gastos o lucro fica igual à margem bruta. Use as linhas padrão ou o realizado de {props.anoBase}.</Table.Td>
              </Table.Row>
            )}
            {gastos.map((g, i) => (
              <Table.Row key={g.nome}>
                <Table.Th scope="row" className="plan-col-rotulo plan-col-gasto">
                  <span className="plan-gasto-celula"><Identificacao linha={g} indice={i} props={props} /><Remover linha={g} indice={i} props={props} /></span>
                </Table.Th>
                <Table.Td align="right"><CampoDoPago linha={g} desabilitado={desabilitado} onMudar={(v) => onMudarPago(i, v)} /></Table.Td>
                <Table.Td align="right"><CampoDoGasto linha={g} valor={valorComum(g)} rotulo={`${g.nome}, todos os meses`} desabilitado={desabilitado} onMudar={(v) => onMudarLinha(i, "todos", v)} /></Table.Td>
                {meses.map((m) => (
                  <Table.Td key={m} align="right"><CampoDoGasto linha={g} valor={g.valores[m]} rotulo={`${g.nome} em ${NOMES_DOS_MESES_CURTOS[m]}`} desabilitado={desabilitado} onMudar={(v) => onMudarLinha(i, m, v)} /></Table.Td>
                ))}
                <Table.Td align="right" className="plan-col-total-ano"><TotalDoAno linha={g} /></Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
          {gastos.length > 0 && resultado && (
            <tfoot>
              <Table.Row>
                <Table.Th scope="row" className="plan-col-rotulo plan-col-gasto">Gastos do mês<span className="plan-gasto-meta">% das vendas já em R$; vermelho = passa a margem</span></Table.Th>
                <Table.Td />
                <Table.Td />
                {meses.map((m) => <Table.Td key={m} align="right"><RodapeDoMes mes={m} projecao={projecao} resultado={resultado} comMargem={false} /></Table.Td>)}
                <Table.Td align="right" className="plan-col-total-ano"><Reais valor={resultado.total.gastosTotal} moeda={false} /><span className="plan-total-mes-margem">meses com base</span></Table.Td>
              </Table.Row>
              <Table.Row className="plan-linha-margem">
                <Table.Th scope="row" className="plan-col-rotulo plan-col-gasto">Margem bruta do mês<span className="plan-gasto-meta">vendas − CMV, para comparar</span></Table.Th>
                <Table.Td />
                <Table.Td />
                {meses.map((m) => <Table.Td key={m} align="right"><Reais valor={projecao?.meses[m]?.margemBruta ?? null} moeda={false} /></Table.Td>)}
                <Table.Td align="right" className="plan-col-total-ano"><Reais valor={projecao?.total.margemBruta ?? null} moeda={false} /></Table.Td>
              </Table.Row>
            </tfoot>
          )}
        </Table>
      </Quadro>
    </div>
  );
}

/** Os 12 meses do cartão. Quando todos são iguais ("Todos" já diz o valor), a grade abre recolhida para o cartão caber;
 * a estrutura não muda ao digitar (o campo em edição não perde o foco). */
function MesesDoCartao({ linha, indice, desabilitado, onMudarLinha }: { linha: PlanejamentoLinhaDeGasto; indice: number; desabilitado: boolean; onMudarLinha: PropsDasLinhas["onMudarLinha"] }) {
  const iguais = valorComum(linha) !== null;
  const [aberto, setAberto] = useState(!iguais);
  const grade = (
    <div className="plan-gasto-meses" role="group" aria-label={`${linha.nome}, mês a mês${linha.modo === "PERCENTUAL" ? " (em % das vendas)" : " (em R$)"}`}>
      {linha.valores.map((valor, m) => (
        <label key={m} className="plan-mes-campo">
          <span>{NOMES_DOS_MESES_CURTOS[m]}</span>
          <CampoDoGasto linha={linha} valor={valor} rotulo={`${linha.nome} em ${NOMES_DOS_MESES_CURTOS[m]}`} largura="100%" desabilitado={desabilitado} onMudar={(v) => onMudarLinha(indice, m, v)} />
        </label>
      ))}
    </div>
  );
  return (
    <details className="plan-gasto-meses-recolhidos" open={aberto} onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary>{aberto ? "Esconder os meses" : "Ajustar mês a mês"} <span className="plan-gasto-meta">{iguais ? "os 12 meses estão iguais" : "há meses diferentes"}</span></summary>
      {grade}
    </details>
  );
}

export function GastosCartoes(props: PropsDasLinhas) {
  const { gastos, desabilitado, projecao, resultado, onMudarLinha, onMudarPago } = props;
  if (gastos.length === 0) {
    return <p className="plan-celula-vazia plan-gastos-vazio">Nenhuma linha de gasto: sem gastos o lucro fica igual à margem bruta. Use as linhas padrão ou o realizado de {props.anoBase}.</p>;
  }
  return (
    <div className="plan-gastos-cartoes">
      <ul className="plan-gasto-lista" aria-label="Gastos do cenário">
        {gastos.map((g, i) => (
          <li key={g.nome} className="plan-gasto-cartao">
            <div className="plan-gasto-cartao-topo">
              <Identificacao linha={g} indice={i} props={props} />
              <span className="plan-gasto-cartao-total"><span className="plan-total-rotulo">{g.modo === "PERCENTUAL" ? "no ano" : "total do ano"}</span><TotalDoAno linha={g} /></span>
              <Remover linha={g} indice={i} props={props} />
            </div>
            <div className="plan-gasto-cartao-atalhos">
              <label className="plan-mes-campo plan-mes-campo-todos">
                <span>Todos os meses</span>
                <CampoDoGasto linha={g} valor={valorComum(g)} rotulo={`${g.nome}, todos os meses`} largura="100%" desabilitado={desabilitado} onMudar={(v) => onMudarLinha(i, "todos", v)} />
              </label>
              <label className="plan-mes-campo">
                <span>Pago no mês %</span>
                <CampoDoPago linha={g} desabilitado={desabilitado} largura="100%" onMudar={(v) => onMudarPago(i, v)} />
              </label>
            </div>
            <MesesDoCartao linha={g} indice={i} desabilitado={desabilitado} onMudarLinha={onMudarLinha} />
          </li>
        ))}
      </ul>
      {resultado && (
        <section className="plan-gasto-cartao plan-gasto-cartao-soma" aria-labelledby="plan-gastos-do-mes">
          <h3 id="plan-gastos-do-mes" className="plan-subtitulo">Gastos do mês <span className="plan-gasto-meta">vermelho = passa a margem bruta</span></h3>
          <dl className="plan-gasto-meses">
            {NOMES_DOS_MESES_CURTOS.map((nome, m) => (
              <div key={nome} className="plan-mes-campo"><dt>{nome}</dt><dd><RodapeDoMes mes={m} projecao={projecao} resultado={resultado} /></dd></div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
