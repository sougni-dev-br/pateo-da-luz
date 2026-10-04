import { useLayoutEffect, useState } from "react";
import type { PlateFormat } from "../../../api/client";
import { preencherSemQuebrarHifen } from "./semQuebrarHifen";

// Tamanho da letra de cada prato na plaquinha. Medir é caro (o navegador recalcula o layout a
// cada tentativa), então cada prato é medido UMA vez num molde escondido e o resultado fica
// guardado: repetir o prato, mudar a quantidade ou reordenar não mede de novo.

export type Tamanho = { pt: number; en: number; estoura: boolean };
export type TextoPlaca = { sobretitulo: string; nome: string; nameEn: string };

export const FONTE: Record<PlateFormat, { max: number; min: number; inglesMin: number }> = {
  std: { max: 22, min: 10, inglesMin: 7 },
  tent: { max: 18, min: 9, inglesMin: 6.5 },
  sauce: { max: 14, min: 7, inglesMin: 5.5 },
};
const PASSO = 0.5;
const PROPORCAO_INGLES = 0.52;

export const tamanhoIngles = (pt: number, formato: PlateFormat) => Math.max(FONTE[formato].inglesMin, pt * PROPORCAO_INGLES);

// A categoria escondida usa visibility (o espaço continua), então mostrar ou não não muda a medida.
export const chaveTamanho = (formato: PlateFormat, _mostrarCategoria: boolean, t: TextoPlaca) =>
  `${formato}|${t.sobretitulo}|${t.nome}|${t.nameEn}`;

// Um passo de folga quando o nome foi reduzido: a impressora mede a fonte um pouco diferente da tela.
export function comFolga(pt: number, formato: PlateFormat): number {
  const { max, min } = FONTE[formato];
  return pt < max && pt > min ? pt - PASSO : pt;
}

// Molde com a mesma estrutura e as mesmas classes da plaquinha real, fora da tela:
// uma célula por prato, todas lado a lado na mesma grade.
function criarMolde(formato: PlateFormat, textos: TextoPlaca[], mostrarCategoria: boolean) {
  const raiz = document.createElement("div");
  raiz.className = "plq-medidor";
  raiz.setAttribute("aria-hidden", "true");
  const celula = `<div class="plq-celula">${formato === "tent" ? '<div class="plq-face">' : ""}`
    + `<div class="plq-placa plq-placa--wine"><div class="plq-moldura"><div class="plq-sobretitulo${mostrarCategoria ? "" : " plq-oculto"}"><b></b><span></span><b></b></div>`
    + '<div class="plq-nomes"><div class="plq-pt"></div><div class="plq-en"></div></div><div class="plq-logo"></div></div></div>'
    + `${formato === "tent" ? "</div>" : ""}</div>`;
  raiz.innerHTML = `<section class="plq-folha plq-folha--${formato}"><div class="plq-grade">${celula.repeat(textos.length)}</div></section>`;
  const celulas = [...raiz.querySelectorAll<HTMLElement>(".plq-celula")].map((c, i) => {
    // Texto do usuário entra só por textContent, nunca no HTML.
    (c.querySelector(".plq-sobretitulo span") as HTMLElement).textContent = textos[i].sobretitulo;
    const pt = c.querySelector(".plq-pt") as HTMLElement;
    const en = c.querySelector(".plq-en") as HTMLElement;
    preencherSemQuebrarHifen(pt, textos[i].nome);
    preencherSemQuebrarHifen(en, textos[i].nameEn);
    return { nomes: c.querySelector(".plq-nomes") as HTMLElement, pt, en };
  });
  document.body.appendChild(raiz);
  return { raiz, celulas };
}

type Celula = { nomes: HTMLElement; pt: HTMLElement; en: HTMLElement };
const transborda = (c: Celula) =>
  c.nomes.scrollHeight > c.nomes.clientHeight + 0.5 || c.pt.scrollWidth > c.pt.clientWidth + 0.5 || c.en.scrollWidth > c.en.clientWidth + 0.5;

