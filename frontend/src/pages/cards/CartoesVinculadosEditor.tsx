import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { saveCardFinal, type CreditCardFinal } from "../../api/client";
import { StatusBadge } from "../../design-system";
import { tipoDoFinal } from "./cartoes-vinculados";
import "./cards-finais.css";

type Props = {
  cardId: string;
  finais: CreditCardFinal[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
};

const vazio = { id: "", label: "", last4Digits: "", kind: "PHYSICAL" };

export function CartoesVinculadosEditor({ cardId, finais, onChanged, onError }: Props) {
  const [form, setForm] = useState(vazio);
  const [salvando, setSalvando] = useState(false);

  async function salvar(payload: { id?: string; label: string; last4Digits: string; kind: string; isActive?: boolean }) {
    setSalvando(true);
    try {
      await saveCardFinal(cardId, payload);
      setForm(vazio);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Erro ao salvar o cartão.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="cartoes-vinculados-editor" aria-label="Cartões desta conta">
      <h3>Cartões desta conta (físico e virtual)</h3>
      <p className="text-muted">
        A fatura do banco é uma só, mas pode trazer mais de um cartão. Cadastre cada final para classificar os
        lançamentos dentro da fatura e conferir o subtotal de cada um com o extrato.
      </p>
      {finais.length === 0 && <p className="text-muted">Nenhum cartão cadastrado nesta conta ainda.</p>}
      {finais.map((final) => (
        <div key={final.id} className="cartoes-vinculados-linha">
          <strong>{final.label}</strong>
          <span>{tipoDoFinal(final.kind)} · final {final.last4Digits}</span>
          <StatusBadge tone={final.isActive ? "success" : "neutral"}>{final.isActive ? "Ativo" : "Inativo"}</StatusBadge>
          <button
            type="button"
            disabled={salvando}
            onClick={() => void salvar({ id: final.id, label: final.label, last4Digits: final.last4Digits, kind: final.kind, isActive: !final.isActive })}
          >
            {final.isActive ? "Inativar" : "Reativar"}
          </button>
        </div>
      ))}
      <div className="cartoes-vinculados-linha">
        <label>
          Nome
          <input value={form.label} placeholder="Ex.: Físico" onChange={(event) => setForm({ ...form, label: event.target.value })} />
        </label>
        <label>
          Últimos 4 dígitos
          <input
            value={form.last4Digits}
            inputMode="numeric"
            maxLength={4}
            onChange={(event) => setForm({ ...form, last4Digits: event.target.value.replace(/\D/g, "") })}
          />
        </label>
        <label>
          Tipo
          <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
            <option value="PHYSICAL">Físico</option>
            <option value="VIRTUAL">Virtual</option>
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={salvando || !form.label.trim() || form.last4Digits.length !== 4}
          onClick={() => void salvar(form)}
        >
          {finais.length === 0 ? <Save size={14} /> : <Plus size={14} />} Adicionar cartão
        </button>
      </div>
    </section>
  );
}
