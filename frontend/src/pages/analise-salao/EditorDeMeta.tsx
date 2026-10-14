import { useState, type FormEvent } from "react";
import type { AnaliseMetaIndicador } from "../../api/client";
import { Button, TextField } from "../../design-system";
import { lerNumeroBr } from "./formato";
import { formatarValor } from "./metaFormato";
import { useFormato } from "./useFormato";

type Props = {
  indicador: AnaliseMetaIndicador;
  onSalvar: (valor: number | null) => Promise<void>;
  onFechar: () => void;
};

const UNIDADE: Record<AnaliseMetaIndicador["indicador"], string> = {
  faturamento: "em reais, para o mês inteiro",
  pessoas: "pessoas no mês inteiro",
  ticketPessoa: "em reais por pessoa",
  perdaPct: "em % do faturamento, por exemplo 2 ou 1,5"
};

// A perda é guardada como fração (0,02), mas a pessoa digita e lê em % (2).
const paraEntrada = (i: AnaliseMetaIndicador, valor: number) => (i.indicador === "perdaPct" ? valor * 100 : valor);
const doTexto = (i: AnaliseMetaIndicador, n: number) => (i.indicador === "perdaPct" ? n / 100 : n);
const comoTexto = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

export function EditorDeMeta({ indicador, onSalvar, onFechar }: Props) {
  const [texto, setTexto] = useState(indicador.meta === null ? "" : comoTexto(paraEntrada(indicador, indicador.meta)));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const referencia = indicador.referencia;
  const { reais } = useFormato();

  async function gravar(valor: number | null) {
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(valor);
      onFechar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar a meta.");
    } finally {
      setSalvando(false);
    }
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    const n = lerNumeroBr(texto);
    if (n === null || n <= 0) {
      setErro("Digite um valor maior que zero.");
      return;
    }
    if (indicador.indicador === "perdaPct" && n > 100) {
      setErro("A perda é uma porcentagem: até 100.");
      return;
    }
    void gravar(doTexto(indicador, n));
  }

  return (
    <form className="meta-editor" onSubmit={enviar} noValidate>
      <TextField
        label={`Meta de ${indicador.rotulo.toLowerCase()}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        hint={UNIDADE[indicador.indicador]}
        error={erro ?? undefined}
        disabled={salvando}
      />
      {referencia && (
        <div className="meta-sugestoes">
          <span className="meta-sugestoes-rotulo">Partir de:</span>
          <button type="button" className="insight-link" disabled={salvando} onClick={() => setTexto(comoTexto(paraEntrada(indicador, referencia.media3)))}>
            média dos últimos {referencia.mesesNaMedia} meses ({formatarValor(indicador.indicador, referencia.media3, reais, true)})
          </button>
          <button type="button" className="insight-link" disabled={salvando} onClick={() => setTexto(comoTexto(paraEntrada(indicador, referencia.melhor)))}>
            melhor mês ({formatarValor(indicador.indicador, referencia.melhor, reais, true)})
          </button>
        </div>
      )}
      <div className="meta-editor-acoes">
        <Button type="submit" size="sm" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar meta"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
        {indicador.meta !== null && (
          <Button type="button" variant="danger" size="sm" onClick={() => void gravar(null)} disabled={salvando}>
            Remover meta
          </Button>
        )}
      </div>
    </form>
  );
}
