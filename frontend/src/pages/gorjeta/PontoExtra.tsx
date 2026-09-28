// Ponto extra da pessoa: soma (ou tira) dos pontos da função, sempre com
// justificativa. A função continua a mesma; o extra aparece separado.
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../design-system";
import { mutedStyle, numInputStyle, pts } from "./gorjetaUtils";

const MOTIVO_MINIMO = 5;
const sinal = (v: number) => `${v > 0 ? "+" : "−"}${pts(Math.abs(v))}`;

type CelulaProps = {
  extra: number | null;
  motivo: string | null;
  aberto: boolean;
  podeEditar: boolean;
  rotulo: string;
  onAbrir: () => void;
};

export function ExtraCelula({ extra, motivo, aberto, podeEditar, rotulo, onAbrir }: CelulaProps) {
  if (extra == null) {
    return podeEditar
      ? (
        <button type="button" className="extra-adicionar" onClick={onAbrir} aria-expanded={aberto} aria-label={`Adicionar ponto extra para ${rotulo}`}>
          <Plus size={12} /> extra
        </button>
      )
      : <span style={mutedStyle}>—</span>;
  }
  return (
    <button type="button" className={`extra-chip ${extra > 0 ? "extra-mais" : "extra-menos"}`} onClick={onAbrir} disabled={!podeEditar}
      aria-expanded={aberto} aria-label={`Ponto extra de ${rotulo}: ${sinal(extra)}. ${motivo ?? ""}`} title={motivo ?? undefined}>
      <strong>{sinal(extra)}</strong>
      <span className="extra-motivo">{motivo}</span>
      {podeEditar && <Pencil size={11} aria-hidden className="extra-lapis" />}
    </button>
  );
}

type EditorProps = {
  nome: string;
  pontosFuncao: number | null;
  extra: number | null;
  motivo: string | null;
  salvando: boolean;
  onSalvar: (extra: number | null, motivo: string | null) => void | Promise<void>;
  onCancelar: () => void;
};

export function EditorExtra({ nome, pontosFuncao, extra, motivo, salvando, onSalvar, onCancelar }: EditorProps) {
  const [valor, setValor] = useState(extra == null ? "" : String(extra));
  const [justificativa, setJustificativa] = useState(motivo ?? "");
  const numero = valor.trim() === "" ? null : Number(valor.replace(",", "."));
  const invalido = numero == null || Number.isNaN(numero) || numero === 0;
  const total = (pontosFuncao ?? 0) + (invalido ? 0 : numero!);
  const faltaMotivo = justificativa.trim().length < MOTIVO_MINIMO;
  const negativo = total < 0;

  return (
    <form className="editor-extra" onSubmit={(e) => { e.preventDefault(); if (!invalido && !faltaMotivo && !negativo) void onSalvar(numero, justificativa.trim()); }}>
      <div className="editor-extra-conta" aria-live="polite">
        <span>{nome}</span>
        <span style={mutedStyle}>função {pts(pontosFuncao ?? 0)}</span>
        <span style={mutedStyle}>{invalido ? "+ extra" : sinal(numero!)}</span>
        <span style={mutedStyle}>=</span>
        <strong style={{ color: negativo ? "var(--danger)" : undefined }}>{pts(total)} pts</strong>
      </div>
      <label className="editor-extra-campo">
        Ponto extra
        <input autoFocus type="number" step="0.5" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ex.: 1 ou −0,5"
          style={{ ...numInputStyle, width: 90, textAlign: "center" }} aria-label={`Ponto extra de ${nome}`} />
      </label>
      <label className="editor-extra-campo" style={{ flex: "1 1 280px" }}>
        Justificativa
        <input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="ex.: responsável pelo fechamento do caixa"
          aria-label={`Justificativa do ponto extra de ${nome}`} aria-invalid={!invalido && faltaMotivo} />
      </label>
      <div className="editor-extra-acoes">
        <Button type="submit" leadingIcon={<Check size={14} />} disabled={salvando || invalido || faltaMotivo || negativo}>Salvar extra</Button>
        {extra != null && (
          <Button type="button" variant="secondary" leadingIcon={<Trash2 size={14} />} disabled={salvando} onClick={() => void onSalvar(null, null)}>
            Tirar extra
          </Button>
        )}
        <button type="button" className="barra-lista-link" onClick={onCancelar}>cancelar</button>
      </div>
      <span style={{ ...mutedStyle, flexBasis: "100%" }}>
        {negativo ? "O extra não pode deixar a pessoa com pontos negativos."
          : !invalido && faltaMotivo ? `Escreva a justificativa (pelo menos ${MOTIVO_MINIMO} letras): ela fica no histórico e nos relatórios.`
            : "Vale a partir da data de vigência escolhida no topo da aba. A função da pessoa não muda."}
      </span>
    </form>
  );
}