// Busca binária de todos os pratos em paralelo: a cada rodada grava o tamanho de todos e só
// depois lê todos. Assim o navegador recalcula o layout uma vez por rodada (~6 no total),
// em vez de uma vez por tentativa de cada prato — com 280 pratos isso levava 12 segundos.
function medirTodos(entradas: Array<[string, TextoPlaca]>, formato: PlateFormat, mostrarCategoria: boolean): Array<[string, Tamanho]> {
  const { min, max } = FONTE[formato];
  const passos = Math.round((max - min) / PASSO);
  const m = criarMolde(formato, entradas.map(([, t]) => t), mostrarCategoria);
  const usar = (c: Celula, passo: number) => {
    const pt = min + passo * PASSO;
    c.nomes.style.setProperty("--pt", `${pt}pt`);
    c.nomes.style.setProperty("--en", `${tamanhoIngles(pt, formato)}pt`);
  };
  try {
    const lo = new Array<number>(m.celulas.length).fill(0);
    const hi = new Array<number>(m.celulas.length).fill(passos);
    m.celulas.forEach((c) => usar(c, 0));
    const cabeNoMinimo = m.celulas.map((c) => !transborda(c));
    for (;;) {
      const meio = m.celulas.map((_, i) => (cabeNoMinimo[i] && lo[i] < hi[i] ? Math.ceil((lo[i] + hi[i]) / 2) : -1));
      if (meio.every((v) => v === -1)) break;
      m.celulas.forEach((c, i) => { if (meio[i] !== -1) usar(c, meio[i]); });
      m.celulas.forEach((c, i) => {
        if (meio[i] === -1) return;
        if (transborda(c)) hi[i] = meio[i] - 1; else lo[i] = meio[i];
      });
    }
    return entradas.map(([chave], i) => {
      const pt = cabeNoMinimo[i] ? comFolga(min + lo[i] * PASSO, formato) : min;
      return [chave, { pt, en: tamanhoIngles(pt, formato), estoura: !cabeNoMinimo[i] }];
    });
  } finally {
    m.raiz.remove();
  }
}

const cache = new Map<string, Tamanho>();

// As fontes da plaquinha só são baixadas quando aparecem na tela. Medir antes disso usa a fonte
// reserva, mais estreita, e guardaria tamanhos grandes demais (o nome vazaria no papel).
const FONTES_DA_PLACA = ["12pt Marcellus", '600 12pt "Josefin Sans"'];
const fontesCarregadas = () => !document.fonts || FONTES_DA_PLACA.every((f) => document.fonts.check(f));

// Fica true quando as fontes da plaquinha já podem ser medidas.
export function useFontesProntas(aoCarregar?: () => void): boolean {
  const [prontas, setProntas] = useState(fontesCarregadas);
  useLayoutEffect(() => {
    if (prontas) return undefined;
    let ativo = true;
    Promise.all(FONTES_DA_PLACA.map((f) => document.fonts.load(f)))
      .catch(() => undefined) // sem a fonte, mede com a reserva mesmo: melhor que não mostrar nada
      .then(() => {
        if (!ativo) return;
        aoCarregar?.();
        setProntas(true);
      });
    return () => { ativo = false; };
  }, [prontas, aoCarregar]);
  return prontas;
}

const limparCache = () => cache.clear();

export function useTamanhos(textos: TextoPlaca[], formato: PlateFormat, mostrarCategoria: boolean): Map<string, Tamanho> {
  const [tamanhos, setTamanhos] = useState<Map<string, Tamanho>>(() => new Map(cache));
  const fontesProntas = useFontesProntas(limparCache);

  useLayoutEffect(() => {
    if (!fontesProntas) return;
    const faltam = new Map<string, TextoPlaca>();
    for (const t of textos) {
      const chave = chaveTamanho(formato, mostrarCategoria, t);
      if (!cache.has(chave)) faltam.set(chave, t);
    }
    if (faltam.size) for (const [chave, tam] of medirTodos([...faltam], formato, mostrarCategoria)) cache.set(chave, tam);
    setTamanhos((atual) => (faltam.size || atual.size !== cache.size ? new Map(cache) : atual));
  }, [textos, formato, mostrarCategoria, fontesProntas]);

  return tamanhos;
}
