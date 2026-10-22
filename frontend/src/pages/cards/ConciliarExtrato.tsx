import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import type { CreditCardStatementDetail } from "../../api/client";
import { Money } from "../../design-system";
import { formatDate } from "../../utils/format";
import { conciliarExtrato, lerExtrato } from "./conciliar-extrato";

type Linha = CreditCardStatementDetail["items"][number];

type Props = {
  itens: Linha[];
  onConferir: (itemIds: string[]) => Promise<void>;
  onFechar: () => void;
};

export function ConciliarExtrato({ itens, onConferir, onFechar }: Props) {
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const resultado = useMemo(() => {
    if (!texto.trim()) return null;
    return conciliarExtrato(lerExtrato(texto), itens);
  }, [texto, itens]);

  const novos = resultado?.pares.filter((par) => !par.item.checked) ?? [];

  async function conferir() {
    if (novos.length === 0 || ocupado) return;
    setOcupado(true);
    try {
      await onConferir(novos.map((par) => par.itemId));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="fatura-conciliar" aria-label="Conciliar com o extrato">
      <header>
        <h3>Conciliar com o extrato</h3>
        <button type="button" className="icon-button" onClick={onFechar} aria-label="Fechar a conciliação">
          <X size={16} />
        </button>
      </header>
      <p className="text-muted">
        Cole as linhas do extrato do banco (uma compra por linha, com data e valor). O sistema casa cada linha com um
        lançamento da fatura e mostra o que sobrou de cada lado. Nada é alterado até você confirmar.
      </p>
      <textarea
        rows={6}
        value={texto}
        placeholder={"21/08 HORTIFRUTI EXEMPLO 320,00\n22/08 DISTRIBUIDORA EXEMPLO 1.250,00"}
        aria-label="Linhas do extrato"
        onChange={(event) => setTexto(event.target.value)}
      />

      {resultado && (
        <div className="fatura-conciliar-resultado">
          <div className="fatura-conciliar-resumo">
            <span className="ok"><Check size={14} /> {resultado.pares.length} casadas</span>
            <span className={resultado.soNoExtrato.length ? "alerta" : ""}>{resultado.soNoExtrato.length} só no extrato</span>
            <span className={resultado.soNoSistema.length ? "alerta" : ""}>{resultado.soNoSistema.length} só no sistema</span>
          </div>

          {resultado.soNoExtrato.length > 0 && (
            <div>
              <h4>Está no extrato, mas não na fatura do sistema</h4>
              <ul>
                {resultado.soNoExtrato.map((linha, indice) => (
                  <li key={`${linha.texto}-${indice}`}>{linha.texto}</li>
                ))}
              </ul>
              <p className="text-muted">Lance a compra que falta (ou confira se ela caiu em outra fatura).</p>
            </div>
          )}

          {resultado.soNoSistema.length > 0 && (
            <div>
              <h4>Está na fatura do sistema, mas não no extrato</h4>
              <ul>
                {resultado.soNoSistema.map((item) => (
                  <li key={item.id}>
                    {formatDate(item.itemDate)} · {item.description} · <Money value={item.value} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resultado.pares.some((par) => par.certeza === "valor") && (
            <p className="text-muted">
              {resultado.pares.filter((par) => par.certeza === "valor").length} linha(s) casaram só pelo valor (a data
              não bate). Confira antes de confirmar.
            </p>
          )}

          <button type="button" className="primary-button" disabled={novos.length === 0 || ocupado} onClick={() => void conferir()}>
            <Check size={16} /> Marcar {novos.length} como conferidas
          </button>
        </div>
      )}
    </section>
  );
}
