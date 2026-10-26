import { FileDown, Printer, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ListaFerias, PessoaFerias } from "../../../api/client";
import { Button } from "../../../design-system";
import type { Ausencia } from "./eixoDoTempo";
import type { LinhaFerias } from "./feriasFormato";
import { FolhaTelaLinhaDoTempo, FolhaTelaLista } from "./FolhaTela";
import { LETRAS, MESES_OPCOES, type MesesNaFolha, type TamanhoDaLetra, OPCOES_PADRAO, type OpcoesTela, type Orientacao, type Papel, eixoDaFolha, estiloDePagina, larguraUtilPx, nomeDoArquivo } from "./opcoesDaFolha";
import "./impressao.css";
import "./impressaoTela.css";

const CLASSE_IMPRIMINDO = "imprimindo-ferias";
const LARGURA_DA_PREVIA_PX = 620;

type Props = {
  lista: ListaFerias;
  visao: "linha" | "lista";
  /** O que a tela mostra agora (já com o filtro de situação e de empresa aplicados). */
  pessoas: PessoaFerias[];
  /** Todas as pessoas da empresa escolhida (o resumo "O que fazer" não depende do filtro de situação). */
  pessoasDoResumo?: PessoaFerias[];
  linhas: LinhaFerias[];
  filtroRotulo: string;
  empresaDaTela: string;
  ausencias: Ausencia[];
  onClose: () => void;
};

const empresaDe = (p: PessoaFerias) => p.empresa ?? "Sem empresa";
const mesmas = (a: OpcoesTela, b: OpcoesTela) => JSON.stringify(a) === JSON.stringify(b);

