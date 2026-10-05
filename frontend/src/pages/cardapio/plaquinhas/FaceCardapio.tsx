import { forwardRef, memo, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { BuffetMenuSection, PlateTheme } from "../../../api/client";
import { LOGO_DO_TEMA } from "./logos";
import { paginar } from "./FolhaPlaquinhas";
import { type FaceImpressa, type GrupoFace, type LayoutFolha } from "./cardapioFormato";
import { useFontesProntas } from "./medidaFonte";
import { semQuebrarHifen } from "./semQuebrarHifen";
import "./cardapio.css";

// Letra base do cardápio (nome do prato), em pt. Título e inglês são proporcionais a ela.
const FONTE_MIN = 4.5;
const FONTE_MAX = 15;
const PASSO = 0.25;

export type AjusteFace = { pt: number; estoura: boolean };
/** Letra de cada grupo de face (chave do GrupoFace). */
export type Ajustes = Record<string, AjusteFace>;
export const AJUSTE_PADRAO: AjusteFace = { pt: 9, estoura: false };

type FaceProps = { secoes: BuffetMenuSection[]; comLogo: boolean; umPrato?: boolean; tema: PlateTheme; largura: number; altura: number; ajuste: AjusteFace; medidor?: boolean };

// memo: digitar o nome ou a data do cardápio não redesenha as faces.
export const FaceCardapio = memo(forwardRef<HTMLDivElement, FaceProps>(function FaceCardapio({ secoes, comLogo, umPrato, tema, largura, altura, ajuste, medidor }, ref) {
  const estilo = { width: `${largura}mm`, height: `${altura}mm`, "--s": `${ajuste.pt}pt`, "--logo": `${Math.round(altura * 0.17)}mm` } as CSSProperties;
  return (
    <div ref={ref} style={estilo}
      className={`cdp-face cdp-face--${tema}${comLogo ? " cdp-face--frente" : ""}${umPrato ? " cdp-face--prato" : ""}${ajuste.estoura && !medidor ? " cdp-face--estoura" : ""}${medidor ? " cdp-face--medidor" : ""}`}>
      <div className="cdp-moldura">
        <i /><i /><i /><i />
        {comLogo && <img className="cdp-logo" src={LOGO_DO_TEMA[tema]} alt="" />}
        <div className="cdp-corpo">
          {secoes.map((s, i) => (
            <section key={i} className="cdp-secao">
              <h4 className="cdp-titulo"><b />{s.titlePt}<b /></h4>
              <p className="cdp-titulo-en">{s.titleEn}</p>
              <ul>
                {s.items.map((it, j) => (
                  <li key={j}><span className="cdp-pt">{semQuebrarHifen(it.namePt)}</span><span className="cdp-en">{semQuebrarHifen(it.nameEn)}</span></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}));

const transborda = (corpo: HTMLElement) => corpo.scrollHeight > corpo.clientHeight + 0.5 || corpo.scrollWidth > corpo.clientWidth + 0.5;

// Maior letra (em passos de 0,25 pt) em que todas as seções da face cabem.
function ajustar(face: HTMLElement, fonteMax = FONTE_MAX): AjusteFace {
  const corpo = face.querySelector<HTMLElement>(".cdp-corpo");
  if (!corpo) return AJUSTE_PADRAO;
  const cabe = (pt: number) => { face.style.setProperty("--s", `${pt}pt`); return !transborda(corpo); };
  if (!cabe(FONTE_MIN)) return { pt: FONTE_MIN, estoura: true };
  let lo = 0;
  let hi = Math.round((fonteMax - FONTE_MIN) / PASSO);
  while (lo < hi) {
    const meio = Math.ceil((lo + hi) / 2);
    if (cabe(FONTE_MIN + meio * PASSO)) lo = meio; else hi = meio - 1;
  }
  const pt = FONTE_MIN + lo * PASSO;
  // Folga de um passo quando reduziu: a impressora mede a fonte um pouco diferente da tela.
  return { pt: pt < fonteMax && pt > FONTE_MIN ? pt - PASSO : pt, estoura: false };
}

type Medida = { grupos: GrupoFace[]; tema: PlateTheme; largura: number; altura: number };

const mesmosAjustes = (a: Ajustes, b: Ajustes) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] && a[k].pt === b[k].pt && a[k].estoura === b[k].estoura);
};

// Mede cada grupo de face num molde fora da tela, no tamanho real (a prévia está com zoom).
export function useAjustesDoCardapio({ grupos, tema, largura, altura }: Medida): { ajustes: Ajustes; molde: JSX.Element } {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [ajustes, setAjustes] = useState<Ajustes>({});
  const fontesProntas = useFontesProntas();

  useLayoutEffect(() => {
    if (!fontesProntas) return;
    const novo: Ajustes = {};
    for (const g of grupos) {
      const el = refs.current.get(g.chave);
      if (el) novo[g.chave] = ajustar(el, g.maxPt);
    }
    setAjustes((a) => (mesmosAjustes(a, novo) ? a : novo));
  }, [grupos, tema, largura, altura, fontesProntas]);

  const molde = createPortal(
    <div className="plq-medidor" aria-hidden="true">
      {grupos.map((g) => (
        <FaceCardapio key={g.chave} ref={(el) => { if (el) refs.current.set(g.chave, el); else refs.current.delete(g.chave); }}
          secoes={g.secoes} comLogo={g.comLogo} umPrato={g.umPrato} tema={tema} largura={largura} altura={altura} ajuste={AJUSTE_PADRAO} medidor />
      ))}
    </div>,
    document.body,
  );
  return { ajustes, molde };
}

type FolhasProps = { faces: FaceImpressa[]; layout: LayoutFolha; grupos: GrupoFace[]; tema: PlateTheme; largura: number; altura: number; ajustes: Ajustes };

export function FolhasCardapio({ faces, layout, grupos, tema, largura, altura, ajustes }: FolhasProps) {
  const porChave = new Map(grupos.map((g) => [g.chave, g]));
  const folhas = paginar(faces, layout.porFolha);
  const grade = { gridTemplateColumns: `repeat(${layout.colunas}, ${largura}mm)`, gridAutoRows: `${altura}mm` };
  return (
    <>
      {folhas.map((folha, i) => (
        <section key={i} className={`cdp-folha cdp-folha--${layout.orientacao}`}>
          <div className="cdp-grade" style={grade}>
            {folha.map((f) => {
              const g = porChave.get(f.grupo);
              return (
                <div key={f.chave} className="cdp-celula" title={`Display ${f.display} · ${f.face === "front" ? "frente" : "verso"}`}>
                  {g && <FaceCardapio secoes={g.secoes} comLogo={g.comLogo} umPrato={g.umPrato} tema={tema} largura={largura} altura={altura} ajuste={ajustes[f.grupo] ?? AJUSTE_PADRAO} />}
                </div>
              );
            })}
          </div>
          <span className="plq-numero">Folha {i + 1} de {folhas.length}</span>
        </section>
      ))}
    </>
  );
}
