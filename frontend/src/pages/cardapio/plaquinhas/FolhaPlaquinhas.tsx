import { memo, type CSSProperties } from "react";
import type { PlateFormat, PlateTheme } from "../../../api/client";
import { LOGO_DO_TEMA } from "./logos";
import { FONTE, chaveTamanho, tamanhoIngles, type Tamanho, type TextoPlaca } from "./medidaFonte";
import { semQuebrarHifen } from "./semQuebrarHifen";
import "./plaquinhas.css";

export type PlacaImpressa = { key: string; namePt: string; nameEn: string; category: string };

// Medidas reais no papel A4 em pé. Somadas ao recuo do topo, cabem na folha com folga.
export const FORMATOS: Record<PlateFormat, { porFolha: number; nome: string; tamanho: string }> = {
  // Cabe no suporte de inox do buffet (7,5 × 5,0 cm entre as dobras), com 1 mm de folga.
  std: { porFolha: 10, nome: "Plaquinha", tamanho: "7,4 × 4,9 cm" },
  tent: { porFolha: 6, nome: "Cavalete", tamanho: "9,5 × 4,6 cm, dobra ao meio" },
  sauce: { porFolha: 21, nome: "Molho", tamanho: "6,3 × 3,8 cm" },
};

export function paginar<T>(itens: T[], porFolha: number): T[][] {
  const folhas: T[][] = [];
  for (let i = 0; i < itens.length; i += porFolha) folhas.push(itens.slice(i, i + porFolha));
  return folhas.length ? folhas : [[]];
}

// Em molho, "MOLHO" vai no alto e o nome fica só com o sabor (Tártaro, Caesar…), como na planilha antiga.
export function rotuloDaPlaca(p: Pick<PlacaImpressa, "namePt" | "category">): { sobretitulo: string; nome: string } {
  const m = p.category === "Molhos" ? p.namePt.match(/^molho\s+(?:de\s+)?(.+)$/i) : null;
  return m ? { sobretitulo: "Molho", nome: m[1].charAt(0).toUpperCase() + m[1].slice(1) } : { sobretitulo: p.category, nome: p.namePt };
}

export const textoDaPlaca = (p: Pick<PlacaImpressa, "namePt" | "nameEn" | "category">): TextoPlaca => ({ ...rotuloDaPlaca(p), nameEn: p.nameEn });

type PlacaProps = { sobretitulo: string; nome: string; nameEn: string; tema: PlateTheme; mostrarCategoria: boolean; pt: number; en: number; estoura: boolean };

// Memo: mudar a quantidade de um prato não redesenha as outras plaquinhas.
const Placa = memo(function Placa({ sobretitulo, nome, nameEn, tema, mostrarCategoria, pt, en, estoura }: PlacaProps) {
  const fonte = { "--pt": `${pt}pt`, "--en": `${en}pt` } as CSSProperties;
  return (
    <div className={`plq-placa plq-placa--${tema}${estoura ? " plq-placa--estoura" : ""}`}>
      <div className="plq-moldura">
        <i /><i /><i /><i />
        <div className={`plq-sobretitulo${mostrarCategoria ? "" : " plq-oculto"}`}><b />{sobretitulo}<b /></div>
        <div className="plq-nomes" style={fonte}>
          <div className="plq-pt">{semQuebrarHifen(nome)}</div>
          <div className="plq-en">{semQuebrarHifen(nameEn)}</div>
        </div>
        <img className="plq-logo" src={LOGO_DO_TEMA[tema]} alt="" />
      </div>
    </div>
  );
});

type Props = { placas: PlacaImpressa[]; formato: PlateFormat; tema: PlateTheme; mostrarCategoria: boolean; tamanhos: Map<string, Tamanho> };

export function FolhaPlaquinhas({ placas, formato, tema, mostrarCategoria, tamanhos }: Props) {
  const folhas = paginar(placas, FORMATOS[formato].porFolha);
  const padrao: Tamanho = { pt: FONTE[formato].max, en: tamanhoIngles(FONTE[formato].max, formato), estoura: false };

  const desenhar = (placa: PlacaImpressa) => {
    const texto = textoDaPlaca(placa);
    const t = tamanhos.get(chaveTamanho(formato, mostrarCategoria, texto)) ?? padrao;
    return <Placa {...texto} tema={tema} mostrarCategoria={mostrarCategoria} pt={t.pt} en={t.en} estoura={t.estoura} />;
  };

  return (
    <>
      {folhas.map((folha, i) => (
        <section key={i} className={`plq-folha plq-folha--${formato}`}>
          <div className="plq-grade">
            {folha.map((placa) => (
              <div key={placa.key} className="plq-celula">
                {formato === "tent" ? (
                  <>
                    <div className="plq-face plq-face--virada">{desenhar(placa)}</div>
                    <div className="plq-face">{desenhar(placa)}</div>
                    <span className="plq-dobra" aria-hidden="true" />
                  </>
                ) : desenhar(placa)}
              </div>
            ))}
          </div>
          <span className="plq-numero">Folha {i + 1} de {folhas.length}</span>
        </section>
      ))}
    </>
  );
}
