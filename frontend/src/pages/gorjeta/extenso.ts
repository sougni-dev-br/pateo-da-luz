// Valor em reais por extenso, para o recibo ("cento e cinquenta reais e trinta centavos").

const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
  "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 100) return "cem";
  const partes: string[] = [];
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (r) partes.push(r < 20 ? UNIDADES[r] : DEZENAS[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES[r % 10]}` : ""));
  return partes.join(" e ");
}

// "e" antes do último grupo só quando ele é redondo ou menor que cem: "mil e duzentos", "mil duzentos e trinta".
const liga = (grupo: number) => (grupo < 100 || grupo % 100 === 0 ? " e " : " ");

function inteiro(n: number): string {
  if (n === 0) return "zero";
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const grupos: Array<{ texto: string; valor: number }> = [];
  if (milhoes) grupos.push({ texto: milhoes === 1 ? "um milhão" : `${ate999(milhoes)} milhões`, valor: milhoes * 1_000_000 });
  if (milhares) grupos.push({ texto: milhares === 1 ? "mil" : `${ate999(milhares)} mil`, valor: milhares * 1000 });
  if (resto) grupos.push({ texto: ate999(resto), valor: resto });
  return grupos.reduce((acc, g, i) => {
    if (i === 0) return g.texto;
    const ultimo = i === grupos.length - 1;
    const base = g.valor >= 1000 ? g.valor / 1000 : g.valor;
    return acc + (ultimo ? liga(base) : " ") + g.texto;
  }, "");
}

export function valorPorExtenso(valor: number): string {
  const centavosTotais = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes: string[] = [];
  if (reais > 0) {
    const redondoMilhao = reais >= 1_000_000 && reais % 1_000_000 === 0;
    partes.push(`${inteiro(reais)} ${redondoMilhao ? "de reais" : reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) partes.push(`${inteiro(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero real";
}
