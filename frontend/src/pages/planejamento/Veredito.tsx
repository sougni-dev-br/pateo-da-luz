import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { PlanejamentoCaixa, PlanejamentoProjecao, PlanejamentoResultado } from "../../api/client";
import { descricaoDoPeriodo, NOMES_DOS_MESES, NOMES_DOS_MESES_CURTOS, textoDaVariacao } from "./formato";
import { LinhaDoTempoDoCaixa } from "./LinhaDoTempoDoCaixa";
import { emMil, Reais } from "./Reais";
import { useOculto } from "./useOculto";

// O que o cenário responde antes de qualquer tabela: fecha no azul? o caixa aguenta? quanto muda contra o ano-base?
// Competência e caixa ficam lado a lado, com a mesma cor semântica usada no resto da tela. Nas subabas de edição o
// veredito encolhe para uma linha, para a tabela que se edita ficar à vista.

type Tom = "positivo" | "atencao" | "negativo" | "neutro";

type Props = {
  ano: number;
  anoBase: number;
  nome: string;
  projecao: PlanejamentoProjecao;
  resultado: PlanejamentoResultado | null;
  caixa: PlanejamentoCaixa | null;
  calculando: boolean;
  previa: boolean;
  /** A última prévia falhou: os números são de uma conta anterior. */
  desatualizado?: boolean;
  /** Versão de uma linha, para as subabas de edição. */
  compacto?: boolean;
  onVerResultado?: () => void;
};

const dinheiro = (n: number | null | undefined): ReactNode => (n === null || n === undefined ? "—" : <Reais valor={n} />);
const sinal = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "" : n > 0 ? " plan-cifra-sobe" : " plan-cifra-desce");
const SELO: Record<Tom, string> = { positivo: "Lucro", atencao: "Falta caixa", negativo: "Prejuízo", neutro: "Incompleto" };

/** Quando o caixa fica no vermelho, em palavras: os números (mínimo, giro) já estão nos quadros; a frase diz o trecho. */
export function trechoNegativo(caixa: PlanejamentoCaixa | null): string | null {
  const negativos = (caixa?.meses ?? []).map((m, i) => (m && m.saldo !== null && m.saldo < 0 ? i : -1)).filter((i) => i >= 0);
  if (negativos.length === 0) return null;
  const primeiro = NOMES_DOS_MESES[negativos[0]];
  const ultimo = NOMES_DOS_MESES[negativos[negativos.length - 1]];
  if (negativos.length === 1) return `o caixa fica no vermelho só em ${primeiro}`;
  const seguidos = negativos[negativos.length - 1] - negativos[0] + 1 === negativos.length;
  return seguidos ? `de ${primeiro} a ${ultimo} o caixa fica no vermelho (${negativos.length} meses seguidos)` : `o caixa fica no vermelho em ${negativos.length} meses, entre ${primeiro} e ${ultimo}`;
}

function vereditoDe(lucro: number | null, caixa: PlanejamentoCaixa | null): { tom: Tom; titulo: string; detalhe: ReactNode } {
  const pior = caixa?.total.menorSaldo ?? null;
  const mesDoPior = pior ? NOMES_DOS_MESES[pior.mes - 1] : "";
  const trecho = trechoNegativo(caixa);
  if (lucro === null) {
    return { tom: "neutro", titulo: "Ainda sem veredito", detalhe: "Falta o CMV de algum mês com base: sem ele não há margem nem lucro. Complete na aba Premissas." };
  }
  if (lucro < 0) {
    return {
      tom: "negativo",
      titulo: "Fecha no vermelho",
      detalhe: <>Os gastos passam a margem bruta em {dinheiro(Math.abs(lucro))} no período{trecho ? <>, e {trecho}</> : null}.</>
    };
  }
  if (pior && pior.valor < 0) {
    return {
      tom: "atencao",
      titulo: "Dá lucro, mas falta caixa",
      detalhe: <>O lucro chega, mas depois do dinheiro sair: {trecho ?? `o caixa fica no vermelho em ${mesDoPior}`}. Sem capital de giro, faltam recursos para pagar as contas desses meses.</>
    };
  }
  if (!caixa || caixa.total.saldoFinal === null) {
    return { tom: "positivo", titulo: "Fecha no azul", detalhe: "Em competência o cenário dá lucro. O caixa não foi calculado em todos os meses: confira a aba Caixa." };
  }
  return { tom: "positivo", titulo: "Fecha no azul e o caixa aguenta", detalhe: <>O saldo nunca fica negativo; o pior momento é {pior ? <>{dinheiro(pior.valor)} em {mesDoPior}</> : "—"}.</> };
}

