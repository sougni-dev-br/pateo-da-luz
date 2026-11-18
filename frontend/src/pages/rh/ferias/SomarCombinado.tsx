import { Calculator, Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type MesDaGorjetaFerias, type PreviaFeriasCombinado, somarCombinadoAFerias } from "../../../api/client";
import { Alert, Button, Money } from "../../../design-system";
import { plural } from "./feriasFormato";
import "./somarCombinado.css";

type Props = {
  /** O título de pagamento das férias (veio do recibo da contabilidade). */
  pagamentoId: string;
  nome: string;
  onClose: () => void;
  /** Chamado quando o complemento foi gravado no título, para a tela recarregar. */
  onAplicou: () => void;
};

const ORIGEM: Record<MesDaGorjetaFerias["origem"], string> = { APURACAO: "Apuração do ERP", INFORMADA: "Informada à mão", AUSENTE: "Sem apuração" };
const mesBr = (chave: string) => `${chave.slice(5)}/${chave.slice(0, 4)}`;

// Formato brasileiro: "1.200,50", "1200,50", "1.200" (milhar), "1200", "0,5". Vazio = não informado; qualquer outro formato
// (inclusive "1,200.50" ou "1.2") = NaN, nunca um valor adivinhado.
export function lerValor(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null;
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(t)) return Number.NaN;
  return Number(t.replace(/\./g, "").replace(",", "."));
}

/**
 * Soma ao título de férias (do recibo da contabilidade) a diferença do salário combinado e da gorjeta integral:
 * ((combinado + média da gorjeta dos 12 meses) × 4/3) − líquido do recibo. Primeiro a prévia, depois grava.
 */
