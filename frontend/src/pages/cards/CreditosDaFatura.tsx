import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import type { CreditCardFinal, CreditCardStatementDetail } from "../../api/client";
import { Button, Money } from "../../design-system";
import { Dialog } from "../../components/ui/Dialog";
import { formatDate } from "../../utils/format";
import { rotuloDoFinal, tipoDoFinal } from "./cartoes-vinculados";
import "./creditos-da-fatura.css";

type Ajuste = NonNullable<CreditCardStatementDetail["adjustments"]>[number];

export type NovoAjuste = {
  tipo: "ESTORNO" | "COBRANCA_ESTORNADA";
  description: string;
  valor: string;
  cardFinalId: string | null;
  adjustmentDate: string | null;
};

type Props = {
  detalhe: CreditCardStatementDetail;
  editavel: boolean;
  finais: CreditCardFinal[];
  onAdicionar: (ajuste: NovoAjuste) => Promise<boolean>;
  onRemover: (ajuste: Ajuste) => Promise<void>;
  /** Passa o lançamento para outro cartão (null = fatura toda). */
  onTrocarCartao: (ajuste: Ajuste, cardFinalId: string | null) => Promise<void>;
  /** Grava o total da fatura como o banco informa ("" apaga). */
  onTotalDoBanco: (valor: string) => Promise<boolean>;
};

const VAZIO: NovoAjuste = { tipo: "ESTORNO", description: "", valor: "", cardFinalId: null, adjustmentDate: null };

function emCentavos(valor: string | number): number {
  return Math.round(Number(valor) * 100);
}

