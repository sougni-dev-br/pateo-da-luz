import { Printer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ListaFerias } from "../../../api/client";
import { Alert, Button } from "../../../design-system";
import { FolhaFerias } from "./FolhaFerias";
import { type ModoImpressao, folhasDeConversa, folhasParaContabilidade } from "./impressao";
import "./impressao.css";

const CLASSE_IMPRIMINDO = "imprimindo-ferias";

const MODOS: Array<{ id: ModoImpressao; titulo: string; dica: string }> = [
  { id: "CONVERSA", titulo: "Para conversar", dica: "Quem ainda precisa de data, com espaço para anotar o combinado e o ciente." },
  { id: "CONTABILIDADE", titulo: "Para a contabilidade", dica: "O que já está programado no ERP, com início, último dia e volta." },
];

type Props = { lista: ListaFerias; onClose: () => void };

export function ImpressaoFerias({ lista, onClose }: Props) {
  const [modo, setModo] = useState<ModoImpressao>("CONVERSA");
  const [desmarcadas, setDesmarcadas] = useState<Set<string>>(new Set());
  const primeiro = useRef<HTMLInputElement>(null);

  const conversa = useMemo(() => folhasDeConversa(lista), [lista]);
  const contabilidade = useMemo(() => folhasParaContabilidade(lista), [lista]);
  const todas = modo === "CONVERSA" ? conversa : contabilidade;
  const empresas = todas.map((f) => f.empresa);
  const escolhidas = todas.filter((f) => !desmarcadas.has(f.empresa));
  const linhas = escolhidas.reduce((n, f) => n + f.linhas.length, 0);

  useEffect(() => { primeiro.current?.focus(); }, []);
  useEffect(() => () => { document.body.classList.remove(CLASSE_IMPRIMINDO); }, []);

  const alternar = (empresa: string) => setDesmarcadas((atual) => {
    const novo = new Set(atual);
    if (novo.has(empresa)) novo.delete(empresa); else novo.add(empresa);
    return novo;
  });

  function imprimir() {
    const estiloPagina = document.createElement("style");
    estiloPagina.textContent = "@page { size: A4 landscape; margin: 10mm; }";
    document.head.appendChild(estiloPagina);
    document.body.classList.add(CLASSE_IMPRIMINDO);
    const limpar = () => {
      document.body.classList.remove(CLASSE_IMPRIMINDO);
      estiloPagina.remove();
      window.removeEventListener("afterprint", limpar);
    };
    window.addEventListener("afterprint", limpar);
    window.print();
  }

  const folha = modo === "CONVERSA"
    ? <FolhaFerias modo="CONVERSA" folhas={escolhidas as ReturnType<typeof folhasDeConversa>} emissao={lista.hoje} />
    : <FolhaFerias modo="CONTABILIDADE" folhas={escolhidas as ReturnType<typeof folhasParaContabilidade>} emissao={lista.hoje} />;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="panel modal-panel fe-imp" role="dialog" aria-modal="true" aria-labelledby="fe-imp-titulo"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <header className="fe-imp-topo">
          <div>
            <h2 id="fe-imp-titulo">Imprimir férias por empresa</h2>
            <p>Uma folha A4 deitada por empresa.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar (Esc)</Button>
        </header>

        <div className="fe-imp-corpo">
          <div className="fe-imp-opcoes">
            <fieldset className="fe-imp-grupo">
              <legend>O que imprimir</legend>
              {MODOS.map((m, i) => (
                <label key={m.id} className="fe-imp-opcao">
                  <input ref={i === 0 ? primeiro : undefined} type="radio" name="fe-imp-modo" checked={modo === m.id}
                    onChange={() => { setModo(m.id); setDesmarcadas(new Set()); }} />
                  <span><strong>{m.titulo}</strong><small>{m.dica}</small></span>
                </label>
              ))}
            </fieldset>

            <fieldset className="fe-imp-grupo">
              <legend>Empresas</legend>
              {empresas.length === 0 && <p className="fe-imp-vazio">Nada para imprimir neste modo.</p>}
              {todas.map((f) => (
                <label key={f.empresa} className="fe-imp-opcao">
                  <input type="checkbox" checked={!desmarcadas.has(f.empresa)} onChange={() => alternar(f.empresa)} />
                  <span><strong>{f.empresa}</strong><small>{f.linhas.length} {f.linhas.length === 1 ? "linha" : "linhas"}</small></span>
                </label>
              ))}
            </fieldset>

            {modo === "CONTABILIDADE" && conversa.length > 0 && (
              <Alert tone="info" role={undefined}>Ainda há períodos sem data. Imprima “Para conversar” para fechar com a equipe antes de mandar à contabilidade.</Alert>
            )}
            <p className="fe-imp-dica">Na janela da impressora, escolha papel A4 e orientação deitada.</p>
          </div>

          <div className="fe-imp-previa" aria-label="Prévia da impressão">
            <span className="fe-imp-legenda">Prévia · {linhas} {linhas === 1 ? "linha" : "linhas"} em {escolhidas.length} {escolhidas.length === 1 ? "folha" : "folhas"}</span>
            <div className="fe-imp-papel">{escolhidas.length > 0 ? folha : <p className="fe-imp-vazio">Marque ao menos uma empresa.</p>}</div>
          </div>
        </div>

        <footer className="fe-imp-base">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          {/* aria-disabled mantém o foco no botão; a impressão em si é barrada aqui. */}
          <Button aria-disabled={escolhidas.length === 0} leadingIcon={<Printer size={16} />}
            onClick={() => { if (escolhidas.length > 0) imprimir(); }}>
            Imprimir
          </Button>
        </footer>
      </section>

      {createPortal(<div className="fe-area-impressao" aria-hidden="true">{folha}</div>, document.body)}
    </div>
  );
}
