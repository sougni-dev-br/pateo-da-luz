import type { CSSProperties, ReactNode } from "react";
import type { PlanejamentoCaixaPremissas, PlanejamentoLinhaDeGasto } from "../../api/client";
import { mixFecha } from "./caixa";
import { percentualParaTexto, ROTULO_DA_FORMA } from "./formato";
import { DIAS_DO_MES, entradasDosMesesSeguintes, ladoDoRotulo, lerPrazos, pagoNoMesMedio } from "./regua";

// Régua de prazo: quando o dinheiro entra (vendas, por forma) e quando sai (compras e gastos). O comprimento da faixa
// é a espera em dias; nas entradas a espessura é o peso no mix, então a área é o dinheiro parado. Abaixo do eixo, as
// saídas na mesma escala: dá para ver se o caixa recebe antes ou depois de pagar. Redesenha a cada número digitado.

const ESPESSURA_MINIMA = 0.12;
const ESPESSURA_DA_SAIDA = 0.55;
const PASSO_DAS_MARCAS = 15;

const pct = (f: number) => `${percentualParaTexto(f)}%`;
const dias = (n: number) => (n === 0 ? "no dia" : n === 1 ? "1 dia" : `${n} dias`);
const diasDecimais = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
/** Leitura do resumo em pontos inteiros: "80%", não "80,43%". */
const pctInteiro = (f: number) => `${Math.round(f * 100)}%`;

