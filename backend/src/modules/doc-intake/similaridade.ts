// Semelhança entre descrições de produto, em memória.
//
// Sem pg_trgm de proposito: a extensao existe no servidor mas nao esta
// instalada, e instalar e alterar o banco de producao — custo alto para um
// ganho que 800 produtos em memoria entregam em milissegundos.

import { normalizeText } from "../../shared/utils/normalize-text.js";

/**
 * Coeficiente de Dice sobre bigramas: mede quanto dois textos compartilham de
 * pedacos de duas letras. Escolhido por ser tolerante ao que acontece de fato
 * em nota fiscal — abreviacao ("MUSSARELA" x "MUCARELA"), ordem trocada
 * ("QUEIJO PARMESAO" x "PARMESAO QUEIJO") e sufixo de embalagem.
 * Devolve 0..1.
 */
export function semelhanca(textoA: string, textoB: string): number {
  const a = normalizeText(textoA);
  const b = normalizeText(textoB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const bigramas = (texto: string): Map<string, number> => {
    const mapa = new Map<string, number>();
    // Palavra de uma letra so nao gera bigrama; entra inteira para nao sumir.
    for (const palavra of texto.split(" ")) {
      if (palavra.length === 1) {
        mapa.set(palavra, (mapa.get(palavra) ?? 0) + 1);
        continue;
      }
      for (let i = 0; i < palavra.length - 1; i += 1) {
        const par = palavra.slice(i, i + 2);
        mapa.set(par, (mapa.get(par) ?? 0) + 1);
      }
    }
    return mapa;
  };

  const mapaA = bigramas(a);
  const mapaB = bigramas(b);
  const totalA = [...mapaA.values()].reduce((soma, n) => soma + n, 0);
  const totalB = [...mapaB.values()].reduce((soma, n) => soma + n, 0);
  if (totalA === 0 || totalB === 0) return 0;

  let comuns = 0;
  for (const [par, quantasA] of mapaA) {
    const quantasB = mapaB.get(par);
    if (quantasB) comuns += Math.min(quantasA, quantasB);
  }

  return (2 * comuns) / (totalA + totalB);
}

/**
 * Palavras que valem para buscar candidatos no banco: as mais longas, que sao
 * as que carregam significado. "1,00 UN - FILE DE FRANGO" -> ["frango", "file"].
 */
export function palavrasChave(descricao: string, quantidade = 3): string[] {
  const ignorar = new Set([
    "un", "kg", "cx", "pct", "und", "unid", "fardo", "pacote", "caixa", "lata",
    "de", "do", "da", "com", "sem", "para", "e", "a", "o", "x",
  ]);
  return [...new Set(normalizeText(descricao).split(" "))]
    .filter((palavra) => palavra.length >= 3 && !ignorar.has(palavra) && !/^\d+$/.test(palavra))
    .sort((a, b) => b.length - a.length)
    .slice(0, quantidade);
}
