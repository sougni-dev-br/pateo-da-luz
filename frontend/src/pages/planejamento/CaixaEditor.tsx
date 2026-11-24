import type { PlanejamentoCaixaPremissas, PlanejamentoFormaDePagamento, PlanejamentoLinhaDeGasto } from "../../api/client";
import { Table } from "../../design-system";
import { CampoNumerico } from "./CampoNumerico";
import { mixFecha, somaDoMix } from "./caixa";
import { ReguaDoPrazo } from "./ReguaDoPrazo";
import { useLargura } from "./useLargura";
import { NOMES_DOS_MESES_CURTOS, percentualParaTexto, reaisParaTexto, ROTULO_DA_FORMA, textoParaDias, textoParaPercentual, textoParaReais } from "./formato";
import { Quadro } from "./Quadro";

// Premissas do regime de caixa: quando o dinheiro entra (forma de pagamento, prazo, taxa), quando as compras são pagas
// e o que vem de antes do ano. Os valores de partida são SUPOSIÇÕES: ajuste com os da maquininha e do financeiro.

const PRAZO_MAXIMO_EM_DIAS = 90;
const dentroDoPercentual = (v: number) => v >= 0 && v <= 1;
const taxaValida = (v: number) => v >= 0 && v <= 0.2;
const VALOR_MAXIMO_EM_REAIS = 1_000_000_000;
const dentroDoReal = (v: number) => v >= 0 && v <= VALOR_MAXIMO_EM_REAIS;
const MESES_HERDADOS = 3;
/** Abaixo disso as tabelas de formas e de herdado viram cartões (celular). */
const LARGURA_DAS_TABELAS = 600;
/** A partir disso a régua de prazo fica ao lado da tabela das formas, para reagir à vista enquanto se digita. */
const LARGURA_LADO_A_LADO = 1040;

type Props = {
  caixa: PlanejamentoCaixaPremissas;
  desabilitado: boolean;
  onMudar: (proximo: PlanejamentoCaixaPremissas) => void;
  /** Gastos do cenário: a régua mostra quanto deles sai no próprio mês, ao lado das entradas. */
  gastos?: readonly PlanejamentoLinhaDeGasto[];
};

type CampoDaForma = { campo: keyof Omit<PlanejamentoFormaDePagamento, "forma">; rotulo: string; sufixo: string };
const CAMPOS_DA_FORMA: CampoDaForma[] = [
  { campo: "mix", rotulo: "Mix", sufixo: "mix em %" },
  { campo: "prazoDias", rotulo: "Prazo", sufixo: "prazo em dias" },
  { campo: "taxa", rotulo: "Taxa", sufixo: "taxa em %" }
];

