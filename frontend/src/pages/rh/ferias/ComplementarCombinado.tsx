import { Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type MesDaGorjetaFerias, type PreviaFeriasCombinado, complementarFeriasCombinado } from "../../../api/client";
import { Alert, Button, Money } from "../../../design-system";
import "./importarRecibos.css";
import "./complementarCombinado.css";

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
  // Valores digitados com que a prévia exibida foi calculada ("{}" = nenhum).
  const [calculadoCom, setCalculadoCom] = useState("{}");
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
      setCalculadoCom(JSON.stringify(gorjetas));
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
  // Valores digitados que a prévia na tela ainda não considerou: confirmar agora gravaria um número que ninguém viu.
  const desatualizado = JSON.stringify(informadas()) !== calculadoCom;
  const podeConfirmar = !!previa && !aplicado && !ocupado && !desatualizado && (previa.complemento > 0 || previa.valorDepois !== previa.valorAntes);
  const sair = () => { if (aplicado) onAplicou(); onClose(); };
  const meses = previa?.meses ?? [];
  const contagem = (o: MesDaGorjetaFerias["origem"]) => meses.filter((m) => m.origem === o).length;
  const remuneracaoMensal = previa && previa.combinado != null ? previa.combinado + previa.mediaGorjeta : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) sair(); }}>
      <section ref={dialogo} tabIndex={-1} className="panel modal-panel fe-imp fe-rec fe-comb" role="dialog" aria-modal="true" aria-labelledby="fe-comb-titulo"
        onKeyDown={(e) => { if (e.key === "Escape" && !ocupado) sair(); }}>
        <header className="fe-imp-topo fe-comb-topo">
          <div>
            <p className="fe-comb-eyebrow">Férias · salário combinado</p>
            <h2 id="fe-comb-titulo">Complementar pelo combinado — {nome}</h2>
            <p>Nas férias a pessoa leva para casa o mesmo que trabalhando, mais 1/3; a empresa absorve o IR e o INSS do recibo. Nada é gravado antes de você confirmar.</p>
          </div>
          <Button variant="secondary" size="sm" disabled={ocupado} onClick={sair}>Fechar (Esc)</Button>
        </header>

        <div className="fe-rec-corpo fe-comb-corpo">
          {calculando && !previa && <p className="fe-ajuda" role="status">Calculando a prévia…</p>}
          {erro && <Alert tone="error">{erro}</Alert>}
          {aplicado && <Alert tone="success">Complemento gravado no título de férias.</Alert>}
          {motivo && !aplicado && <Alert tone="warning">{motivo}</Alert>}

          {previa && (
            <>
              <div className="fe-comb-destaque" aria-busy={calculando}>
                <div className="fe-comb-valor">
                  <span>Título hoje</span>
                  <b><Money value={previa.valorAntes} /></b>
                </div>
                <span className="fe-comb-sinal" aria-hidden="true">+</span>
                <div className="fe-comb-valor">
                  <span>Complemento</span>
                  <b><Money value={previa.complemento} /></b>
                </div>
                <span className="fe-comb-sinal" aria-hidden="true">=</span>
                <div className="fe-comb-valor fe-comb-valor--final">
                  <span>Novo valor do título</span>
                  <b><Money value={previa.valorDepois} /></b>
                </div>
              </div>

              <section className="fe-comb-bloco" aria-labelledby="fe-comb-conta">
                <h3 id="fe-comb-conta">Como chegamos nesse valor</h3>
                <ol className="fe-comb-conta">
                  <li><span>Salário combinado vigente</span><b>{previa.combinado == null ? "Sem combinado vigente" : <Money value={previa.combinado} />}</b></li>
                  <li>
                    <span>Média da gorjeta <small>({previa.mesesContados} {previa.mesesContados === 1 ? "mês contado" : "meses contados"} de 12)</small></span>
                    <b><Money value={previa.mediaGorjeta} /></b>
                  </li>
                  {remuneracaoMensal != null && <li className="fe-comb-conta-soma"><span>Remuneração mensal</span><b><Money value={remuneracaoMensal} /></b></li>}
                  <li className="fe-comb-conta-soma"><span>Remuneração devida nas férias <small>(já com o 1/3)</small></span><b><Money value={previa.remuneracao} /></b></li>
                  <li><span>Líquido do recibo da contabilidade <small>(já descontados IR e INSS)</small></span><b>− <Money value={previa.liquidoRecibo} /></b></li>
                  <li className="fe-comb-conta-soma"><span>Complemento a pagar</span><b><Money value={previa.complemento} /></b></li>
                </ol>
                {previa.formula && <p className="fe-comb-formula"><b>Fórmula:</b> {previa.formula}</p>}
              </section>

              {previa.avisos.map((a) => <p key={a} className="fe-rec-aviso fe-comb-alerta">⚠ {a}</p>)}

              {meses.length > 0 && (
                <section className="fe-comb-bloco" aria-labelledby="fe-comb-meses">
                  <div className="fe-comb-meses-topo">
                    <div>
                      <h3 id="fe-comb-meses">Gorjeta dos 12 meses da média</h3>
                      <p className="fe-sub">
                        {contagem("APURACAO")} com apuração · {contagem("INFORMADA")} informada{contagem("INFORMADA") === 1 ? "" : "s"} à mão · {contagem("AUSENTE")} sem valor.
                        {" "}Nos meses sem apuração você pode digitar a gorjeta; mês com apuração usa sempre a apuração.
                      </p>
                    </div>
                    {!aplicado && (
                      <Button variant={desatualizado ? "primary" : "secondary"} size="sm" leadingIcon={<RefreshCw size={14} />} disabled={ocupado} onClick={() => void calcular(informadas())}>Recalcular prévia</Button>
                    )}
                  </div>
                  {desatualizado && !aplicado && <p className="fe-comb-alerta fe-comb-pendente" role="status">Você mudou valores: recalcule a prévia para ver o novo complemento antes de confirmar.</p>}
                  <ul className="fe-comb-meses">
                    {meses.map((m) => {
                      const editavel = m.origem !== "APURACAO" && !aplicado;
                      return (
                        <li key={m.chave} className={`fe-comb-mes fe-comb-mes--${m.origem.toLowerCase()}`}>
                          <span className="fe-comb-mes-nome">{mesBr(m.chave)}</span>
                          <span className="fe-comb-mes-origem">{ROTULO_ORIGEM[m.origem]}</span>
                          {editavel ? (
                            <input type="text" inputMode="decimal" placeholder="0,00" aria-label={`Gorjeta de ${mesBr(m.chave)}`} disabled={ocupado}
                              value={digitado[m.chave] ?? (m.origem === "INFORMADA" && m.valor != null ? String(m.valor) : "")}
                              onChange={(e) => setDigitado((d) => ({ ...d, [m.chave]: e.target.value }))} />
                          ) : (
                            <b className="fe-comb-mes-valor">{m.valor == null ? "—" : <Money value={m.valor} />}</b>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="fe-imp-base">
          <Button variant="secondary" disabled={aplicando} onClick={sair}>{aplicado ? "Concluir" : "Cancelar"}</Button>
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