/** Rótulo do número: inteiro no computador, curto no celular (cabe numa linha no 2×2 de 375px). */
function Rotulo({ longo, curto }: { longo: string; curto: string }) {
  return <><span className="plan-so-largo">{longo}</span><span className="plan-so-estreito">{curto}</span></>;
}

function Estado({ calculando, previa, desatualizado }: { calculando: boolean; previa: boolean; desatualizado: boolean }) {
  return (
    <p className="plan-veredito-estado" aria-live="polite">
      {calculando ? <span className="plan-pilula plan-pilula-calculando">Recalculando…</span>
        : desatualizado ? <span className="plan-pilula plan-pilula-velha">Números desatualizados</span>
        : previa ? <span className="plan-pilula">Prévia, ainda não salva</span>
        : null}
    </p>
  );
}

function VereditoCompacto({ tom, titulo, lucro, resultadoDeCaixa, caixa, estado, onVerResultado }: { tom: Tom; titulo: string; lucro: number | null; resultadoDeCaixa: number | null; caixa: PlanejamentoCaixa | null; estado: ReactNode; onVerResultado?: () => void }) {
  const hidden = useOculto();
  const pior = caixa?.total.menorSaldo ?? null;
  const mil = (n: number | null) => (n === null ? "—" : hidden ? "••••" : emMil(n));
  return (
    <section className={`plan-veredito plan-veredito-${tom} plan-veredito-linha`} aria-labelledby="plan-veredito-titulo">
      <span className="plan-veredito-selo" aria-hidden>{SELO[tom]}</span>
      <h2 id="plan-veredito-titulo" className="plan-veredito-linha-titulo">{titulo}</h2>
      <dl className="plan-veredito-linha-numeros">
        <div><dt>lucro</dt><dd className={sinal(lucro)}>{mil(lucro)}</dd></div>
        <div><dt>caixa</dt><dd className={sinal(resultadoDeCaixa)}>{mil(resultadoDeCaixa)}</dd></div>
        {pior && <div><dt>caixa mín.</dt><dd className={sinal(pior.valor)}>{mil(pior.valor)} em {NOMES_DOS_MESES_CURTOS[pior.mes - 1].toLowerCase()}</dd></div>}
      </dl>
      {estado}
      {onVerResultado && (
        <button type="button" className="plan-link plan-veredito-ir" onClick={onVerResultado}><span className="plan-veredito-ir-texto">Ver o resultado</span> <ArrowRight size={14} aria-hidden /></button>
      )}
    </section>
  );
}