export function CaixaEditor({ caixa, desabilitado, onMudar, gastos = [] }: Props) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const cartoes = largura < LARGURA_DAS_TABELAS;
  const mudarForma = (indice: number, campo: keyof Omit<PlanejamentoFormaDePagamento, "forma">, valor: number | null) =>
    onMudar({ ...caixa, formas: caixa.formas.map((f, i) => (i === indice ? { ...f, [campo]: valor ?? 0 } : f)) });
  const mudarHerdado = (lado: "entradas" | "saidas", mes: number, valor: number | null) =>
    onMudar({ ...caixa, herdado: { ...caixa.herdado, [lado]: caixa.herdado[lado].map((v, i) => (i === mes ? valor ?? 0 : v)) } });

  const soma = somaDoMix(caixa);

  const campoDaForma = (f: PlanejamentoFormaDePagamento, i: number, campo: CampoDaForma["campo"], largura?: number | string) => {
    const nome = `${ROTULO_DA_FORMA[f.forma]}, ${CAMPOS_DA_FORMA.find((c) => c.campo === campo)?.sufixo ?? campo}`;
    if (campo === "prazoDias") return <CampoNumerico valor={f.prazoDias} rotulo={nome} desabilitado={desabilitado} interpretar={textoParaDias} formatar={String} valido={(v) => v >= 0 && v <= PRAZO_MAXIMO_EM_DIAS} largura={largura} onMudar={(v) => mudarForma(i, "prazoDias", v)} />;
    return <CampoNumerico valor={f[campo]} rotulo={nome} desabilitado={desabilitado} interpretar={textoParaPercentual} formatar={percentualParaTexto} valido={campo === "mix" ? dentroDoPercentual : taxaValida} largura={largura} onMudar={(v) => mudarForma(i, campo, v)} />;
  };
  const campoHerdado = (lado: "entradas" | "saidas", mes: number, largura: number | string) => (
    <CampoNumerico valor={caixa.herdado[lado][mes] ?? 0} rotulo={`${lado === "entradas" ? "A receber" : "A pagar"} herdado em ${NOMES_DOS_MESES_CURTOS[mes]}`} desabilitado={desabilitado} interpretar={textoParaReais} formatar={reaisParaTexto} valido={dentroDoReal} largura={largura} onMudar={(v) => mudarHerdado(lado, mes, v)} />
  );

  return (
    <div ref={ref} className="plan-gastos plan-caixa">
      <div className="plan-campos-soltos">
        <div className="plan-campo-solto">
          <label className="plan-campo-solto-rotulo" htmlFor="plan-saldo-inicial">Caixa no começo de janeiro</label>
          <span className="plan-campo-com-unidade">
            <span className="plan-unidade plan-unidade-antes" aria-hidden>R$</span>
            <CampoNumerico id="plan-saldo-inicial" valor={caixa.saldoInicial} rotulo="Caixa no começo de janeiro" desabilitado={desabilitado} interpretar={textoParaReais} formatar={reaisParaTexto} valido={dentroDoReal} largura={128} onMudar={(v) => onMudar({ ...caixa, saldoInicial: v ?? 0 })} />
          </span>
          <span className="plan-campo-solto-ajuda">Saldo em conta e no cofre no primeiro dia do ano.</span>
        </div>
        <div className="plan-campo-solto">
          <label className="plan-campo-solto-rotulo" htmlFor="plan-prazo-compras">Prazo de pagamento das compras</label>
          <span className="plan-campo-com-unidade">
            <CampoNumerico id="plan-prazo-compras" valor={caixa.comprasPrazoDias} rotulo="Prazo de pagamento das compras, em dias" desabilitado={desabilitado} interpretar={textoParaDias} formatar={String} valido={(v) => v >= 0 && v <= PRAZO_MAXIMO_EM_DIAS} largura={72} onMudar={(v) => onMudar({ ...caixa, comprasPrazoDias: v ?? 0 })} />
            <span className="plan-unidade" aria-hidden>dias</span>
          </span>
          <span className="plan-campo-solto-ajuda">Média entre a compra de insumos e o pagamento (0 a {PRAZO_MAXIMO_EM_DIAS}).</span>
        </div>
      </div>

      <div className="plan-cabecalho">
        <h3 className="plan-subtitulo">Formas de pagamento das vendas</h3>
        <p className="plan-sub">Mix = parte das vendas em cada forma; prazo = dias até o dinheiro cair; taxa = desconto da maquininha.</p>
      </div>
      <div className={`plan-caixa-formas${largura >= LARGURA_LADO_A_LADO ? " plan-caixa-formas-lado" : ""}`}>
        <ReguaDoPrazo caixa={caixa} gastos={gastos} />
        {cartoes ? (
          <ul className="plan-forma-lista" aria-label="Formas de pagamento das vendas do Salão">
            {caixa.formas.map((f, i) => (
              <li key={f.forma} className="plan-forma-cartao">
                <p className="plan-forma-nome"><span className={`plan-mix-ponto plan-mix-${f.forma.toLowerCase()}`} aria-hidden />{ROTULO_DA_FORMA[f.forma]}</p>
                {CAMPOS_DA_FORMA.map(({ campo, rotulo }) => (
                  <label key={campo} className="plan-mes-campo">
                    <span>{rotulo} em {campo === "prazoDias" ? "dias" : "%"}</span>
                    {campoDaForma(f, i, campo, "100%")}
                  </label>
                ))}
              </li>
            ))}
            <li className={`plan-forma-soma ${mixFecha(caixa) ? "plan-var-sobe" : "plan-var-desce"}`}>Soma do mix: {percentualParaTexto(soma)}%</li>
          </ul>
        ) : (
        <Quadro rotulo="Formas de pagamento das vendas do Salão" editavel className="plan-quadro-estreito plan-quadro-limitado">
          <Table aria-label="Formas de pagamento das vendas do Salão">
            <Table.Head>
              <Table.Row>
                <Table.Th scope="col">Forma</Table.Th>
                <Table.Th scope="col" align="right">Mix %</Table.Th>
                <Table.Th scope="col" align="right">Prazo (dias)</Table.Th>
                <Table.Th scope="col" align="right">Taxa %</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {caixa.formas.map((f, i) => (
                <Table.Row key={f.forma}>
                  <Table.Th scope="row"><span className={`plan-mix-ponto plan-mix-${f.forma.toLowerCase()}`} aria-hidden />{ROTULO_DA_FORMA[f.forma]}</Table.Th>
                  {CAMPOS_DA_FORMA.map(({ campo }) => <Table.Td key={campo} align="right">{campoDaForma(f, i, campo)}</Table.Td>)}
                </Table.Row>
              ))}
              <Table.Row className="plan-linha-todos">
                <Table.Th scope="row">Soma do mix</Table.Th>
                <Table.Td align="right" className={mixFecha(caixa) ? "plan-var-sobe" : "plan-var-desce"}>{percentualParaTexto(soma)}%</Table.Td>
                <Table.Td />
                <Table.Td />
              </Table.Row>
            </Table.Body>
          </Table>
        </Quadro>
        )}
      </div>

      <div className="plan-cabecalho">
        <h3 className="plan-subtitulo">Herdado do ano anterior</h3>
        <p className="plan-sub">Recebíveis e contas a pagar de novembro e dezembro que caem nos primeiros meses, em R$.</p>
      </div>
      {cartoes ? (
        <ul className="plan-herdado-lista" aria-label="Valores herdados do ano anterior">
          {NOMES_DOS_MESES_CURTOS.slice(0, MESES_HERDADOS).map((m, mes) => (
            <li key={m} className="plan-herdado-cartao">
              <p className="plan-forma-nome">{m}</p>
              <label className="plan-mes-campo"><span>A receber</span>{campoHerdado("entradas", mes, "100%")}</label>
              <label className="plan-mes-campo"><span>A pagar</span>{campoHerdado("saidas", mes, "100%")}</label>
            </li>
          ))}
        </ul>
      ) : (
        <Quadro rotulo="Valores herdados do ano anterior" editavel className="plan-quadro-estreito plan-quadro-limitado">
          <Table aria-label="Valores herdados do ano anterior">
            <Table.Head>
              <Table.Row>
                <Table.Th scope="col">Herdado</Table.Th>
                {NOMES_DOS_MESES_CURTOS.slice(0, MESES_HERDADOS).map((m) => <Table.Th key={m} scope="col" align="right">{m}</Table.Th>)}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {(["entradas", "saidas"] as const).map((lado) => (
                <Table.Row key={lado}>
                  <Table.Th scope="row">{lado === "entradas" ? "A receber (R$)" : "A pagar (R$)"}</Table.Th>
                  {caixa.herdado[lado].map((_, mes) => <Table.Td key={mes} align="right">{campoHerdado(lado, mes, 112)}</Table.Td>)}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Quadro>
      )}
    </div>
  );
}
