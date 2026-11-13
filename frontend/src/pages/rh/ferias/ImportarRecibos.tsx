import { Check, FileUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, type ReciboFeriasPrevia, importarReciboFerias } from "../../../api/client";
import { Alert, Button, Money } from "../../../design-system";
import { dataBr, plural } from "./feriasFormato";
import "./importarRecibos.css";

type Estado = "lendo" | "pronto" | "ambiguo" | "recusado" | "lancando" | "lancado";
type Candidato = { id: string; nome: string };
type Linha = {
  chave: number; arquivo: string; base64: string; estado: Estado; previa?: ReciboFeriasPrevia; erro?: string;
  candidatos?: Candidato[]; marcado: boolean;
};

const lerComoBase64 = (arquivo: File) => new Promise<string>((ok, falha) => {
  const leitor = new FileReader();
  leitor.onload = () => ok(String(leitor.result));
  leitor.onerror = () => falha(new Error("Não foi possível abrir o arquivo."));
  leitor.readAsDataURL(arquivo);
});

const ROTULO: Record<Estado, string> = {
  lendo: "Lendo…", pronto: "Pronto para lançar", ambiguo: "Escolha a pessoa", recusado: "Não dá para lançar", lancando: "Lançando…", lancado: "Lançado no Contas a Pagar",
};

type Props = {
  onClose: () => void;
  /** Chamado ao fechar quando algum recibo foi lançado, para a tela recarregar. */
  onLancou: () => void;
};

