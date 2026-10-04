import { forwardRef, memo, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { BuffetMenuSection, MenuFace, PlateTheme } from "../../../api/client";
import logoDourado from "./assets/logo-horizontal-dourado.png";
import logoVinho from "./assets/logo-horizontal-vinho.png";
import { paginar } from "./FolhaPlaquinhas";
import { type FaceImpressa, type LayoutFolha } from "./cardapioFormato";
import { useFontesProntas } from "./medidaFonte";
import "./cardapio.css";

// Letra base do cardápio (nome do prato), em pt. Título e inglês são proporcionais a ela.
const FONTE_MIN = 4.5;
const FONTE_MAX = 15;
const PASSO = 0.25;

export type AjusteFace = { pt: number; estoura: boolean };
export type Ajustes = Record<MenuFace, AjusteFace>;
const PADRAO: Ajustes = { front: { pt: 9, estoura: false }, back: { pt: 9, estoura: false } };

type FaceProps = { face: MenuFace; secoes: BuffetMenuSection[]; tema: PlateTheme; largura: number; altura: number; ajuste: AjusteFace; medidor?: boolean };

// memo: digitar o nome ou a data do cardápio não redesenha as faces.
export const FaceCardapio = memo(forwardRef<HTMLDivElement, FaceProps>(function FaceCardapio({ face, secoes, tema, largura, altura, ajuste, medidor }, ref) {
  const daFace = secoes.filter((s) => s.face === face);
  const estilo = { width: `${largura}mm`, height: `${altura}mm`, "--s": `${ajuste.pt}pt`, "--logo": `${Math.round(altura * 0.17)}mm` } as CSSProperties;
  return (
    <div ref={ref} style={estilo}
      className={`cdp-face cdp-face--${tema}${face === "front" ? " cdp-face--frente" : ""}${ajuste.estoura && !medidor ? " cdp-face--estoura" : ""}${medidor ? " cdp-face--medidor" : ""}`}>
      <div className="cdp-moldura">
        <i /><i /><i /><i />
        {face === "front" && <img className="cdp-logo" src={tema === "gold" ? logoDourado : logoVinho} alt="" />}
        <div className="cdp-corpo">
          {daFace.map((s, i) => (
            <section key={i} className="cdp-secao">
              <h4 className="cdp-titulo"><b />{s.titlePt}<b /></h4>
              <p className="cdp-titulo-en">{s.titleEn}</p>
              <ul>
                {s.items.map((it, j) => (
                  <li key={j}><span className="cdp-pt">{it.namePt}</span><span className="cdp-en">{it.nameEn}</span></li>
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
function ajustar(face: HTMLElement): AjusteFace {
  const corpo = face.querySelector<HTMLElement>(".cdp-corpo");
  if (!corpo) return PADRAO.front;
  const cabe = (pt: number) => { face.style.setProperty("--s", `${pt}pt`); return !transborda(corpo); };
  if (!cabe(FONTE_MIN)) return { pt: FONTE_MIN, estoura: true };
  let lo = 0;
  let hi = Math.round((FONTE_MAX - FONTE_MIN) / PASSO);
  while (lo < hi) {
    const meio = Math.ceil((lo + hi) / 2);
    if (cabe(FONTE_MIN + meio * PASSO)) lo = meio; else hi = meio - 1;
  }
  const pt = FONTE_MIN + lo * PASSO;
  // Folga de um passo quando reduziu: a impressora mede a fonte um pouco diferente da tela.
  return { pt: pt < FONTE_MAX && pt > FONTE_MIN ? pt - PASSO : pt, estoura: false };
}

type Medida = { secoes: BuffetMenuSection[]; tema: PlateTheme; largura: number; altura: number };

// Mede a frente e o verso num molde fora da tela, no tamanho real (a prévia está com zoom).
export function useAjustesDoCardapio({ secoes, tema, largura, altura }: Medida): { ajustes: Ajustes; molde: JSX.Element } {
  const frenteRef = useRef<HTMLDivElement>(null);
  const versoRef = useRef<HTMLDivElement>(null);
  const [ajustes, setAjustes] = useState<Ajustes>(PADRAO);
  const fontesProntas = useFontesProntas();

  useLayoutEffect(() => {
    if (!fontesProntas || !frenteRef.current || !versoRef.current) return;
    const novo: Ajustes = { front: ajustar(frenteRef.current), back: ajustar(versoRef.current) };
    setAjustes((a) => (a.front.pt === novo.front.pt && a.back.pt === novo.back.pt && a.front.estoura === novo.front.estoura && a.back.estoura === novo.back.estoura ? a : novo));
  }, [secoes, tema, largura, altura, fontesProntas]);

  const comuns = { secoes, tema, largura, altura, ajuste: PADRAO.front, medidor: true };
  const molde = createPortal(
    <div className="plq-medidor" aria-hidden="true">
      <FaceCardapio ref={frenteRef} face="front" {...comuns} />
      <FaceCardapio ref={versoRef} face="back" {...comuns} />
    </div>,
    document.body,
  );
  return { ajustes, molde };
}

type FolhasProps = { faces: FaceImpressa[]; layout: LayoutFolha; secoes: BuffetMenuSection[]; tema: PlateTheme; largura: number; altura: number; ajustes: Ajustes };

export function FolhasCardapio({ faces, layout, secoes, tema, largura, altura, ajustes }: FolhasProps) {
  const folhas = paginar(faces, layout.porFolha);
  const grade = { gridTemplateColumns: `repeat(${layout.colunas}, ${largura}mm)`, gridAutoRows: `${altura}mm` };
  return (
    <>
      {folhas.map((folha, i) => (
        <section key={i} className={`cdp-folha cdp-folha--${layout.orientacao}`}>
          <div className="cdp-grade" style={grade}>
            {folha.map((f) => (
              <div key={f.chave} className="cdp-celula" title={`Display ${f.display} · ${f.face === "front" ? "frente" : "verso"}`}>
                <FaceCardapio face={f.face} secoes={secoes} tema={tema} largura={largura} altura={altura} ajuste={ajustes[f.face]} />
              </div>
            ))}
          </div>
          <span className="plq-numero">Folha {i + 1} de {folhas.length}</span>
        </section>
      ))}
    </>
  );
}