function juntar(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

type Faixa = { chave: string; classe: string; nome: ReactNode; valor: string; posicao: number; espessura: number; rotulo: string; leitor: string; vazia?: boolean };

function Linha({ faixa, marcas, escala }: { faixa: Faixa; marcas: number[]; escala: number }) {
  const estilo = { "--plan-regua-x": faixa.posicao, "--plan-regua-y": faixa.espessura } as CSSProperties;
  return (
    <li className={`plan-regua-linha ${faixa.classe}${faixa.vazia ? " plan-regua-vazia" : ""}`} style={estilo}>
      <span className="plan-regua-nome">{faixa.nome}<strong className="plan-regua-mix">{faixa.valor}</strong></span>
      <span className="plan-regua-trilho" aria-hidden>
        {marcas.map((d) => <span key={d} className="plan-regua-grade" style={{ left: `${(d / escala) * 100}%` }} />)}
        <span className="plan-regua-espera" />
        <span className={`plan-regua-chegada plan-regua-rotulo-${ladoDoRotulo(faixa.posicao)}`}><span className="plan-regua-ponto" /><span className="plan-regua-dias">{faixa.rotulo}</span></span>
      </span>
      <span className="plan-sr">{faixa.leitor}</span>
    </li>
  );
}

type Props = { caixa: PlanejamentoCaixaPremissas; gastos?: readonly PlanejamentoLinhaDeGasto[]; /** Mix e prazos ainda são os de partida (suposição): a régua avisa. */ valoresDePartida?: boolean };

export function ReguaDoPrazo({ caixa, gastos = [], valoresDePartida = false }: Props) {
  const leitura = lerPrazos(caixa);
  const fecha = mixFecha(caixa);
  const { escala } = leitura;
  const marcas = Array.from({ length: escala / PASSO_DAS_MARCAS + 1 }, (_, i) => i * PASSO_DAS_MARCAS);
  const maior = Math.max(0.0001, ...caixa.formas.map((f) => f.mix));
  const diferenca = 1 - leitura.soma;
  const seguintes = entradasDosMesesSeguintes(leitura.porMes);
  const variosMeses = leitura.alemDoSeguinte >= 0.005;
  const pagoNoMes = pagoNoMesMedio(gastos);
  const esperaDosGastos = pagoNoMes === null ? null : (1 - pagoNoMes) * DIAS_DO_MES;

  const entradas: Faixa[] = caixa.formas.map((f) => ({
    chave: f.forma,
    classe: `plan-regua-${f.forma.toLowerCase()}`,
    nome: <><span className={`plan-mix-ponto plan-mix-${f.forma.toLowerCase()}`} aria-hidden />{ROTULO_DA_FORMA[f.forma]}</>,
    valor: pct(f.mix),
    posicao: f.prazoDias / escala,
    espessura: ESPESSURA_MINIMA + (1 - ESPESSURA_MINIMA) * (f.mix / maior),
    rotulo: dias(f.prazoDias),
    leitor: `: ${pct(f.mix)} das vendas, entra ${f.prazoDias === 0 ? "no dia da venda" : `${dias(f.prazoDias)} depois da venda`}${f.taxa > 0 ? `, taxa de ${pct(f.taxa)}` : ""}.`,
    vazia: f.mix === 0
  }));
  const saidas: Faixa[] = [
    {
      chave: "compras", classe: "plan-regua-saida plan-regua-compras", nome: "Compras", valor: "",
      posicao: caixa.comprasPrazoDias / escala, espessura: ESPESSURA_DA_SAIDA, rotulo: dias(caixa.comprasPrazoDias),
      leitor: `: as compras de insumos são pagas ${caixa.comprasPrazoDias === 0 ? "no dia" : `${dias(caixa.comprasPrazoDias)} depois`}.`
    },
    ...(pagoNoMes !== null && esperaDosGastos !== null ? [{
      chave: "gastos", classe: "plan-regua-saida plan-regua-gastos", nome: "Gastos", valor: "",
      posicao: esperaDosGastos / escala, espessura: ESPESSURA_DA_SAIDA, rotulo: `${pctInteiro(pagoNoMes)} no mês`,
      leitor: `: ${pctInteiro(pagoNoMes)} dos gastos fixos saem no próprio mês; o resto no mês seguinte.`
    }] : [])
  ];

  const recebeAntes = leitura.prazoMedio < caixa.comprasPrazoDias - 0.5;
  const pagaAntes = leitura.prazoMedio > caixa.comprasPrazoDias + 0.5;

  return (
    <figure id="plan-regua" tabIndex={-1} className={`plan-regua${fecha ? "" : " plan-regua-aberta"}`} aria-labelledby="plan-regua-titulo">
      <figcaption className="plan-regua-cabecalho">
        <span id="plan-regua-titulo" className="plan-regua-titulo">Quando o dinheiro entra e sai</span>
        {valoresDePartida && <span className="plan-regua-partida">com valores de partida (suposição)</span>}
        <span className="plan-regua-legenda">comprimento = dias de espera · espessura = peso no mix</span>
      </figcaption>
      {!fecha && (
        <p className="plan-regua-erro" role="alert">
          O mix soma {pct(leitura.soma)}: {diferenca > 0 ? `faltam ${percentualParaTexto(diferenca)}` : `sobram ${percentualParaTexto(-diferenca)}`} pontos para fechar 100%. Enquanto não fechar, o caixa não é recalculado e o cenário não pode ser salvo; a régua fica proporcional até lá.
        </p>
      )}

      <div className="plan-regua-corpo">
        <div className="plan-regua-eixo" aria-hidden>
          <span className="plan-regua-grupo">Entradas</span>
          <span className="plan-regua-marcas">
            {marcas.map((d) => (
              <span key={d} className="plan-regua-marca" style={{ left: `${(d / escala) * 100}%` }}>{d === 0 ? "venda" : `${d} d`}</span>
            ))}
          </span>
        </div>
        <ul className="plan-regua-linhas" aria-label="Entradas: vendas por forma de pagamento">
          {entradas.map((f) => <Linha key={f.chave} faixa={f} marcas={marcas} escala={escala} />)}
        </ul>
        <p className="plan-regua-grupo plan-regua-grupo-saidas" aria-hidden>Saídas</p>
        <ul className="plan-regua-linhas plan-regua-linhas-saidas" aria-label="Saídas: compras e gastos">
          {saidas.map((f) => <Linha key={f.chave} faixa={f} marcas={marcas} escala={escala} />)}
        </ul>
      </div>

      <dl className="plan-regua-resumo">
        <div><dt>Entra em até 1 dia</dt><dd>{pctInteiro(leitura.imediato)}</dd></div>
        <div><dt>Prazo médio de recebimento</dt><dd>{diasDecimais(leitura.prazoMedio)}</dd></div>
        <div className="plan-regua-resumo-forte"><dt>{variosMeses ? "Fica para os meses seguintes" : "Fica para o mês seguinte"}</dt><dd>{pctInteiro(leitura.foraDoMes)}</dd></div>
        <div><dt>Taxa média</dt><dd>{pct(leitura.taxaMedia)}</dd></div>
      </dl>
      {fecha && (
        <p className="plan-regua-frase" aria-live="polite">
          De cada R$ 100 vendidos num mês, {seguintes.length === 0
            ? <>tudo entra no caixa do próprio mês.</>
            : variosMeses
              ? <>cerca de <strong>R$ {Math.round(leitura.foraDoMes * 100)}</strong> só entram nos meses seguintes: {juntar(seguintes.map((s) => `R$ ${s.reais} ${s.quando}`))}.</>
              : <>cerca de <strong>R$ {Math.round(leitura.foraDoMes * 100)}</strong> só entram no caixa do mês seguinte.</>}
          {leitura.taxaMedia > 0 ? <> A maquininha fica com R$ {(leitura.taxaMedia * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}.</> : null}
          {" "}Na saída, as compras são pagas em {dias(caixa.comprasPrazoDias)}{pagoNoMes !== null ? <> e {pctInteiro(pagoNoMes)} dos gastos fixos saem no próprio mês</> : null}
          {recebeAntes ? ": o dinheiro das vendas chega, em média, antes de pagar as compras." : pagaAntes ? ": as compras vencem, em média, antes de o dinheiro das vendas chegar." : ": recebimento e pagamento das compras andam juntos."}
        </p>
      )}
    </figure>
  );
}