export function Veredito({ ano, anoBase, nome, projecao, resultado, caixa, calculando, previa, desatualizado = false, compacto = false, onVerResultado }: Props) {
  const lucro = resultado?.total.lucro ?? null;
  const { tom, titulo, detalhe } = vereditoDe(lucro, caixa);
  const periodo = descricaoDoPeriodo(projecao.total.meses);
  const pior = caixa?.total.menorSaldo ?? null;
  const resultadoDeCaixa = caixa?.total.resultado ?? null;
  const mesmosMeses = caixa !== null && caixa.mesesCalculados.length === projecao.total.meses.length;
  const diferenca = mesmosMeses && lucro !== null && resultadoDeCaixa !== null ? resultadoDeCaixa - lucro : null;
  const variacao = projecao.total.variacaoVendas;
  const estado = <Estado calculando={calculando} previa={previa} desatualizado={desatualizado} />;
  const classeVelha = desatualizado && !calculando ? " plan-veredito-desatualizado" : "";

  if (compacto) {
    return (
      <div className={classeVelha.trim() || undefined} aria-busy={calculando || desatualizado}>
        <VereditoCompacto tom={tom} titulo={titulo} lucro={lucro} resultadoDeCaixa={resultadoDeCaixa} caixa={caixa} estado={estado} onVerResultado={onVerResultado} />
      </div>
    );
  }

  const necessidade = caixa?.total.necessidadeDeCapital ?? 0;
  const notaDoSaldo = !pior ? "sem todos os meses calculados"
    : pior.valor >= 0 ? `em ${NOMES_DOS_MESES[pior.mes - 1]}: o caixa nunca fica negativo`
    : Math.abs(necessidade - Math.abs(pior.valor)) < 1 ? `em ${NOMES_DOS_MESES[pior.mes - 1]}: é o que precisa estar no banco antes de começar`
    : <>em {NOMES_DOS_MESES[pior.mes - 1]}; giro necessário no ano: {dinheiro(necessidade)}</>;

  return (
    <section className={`plan-veredito plan-veredito-${tom}${classeVelha}`} aria-labelledby="plan-veredito-titulo" aria-busy={calculando || desatualizado}>
      <div className="plan-veredito-topo">
        <p className="plan-eyebrow"><span className="plan-veredito-selo">{SELO[tom]}</span> {nome} · {ano}{periodo ? ` · ${periodo}` : ""}</p>
        {estado}
      </div>
      <h2 id="plan-veredito-titulo" className="plan-veredito-titulo">{titulo}</h2>
      <p className="plan-veredito-detalhe">{detalhe}</p>

      <div className="plan-veredito-grade">
        <div className="plan-par" role="group" aria-label="Competência e caixa no mesmo período">
          <div className="plan-cifra plan-cifra-competencia">
            <span className="plan-cifra-rotulo"><Rotulo longo="Lucro · competência" curto="Lucro (comp.)" /></span>
            <strong className={`plan-cifra-valor${sinal(lucro)}`}>{dinheiro(lucro)}</strong>
            <span className="plan-cifra-nota">margem bruta − gastos</span>
          </div>
          <div className="plan-cifra plan-cifra-caixa">
            <span className="plan-cifra-rotulo"><Rotulo longo="Resultado · caixa" curto="Caixa (result.)" /></span>
            <strong className={`plan-cifra-valor${sinal(resultadoDeCaixa)}`}>{dinheiro(resultadoDeCaixa)}</strong>
            <span className="plan-cifra-nota">
              {diferenca === null ? (caixa ? "meses diferentes da competência" : "corrija o mix para calcular") : <>{dinheiro(Math.abs(diferenca))} {diferenca >= 0 ? "acima" : "abaixo"} da competência</>}
            </span>
          </div>
        </div>

        <div className={`plan-cifra plan-cifra-saldo${pior && pior.valor < 0 ? " plan-cifra-alerta" : ""}`}>
          <span className="plan-cifra-rotulo"><Rotulo longo="Saldo mínimo de caixa" curto="Caixa mínimo" /></span>
          <strong className={`plan-cifra-valor${sinal(pior?.valor)}`}>{dinheiro(pior?.valor)}</strong>
          <span className="plan-cifra-nota">{notaDoSaldo}</span>
        </div>

        <div className="plan-cifra plan-cifra-vendas">
          <span className="plan-cifra-rotulo"><Rotulo longo={`Vendas contra ${anoBase}`} curto={`Vendas × ${anoBase}`} /></span>
          <strong className={`plan-cifra-valor${sinal(variacao)}`}>{textoDaVariacao(variacao)}</strong>
          <span className="plan-cifra-nota">{dinheiro(projecao.total.projetado.vendas.total)} contra {dinheiro(projecao.total.base.vendas.total)}</span>
        </div>
      </div>

      {caixa && <LinhaDoTempoDoCaixa caixa={caixa} />}
    </section>
  );
}
