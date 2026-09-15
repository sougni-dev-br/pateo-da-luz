import { FileText, Plus, Trash2 } from "lucide-react";
import { Button, TextField } from "../design-system";

export type LinhaParcela = {
  dataVencimento: string;
  valor: string;
  /** Arquivo de onde a parcela foi lida (vazio quando a pessoa adicionou à mão). */
  origem: string;
};

type Props = {
  parcelas: LinhaParcela[];
  totalEsperado: number;
  onChange: (parcelas: LinhaParcela[]) => void;
};

function numero(valor: string): number {
  const convertido = Number(String(valor).replace(",", "."));
  return Number.isFinite(convertido) ? convertido : 0;
}

function dinheiro(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const TOLERANCIA = 0.01;

/**
 * Parcelas do título — uma por boleto enviado.
 *
 * Fica editável porque a leitura pode errar um vencimento, e porque nem sempre
 * todos os boletos estão em mãos na hora. O total das parcelas precisa fechar
 * com o da compra: o backend recusa o lançamento se divergir, e é melhor a
 * pessoa ver isso aqui do que levar um erro na cara depois de preencher tudo.
 */
export function ParcelasEditor({ parcelas, totalEsperado, onChange }: Props) {
  const soma = parcelas.reduce((total, parcela) => total + numero(parcela.valor), 0);
  const diferenca = soma - totalEsperado;
  const fecha = Math.abs(diferenca) <= TOLERANCIA;

  function alterar(indice: number, mudanca: Partial<LinhaParcela>) {
    onChange(parcelas.map((parcela, i) => (i === indice ? { ...parcela, ...mudanca } : parcela)));
  }

  function distribuirRestante(indice: number) {
    const outras = parcelas.reduce((total, parcela, i) => (i === indice ? total : total + numero(parcela.valor)), 0);
    alterar(indice, { valor: String(Number((totalEsperado - outras).toFixed(2))) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong style={{ fontSize: 13 }}>
        {parcelas.length === 1 ? "Pagamento" : `Parcelas (${parcelas.length})`}
      </strong>
      {parcelas.length > 1 && (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Uma linha por boleto enviado. Confira cada vencimento e valor antes de lançar.
        </span>
      )}

      {parcelas.map((parcela, indice) => (
        <div key={indice} style={{ display: "grid", gridTemplateColumns: "28px 1fr 130px minmax(0,1fr) 32px", gap: 8, alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{indice + 1}ª</span>
          <TextField
            label={indice === 0 ? "Vencimento" : undefined}
            aria-label={`Vencimento da parcela ${indice + 1}`}
            type="date"
            value={parcela.dataVencimento}
            onChange={(evento) => alterar(indice, { dataVencimento: evento.target.value })}
          />
          <TextField
            label={indice === 0 ? "Valor" : undefined}
            aria-label={`Valor da parcela ${indice + 1}`}
            value={parcela.valor}
            onChange={(evento) => alterar(indice, { valor: evento.target.value })}
          />
          <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6, minWidth: 0, paddingTop: indice === 0 ? 20 : 0 }}>
            {parcela.origem ? (
              <><FileText size={12} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parcela.origem}</span></>
            ) : (
              <button type="button" onClick={() => distribuirRestante(indice)}
                style={{ border: "none", background: "transparent", padding: 0, color: "var(--muted)", cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>
                usar o valor que falta
              </button>
            )}
          </div>
          <button
            type="button"
            title="Remover parcela"
            aria-label={`Remover parcela ${indice + 1}`}
            disabled={parcelas.length === 1}
            onClick={() => onChange(parcelas.filter((_, i) => i !== indice))}
            style={{ marginTop: indice === 0 ? 20 : 0, border: "none", background: "transparent", cursor: parcelas.length === 1 ? "not-allowed" : "pointer", color: "var(--muted)" }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Button
          variant="secondary"
          leadingIcon={<Plus size={13} />}
          onClick={() => onChange([...parcelas, { dataVencimento: "", valor: "", origem: "" }])}
        >
          Adicionar parcela
        </Button>
        <span style={{ fontSize: 13, fontWeight: 600, color: fecha ? "inherit" : "var(--danger, #c00)" }}>
          Soma das parcelas: {dinheiro(soma)}
          {!fecha && ` · faltam ${dinheiro(Math.abs(diferenca))} para fechar ${dinheiro(totalEsperado)}`}
        </span>
      </div>
    </div>
  );
}