export function CreditosDaFatura({ detalhe, editavel, finais, onAdicionar, onRemover, onTrocarCartao, onTotalDoBanco }: Props) {
  const ajustes = detalhe.adjustments ?? [];
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<NovoAjuste>(VAZIO);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [gravado, setGravado] = useState(false);

  const totalDosItens = detalhe.totalDosItens ?? 0;
  const totalDosAjustes = detalhe.totalDosAjustes ?? 0;
  const totalDaFatura = Number(detalhe.totalAmount ?? 0);
  const declarado = detalhe.statedTotalAmount != null ? Number(detalhe.statedTotalAmount).toFixed(2).replace(".", ",") : "";
  const diferenca = detalhe.statedTotalAmount != null ? (emCentavos(totalDaFatura) - emCentavos(detalhe.statedTotalAmount)) / 100 : null;
  const valorValido = Number(form.valor.replace(/\./g, "").replace(",", ".")) > 0;
  const nomeDoCartao = (id: string | null) => {
    const final = finais.find((f) => f.id === id) ?? (detalhe.creditCard.finais ?? []).find((f) => f.id === id);
    return final ? `${tipoDoFinal(final.kind)} ·· ${final.last4Digits}` : "Fatura toda";
  };

  async function salvar() {
    setTentou(true);
    if (!form.description.trim() || !valorValido || salvando) return;
    setSalvando(true);
    try {
      if (await onAdicionar(form)) {
        setAberto(false);
        setForm(VAZIO);
        setTentou(false);
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="fatura-creditos" aria-label="Créditos e estornos e total da fatura">
      <header>
        <div>
          <h3>Créditos e estornos</h3>
          <p>O que o banco lança na fatura e não é uma compra do sistema (ex.: estorno de compra cancelada). Muda o total e o valor a pagar; não entra no DRE nem no CMV.</p>
        </div>
        {editavel && (
          <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setAberto(true)}>
            Adicionar crédito ou estorno
          </Button>
        )}
      </header>

      {ajustes.length === 0 ? (
        <p className="fatura-creditos-vazio">Nenhum crédito ou estorno nesta fatura.</p>
      ) : (
        <ul className="fatura-creditos-lista">
          {ajustes.map((ajuste) => (
            <li key={ajuste.id}>
              <span className="fatura-creditos-data">{formatDate(ajuste.adjustmentDate ?? ajuste.createdAt)}</span>
              <div className="fatura-creditos-desc">
                <strong>{ajuste.description}</strong>
                <small>{ajuste.kind === "ESTORNO" ? "Estorno / crédito" : "Cobrança já estornada"}</small>
                {editavel ? (
                  <label className="fatura-creditos-cartao">
                    <span>Cartão:</span>
                    <select
                      value={ajuste.cardFinalId ?? ""}
                      aria-label={`Cartão do lançamento: ${ajuste.description}`}
                      onChange={(event) => void onTrocarCartao(ajuste, event.target.value || null)}
                    >
                      <option value="">Fatura toda (fora dos cartões)</option>
                      {finais.map((final) => <option key={final.id} value={final.id}>{tipoDoFinal(final.kind)} — {rotuloDoFinal(final)}</option>)}
                    </select>
                  </label>
                ) : (
                  <small>Cartão: {nomeDoCartao(ajuste.cardFinalId)}</small>
                )}
              </div>
              <span className={`fatura-creditos-valor${Number(ajuste.amount) < 0 ? " credito" : ""}`}><Money value={ajuste.amount} /></span>
              {editavel && (
                <button
                  type="button"
                  className="fatura-icone"
                  aria-label={`Remover: ${ajuste.description}`}
                  title="Remover este lançamento"
                  onClick={() => { if (window.confirm(`Remover "${ajuste.description}" da fatura?`)) void onRemover(ajuste); }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <dl className="fatura-creditos-conta">
        <div><dt>Compras da fatura</dt><dd><Money value={totalDosItens} /></dd></div>
        <div><dt>Créditos e estornos</dt><dd className={totalDosAjustes < 0 ? "credito" : ""}><Money value={totalDosAjustes} /></dd></div>
        <div className="total"><dt>Total a pagar</dt><dd><Money value={totalDaFatura} /></dd></div>
      </dl>

      {editavel && (
        <label className="fatura-creditos-banco">
          <span>Total da fatura no banco</span>
          <input
            inputMode="decimal"
            placeholder="R$ 0,00"
            value={rascunho ?? declarado}
            onChange={(event) => setRascunho(event.target.value)}
            onBlur={() => {
              if (rascunho === null || rascunho === declarado) return;
              void onTotalDoBanco(rascunho).then((ok) => {
                if (!ok) return;
                setRascunho(null);
                setGravado(true);
                window.setTimeout(() => setGravado(false), 2500);
              });
            }}
          />
          {gravado && <span className="fatura-cartao-gravado" role="status">Total gravado</span>}
          {diferenca !== null && diferenca === 0 && !gravado && <span className="fatura-cartao-ok"><Check size={14} /> Bate com o banco</span>}
          {diferenca !== null && diferenca !== 0 && (
            <span className="fatura-cartao-diferenca">
              Diferença de <Money value={Math.abs(diferenca)} /> {diferenca < 0 ? "a menos" : "a mais"} que o banco
            </span>
          )}
        </label>
      )}

      {aberto && (
        <Dialog
          open
          onOpenChange={(estado) => { if (!estado && !salvando) { setAberto(false); setTentou(false); } }}
          title="Adicionar crédito ou estorno"
          description="Lance o que o banco colocou na fatura e que não é uma compra do sistema."
          size="md"
        >
          <form className="fatura-creditos-form" noValidate onSubmit={(event) => { event.preventDefault(); void salvar(); }}>
            <fieldset>
              <legend>Tipo</legend>
              <label>
                <input type="radio" name="tipo-ajuste" checked={form.tipo === "ESTORNO"} onChange={() => setForm({ ...form, tipo: "ESTORNO" })} />
                <span><strong>Estorno / crédito</strong><small>Reduz a fatura (ex.: compra cancelada que o banco devolveu).</small></span>
              </label>
              <label>
                <input type="radio" name="tipo-ajuste" checked={form.tipo === "COBRANCA_ESTORNADA"} onChange={() => setForm({ ...form, tipo: "COBRANCA_ESTORNADA" })} />
                <span><strong>Cobrança já estornada</strong><small>Aumenta a fatura: o banco cobrou uma compra que foi cancelada no sistema e estornou em outra fatura. Não vira despesa.</small></span>
              </label>
            </fieldset>

            <label className="fatura-creditos-campo">
              Descrição
              <input value={form.description} maxLength={200} placeholder="Ex.: Estorno compra cancelada" onChange={(event) => setForm({ ...form, description: event.target.value })} aria-invalid={tentou && !form.description.trim()} />
              {tentou && !form.description.trim() && <span className="fatura-creditos-erro">Informe a descrição.</span>}
            </label>
            <div className="fatura-creditos-duas">
              <label className="fatura-creditos-campo">
                Valor (sempre positivo)
                <input value={form.valor} inputMode="decimal" placeholder="0,00" onChange={(event) => setForm({ ...form, valor: event.target.value })} aria-invalid={tentou && !valorValido} />
                {tentou && !valorValido && <span className="fatura-creditos-erro">Informe um valor maior que zero.</span>}
              </label>
              <label className="fatura-creditos-campo">
                Data (opcional)
                <input type="date" value={form.adjustmentDate ?? ""} onChange={(event) => setForm({ ...form, adjustmentDate: event.target.value || null })} />
              </label>
            </div>
            <label className="fatura-creditos-campo">
              Cartão
              <select value={form.cardFinalId ?? ""} onChange={(event) => setForm({ ...form, cardFinalId: event.target.value || null })}>
                <option value="">Fatura toda (fora dos cartões)</option>
                {finais.map((final) => <option key={final.id} value={final.id}>{tipoDoFinal(final.kind)} — {rotuloDoFinal(final)}</option>)}
              </select>
              <small>Escolha um cartão só se o extrato <strong>desse cartão</strong> já inclui o crédito. Se o crédito aparece só no total da fatura, deixe "Fatura toda".</small>
            </label>
            <div className="fatura-creditos-rodape">
              <Button variant="secondary" onClick={() => { setAberto(false); setTentou(false); }}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}