export function SomarCombinado({ pagamentoId, nome, onClose, onAplicou }: Props) {
  const [previa, setPrevia] = useState<PreviaFeriasCombinado | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [somado, setSomado] = useState(false);
  // Gorjeta integral digitada à mão por mês (AAAA-MM → texto).
  const [digitadas, setDigitadas] = useState<Record<string, string>>({});
  const janela = useRef<HTMLElement>(null);

  // Só envia o que a pessoa digitou. Inválido para a ação e devolve null (a mensagem fica em `erro`).
  const informadas = useCallback((): Record<string, number> | undefined | null => {
    const out: Record<string, number> = {};
    for (const [chave, texto] of Object.entries(digitadas)) {
      const v = lerValor(texto);
      if (v === null) continue;
      if (Number.isNaN(v)) { setErro(`Valor inválido em ${mesBr(chave)}: use o formato 1.200,50 (ponto no milhar, vírgula nos centavos).`); return null; }
      out[chave] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [digitadas]);

  const rodar = useCallback(async (aplicar: boolean) => {
    const info = informadas();
    if (info === null) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await somarCombinadoAFerias(pagamentoId, aplicar, info);
      setPrevia(r.previa);
      setMotivo(r.motivo ?? null);
      if (aplicar && r.aplicado) { setSomado(true); onAplicou(); }
    } catch (e) {
      // Falha na prévia: sem o que mostrar. Falha ao gravar: mantém a prévia e os valores digitados para tentar de novo.
      if (!aplicar) setPrevia(null);
      setErro(e instanceof Error ? e.message : "Não consegui calcular o complemento.");
    } finally {
      setOcupado(false);
    }
  }, [informadas, pagamentoId, onAplicou]);

  useEffect(() => { void rodar(false); /* só ao abrir */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { janela.current?.focus(); }, []);

  const podeSomar = previa != null && !ocupado && !somado && previa.valorDepois !== previa.valorAntes;
  const mudaDeValor = previa != null && previa.valorDepois !== previa.valorAntes;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onClose(); }}>
      <section className="panel modal-panel fe-imp fe-comb" role="dialog" aria-modal="true" aria-labelledby="fe-comb-titulo" tabIndex={-1} ref={janela}
        onKeyDown={(e) => { if (e.key === "Escape" && !ocupado) onClose(); }}>
        <header className="fe-imp-topo">
          <div>
            <h2 id="fe-comb-titulo">Somar o salário combinado às férias</h2>
            <p>Complemento do título de férias: o recibo da contabilidade só cobre a carteira.</p>
          </div>
          <Button variant="secondary" size="sm" disabled={ocupado} onClick={onClose}>Fechar (Esc)</Button>
        </header>

        <div className="fe-comb-corpo">
          {erro && <Alert tone="error" role="alert">{erro}</Alert>}
          {!previa && !erro && <p role="status">Calculando…</p>}

          {previa && (
            <>
              <p className="fe-comb-quem"><strong>{previa.nome}</strong></p>
              <dl className="fe-comb-resumo">
                <div><dt>Líquido do recibo</dt><dd><Money value={previa.liquidoRecibo} /></dd></div>
                {previa.combinado != null && <div><dt>Salário combinado</dt><dd><Money value={previa.combinado} /></dd></div>}
                <div><dt>Média da gorjeta integral</dt><dd><Money value={previa.mediaGorjeta} /><small>{previa.mesesContados} {plural(previa.mesesContados, "mês", "meses")} com valor</small></dd></div>
                <div><dt>Devido nas férias (com 1/3)</dt><dd><Money value={previa.remuneracao} /></dd></div>
                <div><dt>Complemento a somar</dt><dd><Money value={previa.complemento} /></dd></div>
                <div className="fe-comb-total"><dt>Valor do título</dt><dd><Money value={previa.valorAntes} /> → <strong><Money value={previa.valorDepois} /></strong></dd></div>
              </dl>
              {previa.formula && <p className="fe-comb-formula">{previa.formula}.</p>}

              {previa.meses.length > 0 && (
                <div className="fe-comb-rolagem">
                  <table className="fe-comb-tabela">
                    <caption>Gorjeta integral de cada mês (média dos últimos 12 meses antes das férias)</caption>
                    <thead><tr><th scope="col">Mês</th><th scope="col">Origem</th><th scope="col">Valor</th></tr></thead>
                    <tbody>
                      {previa.meses.map((m) => (
                        <tr key={m.chave} className={m.origem === "AUSENTE" ? "fe-comb-ausente" : undefined}>
                          <td>{mesBr(m.chave)}</td>
                          <td>{ORIGEM[m.origem]}</td>
                          <td>
                            {m.origem === "APURACAO" && m.valor != null
                              ? <Money value={m.valor} />
                              : (
                                <input type="text" inputMode="decimal" className="fe-comb-campo" placeholder="informar"
                                  aria-label={`Gorjeta integral de ${mesBr(m.chave)}`}
                                  value={digitadas[m.chave] ?? (m.origem === "INFORMADA" && m.valor != null ? String(m.valor).replace(".", ",") : "")}
                                  disabled={ocupado || somado}
                                  onChange={(e) => setDigitadas((atual) => ({ ...atual, [m.chave]: e.target.value }))} />
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {previa.meses.some((m) => m.origem !== "APURACAO") && (
                <p className="fe-comb-formula">Campo vazio mantém o valor já guardado para o mês (informe 0 para zerar). Formato: 1.200,50.</p>
              )}
              {previa.avisos.map((a) => <Alert key={a} tone="warning" role={undefined}>{a}</Alert>)}
              {!mudaDeValor && !somado && <Alert tone="info" role={undefined}>{motivo ?? "Nada a somar: o título já está no valor devido."}</Alert>}
              {somado && <Alert tone="success" role="status">Somado ao título de férias no Contas a Pagar. Ele continua sendo um título só; pague o valor inteiro.</Alert>}
            </>
          )}
        </div>

        <footer className="fe-imp-base">
          {previa && !somado && (
            <Button variant="secondary" leadingIcon={<Calculator size={16} />} disabled={ocupado} onClick={() => void rodar(false)}>Recalcular</Button>
          )}
          {(previa || somado) && (
            <Button leadingIcon={<Check size={16} />} aria-disabled={!podeSomar} onClick={() => { if (podeSomar) void rodar(true); }}>
              {somado ? "Somado" : ocupado ? "Calculando…" : `Somar ao título ${previa?.nome ? `de ${previa.nome.split(" ")[0]}` : ""}`.trim()}
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}
