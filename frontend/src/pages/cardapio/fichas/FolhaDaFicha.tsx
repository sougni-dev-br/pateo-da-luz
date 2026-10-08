// A folha A4 da ficha técnica para preencher à mão (ou conferir impressa). Fica num portal fora do app
// e só aparece na impressão; "Salvar como PDF" na janela de impressão gera o PDF.
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { alturaDaLinha, linhasDaTabela, type FolhaDados } from "../../../lib/folhaDaFicha";
import "./folha.css";

export const CLASSE_IMPRIMINDO_FOLHAS = "imprimindo-folhas-fichas";

const marca = (marcado: boolean, rotulo: string) => `(${marcado ? "X" : "  "}) ${rotulo}`;
const LINHAS_DO_MODO_DE_PREPARO = 7;

function Celula({ rotulo, valor, span }: { rotulo: string; valor?: string; span: number }) {
  return (
    <div className="fp-celula" style={{ gridColumn: `span ${span}` }}>
      <span className="fp-rotulo">{rotulo}</span>
      <span className="fp-valor">{valor && valor.trim() ? valor : " "}</span>
    </div>
  );
}

export function FolhaDaFicha({ folha, numero, total }: { folha: FolhaDados; numero: number; total: number }) {
  const linhas = linhasDaTabela(folha);
  const textoDoPreparo = folha.modoDePreparo.trim();

  return (
    <article className="fp-folha" style={{ ["--fp-linha" as string]: alturaDaLinha(folha.linhas) }}>
      <header className="fp-topo">
        <div>
          <p className="fp-marca">Pateo da Luz</p>
          <h1 className="fp-titulo">Ficha técnica de prato</h1>
        </div>
        <p className="fp-pagina">{total > 1 ? `Folha ${numero} de ${total}` : ""}</p>
      </header>

      <h2 className="fp-secao">1. Identificação</h2>
      <div className="fp-linha-celulas">
        <Celula rotulo="Prato" valor={folha.prato} span={8} />
        <Celula rotulo="Código" valor={folha.codigo} span={4} />
      </div>
      <div className="fp-linha-celulas">
        <div className="fp-celula" style={{ gridColumn: "span 4" }}>
          <span className="fp-rotulo">Cardápio</span>
          <span className="fp-valor fp-marcas">{marca(folha.menu === "CARDAPIO", "Salão")} {marca(folha.menu === "DELIVERY", "Delivery")}</span>
        </div>
        <Celula rotulo="Categoria" valor={folha.categoria} span={4} />
        <Celula rotulo="Subcategoria" valor={folha.subcategoria} span={4} />
      </div>
      <div className="fp-linha-celulas">
        <Celula rotulo="Rendimento (quantas porções)" valor={folha.rendimento} span={3} />
        <Celula rotulo="Unidade do rendimento" valor={folha.unidadeDoRendimento} span={3} />
        <Celula rotulo="Preço de venda (R$)" valor={folha.preco} span={3} />
        <Celula rotulo="Data" valor="" span={3} />
      </div>

      <h2 className="fp-secao">2. Ingredientes <small>informe como é pesado ou medido de fato: g, ml ou unidade</small></h2>
      <table className="fp-tabela">
        <thead>
          <tr>
            <th className="fp-n">#</th>
            <th>Ingrediente (nome no estoque)</th>
            <th className="fp-cod">Cód. produto</th>
            <th className="fp-qtd">Quantidade</th>
            <th className="fp-un">Unidade</th>
            <th className="fp-perda">Perda %</th>
            <th className="fp-obs">Observação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, indice) => (
            <tr key={indice}>
              <td className="fp-n">{indice + 1}</td>
              <td>{linha.nome}</td>
              <td className="fp-cod">{linha.codigo}</td>
              <td className="fp-qtd">{linha.quantidade}</td>
              <td className="fp-un">{linha.unidade}</td>
              <td className="fp-perda">{linha.perda}</td>
              <td className="fp-obs">{linha.observacao}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="fp-secao">3. Modo de preparo</h2>
      <div className="fp-pautado" style={{ ["--fp-pauta" as string]: LINHAS_DO_MODO_DE_PREPARO }}>
        {textoDoPreparo && <p>{textoDoPreparo}</p>}
      </div>

      <h2 className="fp-secao">4. Observações, alérgenos, cuidados</h2>
      <div className="fp-pautado fp-pautado--curto" style={{ ["--fp-pauta" as string]: 3 }} />

      <footer className="fp-assinaturas">
        <div><span>Preenchido por</span></div>
        <div><span>Conferido por</span></div>
        <div><span>Digitado no sistema em</span></div>
      </footer>
    </article>
  );
}

/** Todas as folhas de uma impressão, no portal que só aparece no papel. */
export function FolhasParaImpressao({ folhas }: { folhas: FolhaDados[] }) {
  return createPortal(
    <div className="fp-raiz" aria-hidden="true">
      {folhas.map((folha, indice) => (
        <FolhaDaFicha key={indice} folha={folha} numero={indice + 1} total={folhas.length} />
      ))}
    </div>,
    document.body
  );
}

/**
 * Imprime as folhas pedidas: monta o portal, espera desenhar, abre a janela de impressão (de onde se
 * escolhe a impressora ou "Salvar como PDF") e limpa tudo ao terminar.
 */
export function useImpressaoDeFolhas() {
  const [folhas, setFolhas] = useState<FolhaDados[] | null>(null);

  const imprimir = useCallback((paraImprimir: FolhaDados[]) => {
    if (paraImprimir.length > 0) setFolhas(paraImprimir);
  }, []);

  useEffect(() => {
    if (!folhas) return undefined;

    const estiloDaPagina = document.createElement("style");
    estiloDaPagina.textContent = "@page { size: A4 portrait; margin: 8mm 10mm; }";
    document.head.appendChild(estiloDaPagina);
    document.body.classList.add(CLASSE_IMPRIMINDO_FOLHAS);

    const limpar = () => {
      document.body.classList.remove(CLASSE_IMPRIMINDO_FOLHAS);
      estiloDaPagina.remove();
      window.removeEventListener("afterprint", limpar);
      setFolhas(null);
    };
    window.addEventListener("afterprint", limpar);

    // Um quadro para o portal desenhar antes de a impressão tirar a foto da página.
    const quadro = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(quadro);
      window.removeEventListener("afterprint", limpar);
      document.body.classList.remove(CLASSE_IMPRIMINDO_FOLHAS);
      estiloDaPagina.remove();
    };
  }, [folhas]);

  return { imprimir, portal: folhas ? <FolhasParaImpressao folhas={folhas} /> : null };
}
