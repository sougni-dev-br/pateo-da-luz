import type { PlanejamentoCaixaPremissas, PlanejamentoFormaDePagamento } from "../../api/client";
import { Alert, Table } from "../../design-system";
import { CampoNumerico } from "./CampoNumerico";
import { mixFecha, somaDoMix } from "./caixa";
import { NOMES_DOS_MESES_CURTOS, percentualParaTexto, reaisParaTexto, ROTULO_DA_FORMA, textoParaDias, textoParaPercentual, textoParaReais } from "./formato";

// Premissas do regime de caixa: quando o dinheiro entra (forma de pagamento, prazo, taxa), quando as compras são pagas
// e o que vem de antes do ano. Os valores de partida são SUPOSIÇÕES: ajuste com os da maquininha e do financeiro.

const PRAZO_MAXIMO_EM_DIAS = 90;
const dentroDoPercentual = (v: number) => v >= 0 && v <= 1;
const taxaValida = (v: number) => v >= 0 && v <= 0.2;
const VALOR_MAXIMO_EM_REAIS = 1_000_000_000;
const dentroDoReal = (v: number) => v >= 0 && v <= VALOR_MAXIMO_EM_REAIS;
const MESES_HERDADOS = 3;

type Props = { caixa: PlanejamentoCaixaPremissas; desabilitado: boolean; onMudar: (proximo: PlanejamentoCaixaPremissas) => void };

export function CaixaEditor({ caixa, desabilitado, onMudar }: Props) {
  const mudarForma = (indice: number, campo: keyof Omit<PlanejamentoFormaDePagamento, "forma">, valor: number | null) =>
    onMudar({ ...caixa, formas: caixa.formas.map((f, i) => (i === indice ? { ...f, [campo]: valor ?? 0 } : f)) });
  const mudarHerdado = (lado: "entradas" | "saidas", mes: number, valor: number | null) =>
    onMudar({ ...caixa, herdado: { ...caixa.herdado, [lado]: caixa.herdado[lado].map((v, i) => (i === mes ? valor ?? 0 : v)) } });

  const soma = somaDoMix(caixa);

  return (
    <div className="plan-gastos">
      <div className="plan-servico">
        <span className="plan-servico-rotulo">Caixa no começo de janeiro (R$)</span>
        <CampoNumerico valor={caixa.saldoInicial} rotulo="Caixa no começo de janeiro" desabilitado={desabilitado} interpretar={textoParaReais} formatar={reaisParaTexto} valido={dentroDoReal} largura={110} onMudar={(v) => onMudar({ ...caixa, saldoInicial: v ?? 0 })} />
        <span className="plan-servico-rotulo">Prazo de pagamento das compras (dias)</span>
        <CampoNumerico valor={caixa.comprasPrazoDias} rotulo="Prazo de pagamento das compras, em dias" desabilitado={desabilitado} interpretar={textoParaDias} formatar={String} valido={(v) => v >= 0 && v <= PRAZO_MAXIMO_EM_DIAS} largura={64} onMudar={(v) => onMudar({ ...caixa, comprasPrazoDias: v ?? 0 })} />
      </div>

      <div className="plan-quadro plan-quadro-estreito">
        <Table aria-label="Formas de pagamento das vendas do Salão">
          <Table.Head>
            <Table.Row>
              <Table.Th scope="col">Forma</Table.Th>
              <Table.Th align="right" title="Parte das vendas recebida nessa forma">Mix %</Table.Th>
              <Table.Th align="right" title="Dias entre a venda e o dinheiro na conta">Prazo (dias)</Table.Th>
              <Table.Th align="right" title="Taxa descontada do que se recebe">Taxa %</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {caixa.formas.map((f, i) => (
              <Table.Row key={f.forma}>
                <Table.Th scope="row">{ROTULO_DA_FORMA[f.forma]}</Table.Th>
                <Table.Td align="right"><CampoNumerico valor={f.mix} rotulo={`${ROTULO_DA_FORMA[f.forma]}, mix em %`} desabilitado={desabilitado} interpretar={textoParaPercentual} formatar={percentualParaTexto} valido={dentroDoPercentual} onMudar={(v) => mudarForma(i, "mix", v)} /></Table.Td>
                <Table.Td align="right"><CampoNumerico valor={f.prazoDias} rotulo={`${ROTULO_DA_FORMA[f.forma]}, prazo em dias`} desabilitado={desabilitado} interpretar={textoParaDias} formatar={String} valido={(v) => v >= 0 && v <= PRAZO_MAXIMO_EM_DIAS} onMudar={(v) => mudarForma(i, "prazoDias", v)} /></Table.Td>
                <Table.Td align="right"><CampoNumerico valor={f.taxa} rotulo={`${ROTULO_DA_FORMA[f.forma]}, taxa em %`} desabilitado={desabilitado} interpretar={textoParaPercentual} formatar={percentualParaTexto} valido={taxaValida} onMudar={(v) => mudarForma(i, "taxa", v)} /></Table.Td>
              </Table.Row>
            ))}
            <Table.Row className="plan-linha-todos">
              <Table.Th scope="row">Soma do mix</Table.Th>
              <Table.Td align="right" className={mixFecha(caixa) ? undefined : "plan-var-desce"}>{percentualParaTexto(soma)}%</Table.Td>
              <Table.Td />
              <Table.Td />
            </Table.Row>
          </Table.Body>
        </Table>
      </div>
      {!mixFecha(caixa) && <Alert tone="warning">O mix das formas de pagamento precisa somar 100%. Enquanto não fechar, o resultado de caixa não é recalculado e o cenário não pode ser salvo.</Alert>}

      <p className="plan-sub">Vindo do ano anterior, a cair nos primeiros meses (recebíveis e contas a pagar de novembro e dezembro, por exemplo):</p>
      <div className="plan-quadro plan-quadro-estreito">
        <Table aria-label="Valores herdados do ano anterior">
          <Table.Head>
            <Table.Row>
              <Table.Th scope="col">Herdado</Table.Th>
              {NOMES_DOS_MESES_CURTOS.slice(0, MESES_HERDADOS).map((m) => <Table.Th key={m} align="right">{m}</Table.Th>)}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {(["entradas", "saidas"] as const).map((lado) => (
              <Table.Row key={lado}>
                <Table.Th scope="row">{lado === "entradas" ? "A receber (R$)" : "A pagar (R$)"}</Table.Th>
                {caixa.herdado[lado].map((valor, mes) => (
                  <Table.Td key={mes} align="right">
                    <CampoNumerico valor={valor} rotulo={`${lado === "entradas" ? "A receber" : "A pagar"} herdado em ${NOMES_DOS_MESES_CURTOS[mes]}`} desabilitado={desabilitado} interpretar={textoParaReais} formatar={reaisParaTexto} valido={dentroDoReal} largura={100} onMudar={(v) => mudarHerdado(lado, mes, v)} />
                  </Table.Td>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </div>
  );
}
