import { Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type MesDaGorjetaFerias, type PreviaFeriasCombinado, complementarFeriasCombinado } from "../../../api/client";
import { Alert, Button, Money } from "../../../design-system";
import "./importarRecibos.css";

type Props = {
  payrollItemId: string;
  nome: string;
  onClose: () => void;
  /** Chamado ao fechar quando o complemento foi gravado, para a tela recarregar. */
  onAplicou: () => void;
};

const ROTULO_ORIGEM: Record<MesDaGorjetaFerias["origem"], string> = { APURACAO: "apuração", INFORMADA: "informada à mão", AUSENTE: "sem apuração" };
const mesBr = (chave: string) => `${chave.slice(5, 7)}/${chave.slice(0, 4)}`;
// Aceita "1.234,56" e "1234.56"; vazio ou inválido = não informado.
function lerValor(texto: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Prévia e confirmação do complemento do salário combinado no título de férias. Nada é gravado antes de confirmar. */
export function ComplementarCombinado({ payrollItemId, nome, onClose, onAplicou }: Props) {
  const [previa, setPrevia] = useState<PreviaFeriasCombinado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const [aplicado, setAplicado] = useState(false);
  const [digitado, setDigitado] = useState<Record<string, string>>({});
  const dialogo = useRef<HTMLElement>(null);

  const informadas = useCallback((): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [chave, texto] of Object.entries(digitado)) {
      const v = lerValor(texto);
      if (v != null) out[chave] = v;
    }
    return out;
  }, [digitado]);

  const calcular = useCallback(async (gorjetas: Record<string, number>) => {
    setCalculando(true);
    setErro(null);
    setMotivo(null);
    try {
      const r = await complementarFeriasCombinado(payrollItemId, false, gorjetas);
      setPrevia(r.previa);
      setMotivo(r.motivo ?? null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui calcular o complemento.");
    } finally {
      setCalculando(false);
    }
  }, [payrollItemId]);

  useEffect(() => { void calcular({}); }, [calcular]);
  useEffect(() => { dialogo.current?.focus(); }, []);

  async function confirmar() {
    setAplicando(true);
    setErro(null);
    try {
      const r = await complementarFeriasCombinado(payrollItemId, true, informadas());
      setPrevia(r.previa);
      if (r.aplicado) setAplicado(true);
      else setMotivo(r.motivo ?? "Nada foi gravado.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui gravar o complemento.");
    } finally {
      setAplicando(false);
    }
  }

  const ocupado = calculando || aplicando;
  const podeConfirmar = !!previa && !aplicado && !ocupado && (previa.complemento > 0 || previa.valorDepois !== previa.valorAntes);
  const sair = () => { if (aplicado) onAplicou(); onClose(); };
  // Meses que não vieram de apuração: é onde a gorjeta pode ser informada à mão.
  const mesesEditaveis = previa?.meses.filter((m) => m.origem !== "APURACAO") ?? [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) sair(); }}>
      <section ref={dialogo} tabIndex={-1} className="panel modal-panel fe-imp fe-rec" role="dialog" aria-modal="true" aria-labelledby="fe-comb-titulo"
        onKeyDown={(e) => { if (e.key === "Escape" && !ocupado) sair(); }}>
        <header className="fe-imp-topo">
          <div>
            <h2 id="fe-comb-titulo">Complementar pelo combinado — {nome}</h2>
            <p>Nas férias a pessoa leva para casa o mesmo que trabalhando, mais 1/3; a empresa absorve o IR e o INSS do recibo. Nada é gravado antes de você confirmar.</p>
          </div>
          <Button variant="secondary" size="sm" disabled={ocupado} onClick={sair}>Fechar (Esc)</Button>
        </header>

        <div className="fe-rec-corpo">
          {calculando && !previa && <p className="fe-ajuda" role="status">Calculando a prévia…</p>}
          {erro && <Alert tone="error">{erro}</Alert>}
          {aplicado && <Alert tone="success">Complemento gravado no título de férias.</Alert>}
          {motivo && !aplicado && <Alert tone="warning">{motivo}</Alert>}

          {previa && (
            <>
              <dl className="fe-comb-resumo">
                <div><dt>Líquido do recibo</dt><dd><Money value={previa.liquidoRecibo} /></dd></div>
                <div><dt>Salário combinado vigente</dt><dd>{previa.combinado == null ? "Sem combinado vigente" : <Money value={previa.combinado} />}</dd></div>
                <div><dt>Média da gorjeta (12 meses)</dt><dd><Money value={previa.mediaGorjeta} /> <small>em {previa.mesesContados} {previa.mesesContados === 1 ? "mês" : "meses"}</small></dd></div>
                <div><dt>Remuneração devida</dt><dd><Money value={previa.remuneracao} /></dd></div>
                <div><dt>Complemento</dt><dd><strong><Money value={previa.complemento} /></strong></dd></div>
                <div><dt>Título hoje</dt><dd><Money value={previa.valorAntes} /></dd></div>
                <div><dt>Novo valor do título</dt><dd><strong><Money value={previa.valorDepois} /></strong></dd></div>
              </dl>
              {previa.formula && <p className="fe-comb-formula"><b>Fórmula:</b> {previa.formula}</p>}
              {previa.avisos.map((a) => <p key={a} className="fe-rec-aviso">⚠ {a}</p>)}

              {previa.meses.length > 0 && (
                <div className="fe-rec-rolagem">
                  <table className="fe-rec-tabela">
                    <caption className="fe-sr">Gorjeta integral dos 12 meses da média</caption>
                    <thead><tr><th scope="col">Mês</th><th scope="col">Gorjeta</th><th scope="col">Origem</th></tr></thead>
                    <tbody>
                      {previa.meses.map((m) => (
                        <tr key={m.chave}>
                          <td>{mesBr(m.chave)}</td>
                          <td>{m.valor == null ? "—" : <Money value={m.valor} />}</td>
                          <td>{ROTULO_ORIGEM[m.origem]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {mesesEditaveis.length > 0 && !aplicado && (
                <fieldset className="fe-comb-manual" disabled={ocupado}>
                  <legend>Informar a gorjeta de um mês à mão</legend>
                  <p className="fe-sub">Use nos meses sem apuração no ERP. Depois de preencher, recalcule a prévia.</p>
                  {mesesEditaveis.map((m) => (
                    <label key={m.chave} className="fe-comb-campo">
                      <span>Gorjeta de {mesBr(m.chave)}</span>
                      <input type="text" inputMode="decimal" placeholder="0,00" value={digitado[m.chave] ?? (m.origem === "INFORMADA" && m.valor != null ? String(m.valor) : "")}
                        onChange={(e) => setDigitado((d) => ({ ...d, [m.chave]: e.target.value }))} />
                    </label>
                  ))}
                </fieldset>
              )}
            </>
          )}
        </div>

        <footer className="fe-imp-base">
          <Button variant="secondary" disabled={aplicando} onClick={sair}>{aplicado ? "Concluir" : "Cancelar"}</Button>
          {!aplicado && (
            <Button variant="secondary" leadingIcon={<RefreshCw size={14} />} disabled={ocupado} onClick={() => void calcular(informadas())}>Recalcular prévia</Button>
          )}
          {!aplicado && (
            <Button leadingIcon={<Check size={16} />} aria-disabled={!podeConfirmar} onClick={() => { if (podeConfirmar) void confirmar(); }}>
              {aplicando ? "Gravando…" : "Confirmar e somar ao título"}
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}
