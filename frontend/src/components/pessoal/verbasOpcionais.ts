// Verbas opcionais da rescisão de sem registro (decisão do Eli, 01/10/2026): férias
// proporcionais + 1/3, 13º, aviso prévio e valor livre. Desmarcadas ao abrir; a tela só
// soma para mostrar e manda a escolha — o servidor recalcula férias, 13º e aviso.
import type { CalculoVerbasOpcionais, EscolhaVerbasOpcionais, VerbasOpcionaisLancadas } from "../../api/client";
import { moneyToMasked } from "../../utils/format";

export type EstadoVerbas = {
  ferias: boolean; decimoTerceiro: boolean; aviso: boolean;
  livre: boolean; livreValor: string; livreDescricao: string;
};
export const ESTADO_VERBAS_VAZIO: EstadoVerbas = {
  ferias: false, decimoTerceiro: false, aviso: false, livre: false, livreValor: "", livreDescricao: "",
};
export const LIVRE_DESCRICAO_MINIMA = 3;

type Numero = (s: string) => number;
const centavos = (v: number) => Math.round(v * 100) / 100;

/** O que as verbas marcadas somam no bruto. oculto = alguma marcada sem valor visível (sem ver Funcionários). */
export function totalVerbasEscolhidas(calc: CalculoVerbasOpcionais | null | undefined, e: EstadoVerbas, numero: Numero) {
  let total = 0;
  let oculto = false;
  const somar = (marcada: boolean, valor: number | null | undefined) => {
    if (!marcada) return;
    if (valor == null) oculto = true;
    else total += valor;
  };
  somar(e.ferias, calc?.ferias.valor);
  somar(e.decimoTerceiro, calc?.decimoTerceiro.valor);
  somar(e.aviso, calc?.aviso.valor);
  if (e.livre) total += numero(e.livreValor);
  return { total: centavos(total), oculto };
}

/** Valor livre marcado precisa de valor > 0 e descrição (≥ 3 letras). null = ok. */
export function erroValorLivre(e: EstadoVerbas, numero: Numero): string | null {
  if (!e.livre) return null;
  if (!(numero(e.livreValor) > 0)) return "Informe o valor livre (maior que zero) ou desmarque a opção.";
  if (e.livreDescricao.trim().length < LIVRE_DESCRICAO_MINIMA) {
    return `Descreva o valor livre (acordo, gratificação…) em pelo menos ${LIVRE_DESCRICAO_MINIMA} letras: a descrição é obrigatória.`;
  }
  return null;
}

export function escolhaParaEnviar(e: EstadoVerbas, numero: Numero): EscolhaVerbasOpcionais {
  return {
    ferias: e.ferias, decimoTerceiro: e.decimoTerceiro, aviso: e.aviso,
    livre: e.livre ? { valor: centavos(numero(e.livreValor)), descricao: e.livreDescricao.trim() } : null,
  };
}

/** A escolha gravada numa rescisão lançada, para abrir o ajuste com ela. */
export function estadoDasLancadas(v: VerbasOpcionaisLancadas | null | undefined): EstadoVerbas {
  const itens = v?.itens ?? [];
  const livre = itens.find((i) => i.tipo === "LIVRE");
  return {
    ferias: itens.some((i) => i.tipo === "FERIAS"),
    decimoTerceiro: itens.some((i) => i.tipo === "DECIMO_TERCEIRO"),
    aviso: itens.some((i) => i.tipo === "AVISO"),
    livre: livre != null,
    livreValor: livre?.valor != null ? moneyToMasked(livre.valor) : "",
    livreDescricao: livre ? livre.descricao ?? livre.rotulo : "",
  };
}

/** Mesma escolha? (para saber se o ajuste mudou alguma coisa). */
export function mesmaEscolha(a: EstadoVerbas, b: EstadoVerbas, numero: Numero): boolean {
  const x = escolhaParaEnviar(a, numero);
  const y = escolhaParaEnviar(b, numero);
  return x.ferias === y.ferias && x.decimoTerceiro === y.decimoTerceiro && x.aviso === y.aviso
    && (x.livre?.valor ?? null) === (y.livre?.valor ?? null) && (x.livre?.descricao ?? null) === (y.livre?.descricao ?? null);
}
