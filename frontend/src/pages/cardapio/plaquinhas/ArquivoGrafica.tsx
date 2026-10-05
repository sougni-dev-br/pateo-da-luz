import type { CSSProperties } from "react";
import type { PlateFormat, PlateTheme } from "../../../api/client";
import { ConteudoDaCelula, FORMATOS, MEDIDA_MM, type PlacaImpressa } from "./FolhaPlaquinhas";
import type { Tamanho } from "./medidaFonte";

// Arquivo para gráfica: uma página por prato, no tamanho de corte, com sangria de 2 mm
// (o fundo passa do corte e não sobra filete branco na borda) e marcas de corte no lado de
// fora. A gráfica monta as cópias na folha dela; a quantidade vai escrita em cada página.
export const SANGRIA_MM = 2;
export const MARGEM_MARCAS_MM = 6;
const RECUO_MM = SANGRIA_MM + MARGEM_MARCAS_MM;

export function paginaDaGrafica(formato: PlateFormat) {
  const { largura, altura } = MEDIDA_MM[formato];
  return { largura: largura + 2 * RECUO_MM, altura: altura + 2 * RECUO_MM };
}

export type PratoDaGrafica = PlacaImpressa & { qty: number };

type Props = { pratos: PratoDaGrafica[]; formato: PlateFormat; tema: PlateTheme; mostrarCategoria: boolean; tamanhos: Map<string, Tamanho> };

export function ArquivoGrafica({ pratos, formato, tema, mostrarCategoria, tamanhos }: Props) {
  const { largura, altura } = MEDIDA_MM[formato];
  const pagina = paginaDaGrafica(formato);
  const medidas = {
    "--pag-l": `${pagina.largura}mm`, "--pag-a": `${pagina.altura}mm`,
    "--corte-l": `${largura}mm`, "--corte-a": `${altura}mm`,
    "--recuo": `${RECUO_MM}mm`, "--sangria": `${SANGRIA_MM}mm`,
  } as CSSProperties;
  const total = pratos.reduce((s, p) => s + p.qty, 0);

  return (
    <div className={`plq-grafica plq-folha--${formato}`} style={medidas}>
      {pratos.map((p, i) => (
        <section key={p.key} className="plq-grafica-pagina">
          <div className={`plq-grafica-sangria plq-grafica-sangria--${tema}`} />
          <div className="plq-grafica-corte">
            <ConteudoDaCelula placa={p} formato={formato} tema={tema} mostrarCategoria={mostrarCategoria} tamanhos={tamanhos} />
          </div>
          <i className="plq-marca plq-marca--h plq-marca--te" /><i className="plq-marca plq-marca--v plq-marca--te" />
          <i className="plq-marca plq-marca--h plq-marca--td" /><i className="plq-marca plq-marca--v plq-marca--td" />
          <i className="plq-marca plq-marca--h plq-marca--be" /><i className="plq-marca plq-marca--v plq-marca--be" />
          <i className="plq-marca plq-marca--h plq-marca--bd" /><i className="plq-marca plq-marca--v plq-marca--bd" />
          <span className="plq-grafica-legenda">
            Pateo da Luz · {p.namePt} · Qtd. {p.qty} · corte {largura} × {altura} mm · {FORMATOS[formato].nome} {i + 1}/{pratos.length} ({total} no total)
          </span>
        </section>
      ))}
    </div>
  );
}