/** Importa os "Aviso e Recibo de Férias" da contabilidade (PDFs): mostra o que leu e lança o título de cada um no Contas a Pagar. */
export function ImportarRecibos({ onClose, onLancou }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const proxima = useRef(1);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [lancando, setLancando] = useState(false);

  useEffect(() => { entrada.current?.focus(); }, []);

  const mudar = (chave: number, parte: Partial<Linha>) => setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, ...parte } : l)));

  async function ler(chave: number, base64: string, arquivo: string, employeeId?: string) {
    try {
      const r = await importarReciboFerias(base64, arquivo, false, employeeId);
      mudar(chave, { estado: "pronto", previa: r.previa, erro: undefined, candidatos: undefined, marcado: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.code === "AMBIGUO") {
        mudar(chave, { estado: "ambiguo", erro: e.message, candidatos: e.body.candidatos as Candidato[], marcado: false });
      } else {
        mudar(chave, { estado: "recusado", erro: e instanceof Error ? e.message : "Não consegui ler o recibo.", marcado: false });
      }
    }
  }

  async function escolher(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    const novos = [...arquivos].map((f) => ({ f, chave: proxima.current++ }));
    setLinhas((atual) => [...atual, ...novos.map(({ f, chave }): Linha => ({ chave, arquivo: f.name, base64: "", estado: "lendo", marcado: false }))]);
    for (const { f, chave } of novos) {
      try {
        const base64 = await lerComoBase64(f);
        mudar(chave, { base64 });
        await ler(chave, base64, f.name);
      } catch (e) {
        mudar(chave, { estado: "recusado", erro: e instanceof Error ? e.message : "Não consegui abrir o arquivo." });
      }
    }
    if (entrada.current) entrada.current.value = "";
  }

  const escolhidas = linhas.filter((l) => l.estado === "pronto" && l.marcado);
  const lancadas = linhas.filter((l) => l.estado === "lancado").length;

  async function lancar() {
    setLancando(true);
    for (const l of escolhidas) {
      mudar(l.chave, { estado: "lancando" });
      try {
        await importarReciboFerias(l.base64, l.arquivo, true, l.previa?.employeeId);
        mudar(l.chave, { estado: "lancado", erro: undefined });
      } catch (e) {
        mudar(l.chave, { estado: "recusado", erro: e instanceof Error ? e.message : "Não consegui lançar.", marcado: false });
      }
    }
    setLancando(false);
  }

  function fechar() {
    if (lancadas > 0) onLancou();
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !lancando) fechar(); }}>
      <section className="panel modal-panel fe-imp fe-rec" role="dialog" aria-modal="true" aria-labelledby="fe-rec-titulo"
        onKeyDown={(e) => { if (e.key === "Escape" && !lancando) fechar(); }}>
        <header className="fe-imp-topo">
          <div>
            <h2 id="fe-rec-titulo">Importar recibos de férias</h2>
            <p>Os “Aviso e Recibo de Férias” que a contabilidade devolveu (PDF). Cada um vira um título no Contas a Pagar.</p>
          </div>
          <Button variant="secondary" size="sm" disabled={lancando} onClick={fechar}>Fechar (Esc)</Button>
        </header>

        <div className="fe-rec-corpo">
          <div className="fe-rec-envio">
            <input ref={entrada} type="file" accept="application/pdf" multiple hidden aria-label="PDFs dos recibos de férias" onChange={(e) => void escolher(e.target.files)} />
            <Button variant="secondary" leadingIcon={<FileUp size={14} />} disabled={lancando} onClick={() => entrada.current?.click()}>Escolher os PDFs</Button>
            <span className="fe-sub">Pode escolher vários de uma vez. Nada é lançado antes de você confirmar.</span>
          </div>

          {linhas.length > 0 && (
            <div className="fe-rec-rolagem">
              <table className="fe-rec-tabela">
                <thead>
                  <tr><th scope="col">Lançar</th><th scope="col">Funcionário</th><th scope="col">Férias</th><th scope="col">Vence em</th><th scope="col">Líquido</th><th scope="col">Situação</th></tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.chave} className={`fe-rec-linha fe-rec-linha--${l.estado}`}>
                      <td>
                        <input type="checkbox" checked={l.marcado} disabled={l.estado !== "pronto" || lancando}
                          aria-label={`Lançar o recibo ${l.arquivo}`} onChange={(e) => mudar(l.chave, { marcado: e.target.checked })} />
                      </td>
                      <td><strong>{l.previa?.nome ?? "—"}</strong><small>{l.arquivo}</small></td>
                      <td>{l.previa ? <>{dataBr(l.previa.gozoInicio)} a {dataBr(l.previa.gozoFim)}<small>{l.previa.dias} {plural(l.previa.dias, "dia", "dias")}</small></> : "—"}</td>
                      <td>{l.previa ? dataBr(l.previa.vencimento) : "—"}</td>
                      <td>{l.previa ? <Money value={l.previa.liquido} /> : "—"}</td>
                      <td>
                        <span className="fe-rec-estado">{l.estado === "lancado" && <Check size={13} aria-hidden="true" />}{ROTULO[l.estado]}</span>
                        {l.erro && <small className="fe-rec-erro">{l.erro}</small>}
                        {l.estado === "ambiguo" && l.candidatos && (
                          <label className="fe-rec-escolha">
                            <span>Quem é?</span>
                            <select defaultValue="" onChange={(e) => { if (e.target.value) { mudar(l.chave, { estado: "lendo" }); void ler(l.chave, l.base64, l.arquivo, e.target.value); } }}>
                              <option value="">Escolha…</option>
                              {l.candidatos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                          </label>
                        )}
                        {l.previa?.avisos.map((a) => <small key={a} className="fe-rec-aviso">⚠ {a}</small>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p role="status" className="fe-rec-resumo">
            {lancadas > 0 ? `${lancadas} ${plural(lancadas, "recibo lançado", "recibos lançados")} no Contas a Pagar. ` : ""}
            {linhas.some((l) => l.estado === "recusado") && <Alert tone="warning" role={undefined}>Os recibos que não dá para lançar ficam de fora; a mensagem diz o motivo.</Alert>}
          </p>
        </div>

        <footer className="fe-imp-base">
          <Button variant="secondary" disabled={lancando} onClick={fechar}>{lancadas > 0 ? "Concluir" : "Cancelar"}</Button>
          <Button leadingIcon={<Check size={16} />} aria-disabled={escolhidas.length === 0 || lancando} onClick={() => { if (escolhidas.length > 0 && !lancando) void lancar(); }}>
            {lancando ? "Lançando…" : escolhidas.length > 0 ? `Lançar ${escolhidas.length} no Contas a Pagar` : "Lançar no Contas a Pagar"}
          </Button>
        </footer>
      </section>
    </div>
  );
}