/** Imprime (ou salva em PDF) a tela de férias como ela se apresenta: linha do tempo ou lista. */
export function ImpressaoTela({ lista, visao, pessoas, pessoasDoResumo, linhas, filtroRotulo, empresaDaTela, ausencias, onClose }: Props) {
  const [opcoes, setOpcoes] = useState<OpcoesTela>(OPCOES_PADRAO);
  const primeiro = useRef<HTMLInputElement>(null);
  const mudou = !mesmas(opcoes, OPCOES_PADRAO);
  const mudar = (parcial: Partial<OpcoesTela>) => setOpcoes((atual) => ({ ...atual, ...parcial }));

  useEffect(() => { primeiro.current?.focus(); }, []);
  useEffect(() => () => { document.body.classList.remove(CLASSE_IMPRIMINDO); }, []);

  const empresas = useMemo(() => [...new Set((visao === "linha" ? pessoas.map(empresaDe) : linhas.map((l) => empresaDe(l.pessoa))))], [visao, pessoas, linhas]);
  const marcada = (empresa: string) => !opcoes.semEmpresa.includes(empresa);
  const pessoasSel = pessoas.filter((p) => marcada(empresaDe(p)));
  const resumoSel = (pessoasDoResumo ?? pessoas).filter((p) => marcada(empresaDe(p)));
  const linhasSel = linhas.filter((l) => marcada(empresaDe(l.pessoa)));
  const total = visao === "linha" ? pessoasSel.length : linhasSel.length;
  const eixo = useMemo(() => eixoDaFolha(lista.hoje, opcoes), [lista.hoje, opcoes]);

  const alternarEmpresa = (empresa: string) => mudar({ semEmpresa: marcada(empresa) ? [...opcoes.semEmpresa, empresa] : opcoes.semEmpresa.filter((e) => e !== empresa) });

  /** `comoPdf`: o navegador usa o título da página como nome do arquivo, então ele vira o nome sugerido. */
  function imprimir(comoPdf: boolean) {
    const estiloPagina = document.createElement("style");
    estiloPagina.textContent = estiloDePagina(opcoes);
    document.head.appendChild(estiloPagina);
    const tituloAntes = document.title;
    if (comoPdf) document.title = nomeDoArquivo(visao, lista);
    document.body.classList.add(CLASSE_IMPRIMINDO);
    const limpar = () => {
      document.body.classList.remove(CLASSE_IMPRIMINDO);
      estiloPagina.remove();
      document.title = tituloAntes;
      window.removeEventListener("afterprint", limpar);
    };
    window.addEventListener("afterprint", limpar);
    window.print();
  }

  const folha = visao === "linha"
    ? <FolhaTelaLinhaDoTempo lista={lista} opcoes={opcoes} filtroRotulo={filtroRotulo} empresaDaTela={empresaDaTela} pessoas={pessoasSel} pessoasDoResumo={resumoSel} eixo={eixo} ausencias={ausencias} />
    : <FolhaTelaLista lista={lista} opcoes={opcoes} filtroRotulo={filtroRotulo} empresaDaTela={empresaDaTela} linhas={linhasSel} />;
  const zoom = Math.min(0.8, LARGURA_DA_PREVIA_PX / larguraUtilPx(opcoes));
  const podeImprimir = total > 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="panel modal-panel fe-imp" role="dialog" aria-modal="true" aria-labelledby="fe-it-titulo"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <header className="fe-imp-topo">
          <div>
            <h2 id="fe-it-titulo">Imprimir a tela</h2>
            <p>{visao === "linha" ? "A linha do tempo" : "A lista"} como está na tela, com o filtro de agora.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar (Esc)</Button>
        </header>

        <div className="fe-imp-corpo">
          <div className="fe-imp-opcoes">
            <fieldset className="fe-imp-grupo">
              <legend>Papel</legend>
              <div className="fe-it-grupo-linha">
                {(["A4", "A3"] as Papel[]).map((p, i) => (
                  <label key={p} className="fe-imp-opcao">
                    <input ref={i === 0 ? primeiro : undefined} type="radio" name="fe-it-papel" checked={opcoes.papel === p} onChange={() => mudar({ papel: p })} />
                    <span><strong>{p}</strong></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="fe-imp-grupo">
              <legend>Orientação</legend>
              <div className="fe-it-grupo-linha">
                {([["landscape", "Deitado"], ["portrait", "Em pé"]] as Array<[Orientacao, string]>).map(([o, rotulo]) => (
                  <label key={o} className="fe-imp-opcao">
                    <input type="radio" name="fe-it-orientacao" checked={opcoes.orientacao === o} onChange={() => mudar({ orientacao: o })} />
                    <span><strong>{rotulo}</strong></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="fe-imp-grupo">
              <legend>Tamanho da letra</legend>
              <div className="fe-it-grupo-linha">
                {LETRAS.map((l) => (
                  <label key={l.id} className="fe-imp-opcao">
                    <input type="radio" name="fe-it-letra" checked={opcoes.letra === l.id} onChange={() => mudar({ letra: l.id as TamanhoDaLetra })} />
                    <span><strong>{l.rotulo}</strong></span>
                  </label>
                ))}
              </div>
            </fieldset>

            {visao === "linha" && (
              <>
                <fieldset className="fe-imp-grupo">
                  <legend>Período</legend>
                  <div className="fe-it-grupo-linha">
                    {MESES_OPCOES.map((m) => (
                      <label key={m} className="fe-imp-opcao">
                        <input type="radio" name="fe-it-meses" checked={opcoes.meses === m} onChange={() => mudar({ meses: m as MesesNaFolha })} />
                        <span><strong>{m} meses</strong>{m === 3 ? <small>trimestre</small> : null}</span>
                      </label>
                    ))}
                  </div>
                  <small className="fe-imp-dica">Começa no mês atual. 3 meses = um trimestre.</small>
                </fieldset>
                <fieldset className="fe-imp-grupo">
                  <legend>Mostrar</legend>
                  <label className="fe-imp-opcao"><input type="checkbox" checked={opcoes.legenda} onChange={(e) => mudar({ legenda: e.target.checked })} /><span><strong>Legenda das cores</strong></span></label>
                  <label className="fe-imp-opcao"><input type="checkbox" checked={opcoes.cobertura} onChange={(e) => mudar({ cobertura: e.target.checked })} /><span><strong>Faixa “Quem está fora”</strong></span></label>
                </fieldset>
              </>
            )}

            {empresas.length > 1 && (
              <fieldset className="fe-imp-grupo">
                <legend>Empresas</legend>
                {empresas.map((e) => (
                  <label key={e} className="fe-imp-opcao">
                    <input type="checkbox" checked={marcada(e)} onChange={() => alternarEmpresa(e)} />
                    <span><strong>{e}</strong></span>
                  </label>
                ))}
              </fieldset>
            )}
            <p className="fe-imp-dica">“Salvar em PDF” abre a janela do navegador: em Destino, escolha “Salvar como PDF”. O nome do arquivo já vai sugerido.</p>
          </div>

          <div className="fe-imp-previa" aria-label="Prévia da impressão">
            <span className="fe-imp-legenda">Prévia · {total} {visao === "linha" ? (total === 1 ? "pessoa" : "pessoas") : (total === 1 ? "período" : "períodos")} · {opcoes.papel} {opcoes.orientacao === "landscape" ? "deitado" : "em pé"}</span>
            <div className="fe-it-papel" style={{ "--fe-it-zoom": zoom } as React.CSSProperties}>
              {podeImprimir ? folha : <p className="fe-imp-vazio">Marque ao menos uma empresa.</p>}
            </div>
          </div>
        </div>

        <footer className="fe-imp-base">
          <Button variant="secondary" className="fe-it-base-esq" leadingIcon={<RotateCcw size={16} />} aria-disabled={!mudou}
            onClick={() => { if (mudou) setOpcoes(OPCOES_PADRAO); }}>
            Restaurar padrão
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="secondary" aria-disabled={!podeImprimir} leadingIcon={<FileDown size={16} />} onClick={() => { if (podeImprimir) imprimir(true); }}>
            Salvar em PDF
          </Button>
          <Button aria-disabled={!podeImprimir} leadingIcon={<Printer size={16} />} onClick={() => { if (podeImprimir) imprimir(false); }}>
            Imprimir
          </Button>
        </footer>
      </section>

      {createPortal(<div className="fe-area-impressao" aria-hidden="true">{folha}</div>, document.body)}
    </div>
  );
}
