import { Eraser, RefreshCw, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type TipPreviaCadastro, getTipSyncPreview, limparTipDesligados } from "../../api/client";
import { Button } from "../../design-system";
import { useConfirmacao } from "./Confirmacao";
import { mutedStyle } from "./gorjetaUtils";

type Props = {
  periodId: string;
  /** Muda quando a apuração é recalculada: a prévia é lida de novo. */
  versao: unknown;
  ocupado: boolean;
  podeAtualizar: boolean;
  onAtualizar: () => void;
  onNotice?: (tone: "success" | "error", message: string) => void;
};

const LIMITE_LISTA = 6;
const ESPERA_MS = 600;

const caixa = {
  border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", background: "var(--paper-soft, #f6f7f9)",
  display: "flex", flexDirection: "column", gap: 6, fontSize: 14,
} as const;

// Avisa que o cadastro dos funcionários mudou desde a última atualização do período (o que
// "Atualizar do cadastro" faria) e explica quem está fora do rateio e por quê. A prévia é só
// leitura e é refeita ao recalcular a apuração e ao voltar para esta aba do navegador, que é
// quando alguém acaba de mexer no cadastro.
export function AvisoCadastro({ periodId, versao, ocupado, podeAtualizar, onAtualizar, onNotice }: Props) {
  const [previa, setPrevia] = useState<TipPreviaCadastro | null>(null);
  const [, setFalhou] = useState(false);
  const [verFora, setVerFora] = useState(false);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [limpando, setLimpando] = useState(false);
  const { confirmar, caixa: caixaConfirmacao } = useConfirmacao();

  // Outro período: a prévia do anterior não pode ficar na tela esperando a nova resposta.
  useEffect(() => { setPrevia(null); setFalhou(false); }, [periodId]);

  useEffect(() => {
    let ativo = true;
    let pedido = 0;
    const ler = () => {
      if (espera.current) clearTimeout(espera.current);
      espera.current = setTimeout(() => {
        const meu = ++pedido;
        getTipSyncPreview(periodId)
          .then((p) => { if (ativo && meu === pedido) { setPrevia(p); setFalhou(false); } })
          .catch(() => { if (ativo && meu === pedido) setFalhou(true); });
      }, ESPERA_MS);
    };
    ler();
    const aoVoltar = () => { if (document.visibilityState === "visible") ler(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", ler);
    return () => {
      ativo = false;
      if (espera.current) clearTimeout(espera.current);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", ler);
    };
  }, [periodId, versao]);

  async function limpar() {
    const lista = previa?.desligadosParaLimpar ?? [];
    const nomes = lista.map((p) => p.nome);
    const ok = await confirmar({
      titulo: `Limpar "Participa da gorjeta" de ${nomes.length} desligado(s)?`,
      texto: `${nomes.join(", ")}. A marca sai do cadastro (fica registrado no histórico, com a data da saída). Nada muda nos ciclos já fechados nem no ciclo aberto.`,
      confirmar: "Limpar do cadastro",
    });
    if (!ok) return;
    setLimpando(true);
    try {
      const r = await limparTipDesligados(periodId, lista.map((p) => p.employeeId));
      onNotice?.("success", `${r.limpos} cadastro(s) limpo(s): ${r.nomes.join(", ")}.`);
      setPrevia(await getTipSyncPreview(periodId));
    } catch (e) {
      onNotice?.("error", (e as Error).message);
    } finally {
      setLimpando(false);
    }
  }

  if (!previa) return null;
  const { diferencas, foraDoRateio, desligadosComParticipaMarcado } = previa;
  if (diferencas.length === 0 && foraDoRateio.length === 0 && desligadosComParticipaMarcado === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {caixaConfirmacao}
      {diferencas.length > 0 && (
        <section aria-label="O cadastro mudou" style={{ ...caixa, borderColor: "var(--warning, #c9a24a)" }}>
          <strong>O cadastro mudou desde a última atualização ({diferencas.length}).</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {diferencas.slice(0, LIMITE_LISTA).map((d, i) => (
              <li key={`${d.employeeId}-${d.tipo}-${i}`}><strong>{d.nome}</strong>: {d.detalhe}</li>
            ))}
          </ul>
          {diferencas.length > LIMITE_LISTA && <span style={mutedStyle}>e mais {diferencas.length - LIMITE_LISTA}…</span>}
          {podeAtualizar && (
            <div>
              <Button size="sm" onClick={onAtualizar} disabled={ocupado} leadingIcon={<RefreshCw size={14} />}>
                Atualizar agora
              </Button>
            </div>
          )}
        </section>
      )}

      {(foraDoRateio.length > 0 || desligadosComParticipaMarcado > 0) && (
        <section aria-label="Fora do rateio" style={caixa}>
          <button type="button" onClick={() => setVerFora((v) => !v)} aria-expanded={verFora}
            style={{ all: "unset", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
            <UserX size={15} aria-hidden />
            Fora do rateio neste ciclo ({foraDoRateio.length}) {verFora ? "▾" : "▸"}
          </button>
          {verFora && (
            <>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {foraDoRateio.map((f) => (
                  <li key={f.employeeId}><strong>{f.nome}</strong>: {f.motivo}</li>
                ))}
              </ul>
              {desligadosComParticipaMarcado > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={mutedStyle}>
                    {desligadosComParticipaMarcado} desligado(s) de ciclos já fechados ainda estão com "Participa da gorjeta" marcado
                    no cadastro: {(previa.desligadosParaLimpar ?? []).map((p) => p.nome).join(", ")}. Não entram na apuração.
                  </span>
                  {podeAtualizar && (
                    <div>
                      <Button size="sm" variant="secondary" onClick={() => void limpar()} disabled={ocupado || limpando} leadingIcon={<Eraser size={14} />}>
                        Limpar do cadastro
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
