import { RefreshCw, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TipComputation } from "../../api/client";
import { Button } from "../../design-system";
import { inputStyle, money, mutedStyle, numInputStyle, panelStyle } from "./gorjetaUtils";

type Props = {
  comp: TipComputation;
  onSalvar: (ajuste: number, motivo: string | null) => Promise<void>;
  onAtualizarFaturamento: () => Promise<void>;
  onFechar: () => void;
  onErro: (e: unknown) => void;
};

// Serviço arrecadado = o que o faturamento registrou + ajuste (serviço que não
// passa pelo sistema). É o "ajuste na célula" da planilha, com motivo guardado.
export function AjusteServico({ comp, onSalvar, onAtualizarFaturamento, onFechar, onErro }: Props) {
  const [ajuste, setAjuste] = useState(comp.ajusteServico ? String(comp.ajusteServico) : "");
  const [motivo, setMotivo] = useState(comp.ajusteServicoMotivo ?? "");
  const [ocupado, setOcupado] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    painel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    campo.current?.focus({ preventScroll: true });
  }, []);

  const valor = Number(ajuste.replace(",", ".")) || 0;
  const total = Math.round((comp.servicoFaturamento + valor) * 100) / 100;
  const precisaMotivo = Math.abs(valor) >= 0.005 && !motivo.trim();

  async function executar(fn: () => Promise<void>) {
    setOcupado(true);
    try { await fn(); } catch (e) { onErro(e); } finally { setOcupado(false); }
  }

  return (
    <div ref={painel} style={{ ...panelStyle, borderLeft: "3px solid var(--gold)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong>Ajustar serviço arrecadado</strong>
        <button type="button" onClick={onFechar} aria-label="Fechar" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><X size={16} /></button>
      </div>
      <div className="barra-lista" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span>Do faturamento: <strong>{money(comp.servicoFaturamento)}</strong></span>
        <span style={{ color: "var(--muted)" }}>+</span>
        <label className="barra-lista-campo">
          Ajuste
          <input ref={campo} type="number" step="0.01" value={ajuste} onChange={(e) => setAjuste(e.target.value)}
            placeholder="0,00" style={{ ...numInputStyle, width: 130 }} aria-label="Valor do ajuste (negativo para tirar)" />
        </label>
        <span style={{ color: "var(--muted)" }}>=</span>
        <span>Serviço arrecadado: <strong style={{ fontSize: 16 }}>{money(total)}</strong></span>
      </div>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (ex.: evento de 12/09 recebido fora do PDV)"
        style={{ ...inputStyle, borderColor: precisaMotivo ? "var(--danger)" : undefined }} aria-label="Motivo do ajuste" />
      <span style={mutedStyle}>
        Use valor negativo para tirar. O ajuste continua valendo quando o faturamento é atualizado ou as datas do período mudam.
      </span>
      <div className="barra-lista">
        <Button leadingIcon={<Save size={14} />} disabled={ocupado || precisaMotivo || total < 0}
          onClick={() => void executar(() => onSalvar(valor, motivo.trim() || null))}>
          Salvar ajuste
        </Button>
        <Button variant="secondary" leadingIcon={<RefreshCw size={14} />} disabled={ocupado}
          onClick={() => void executar(onAtualizarFaturamento)} title="Busca de novo o serviço no faturamento do período">
          Atualizar do faturamento
        </Button>
        {precisaMotivo && <span style={{ color: "var(--danger)", fontSize: 12 }}>Informe o motivo do ajuste.</span>}
      </div>
    </div>
  );
}
