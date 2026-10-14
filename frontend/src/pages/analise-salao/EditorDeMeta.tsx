import { useState, type FormEvent } from "react";
import type { AnaliseIndicadorDeMeta, AnaliseMetaIndicador } from "../../api/client";
import { Button, TextField, useHideValues } from "../../design-system";
import { lerNumeroBr } from "./formato";
import { formatarValor } from "./metaFormato";
import { useFormato } from "./useFormato";

type Props = {
  indicador: AnaliseMetaIndicador;
  onSalvar: (valor: number | null) => Promise<void>;
  onFechar: () => void;
};

const UNIDADE: Record<AnaliseIndicadorDeMeta, string> = {
  faturamento: "em reais, para o mês inteiro",
  pessoas: "pessoas no mês inteiro (número inteiro)",
  ticketPessoa: "em reais por pessoa",
  perdaPct: "em % do faturamento, por exemplo 2 ou 1,5"
};

// Os mesmos tetos que o servidor aceita: um zero a mais é erro de digitação, não meta.
const TETO: Record<AnaliseIndicadorDeMeta, { valor: number; texto: string }> = {
  faturamento: { valor: 100_000_000, texto: "R$ 100 milhões" },
  pessoas: { valor: 1_000_000, texto: "1 milhão de pessoas" },
  ticketPessoa: { valor: 10_000, texto: "R$ 10 mil" },
  perdaPct: { valor: 100, texto: "100%" }
};

// A perda é guardada como fração (0,02), mas a pessoa digita e lê em % (2).
const paraEntrada = (i: AnaliseMetaIndicador | AnaliseIndicadorDeMeta, valor: number) => ((typeof i === "string" ? i : i.indicador) === "perdaPct" ? valor * 100 : valor);
const doTexto = (i: AnaliseMetaIndicador, n: number) => (i.indicador === "perdaPct" ? n / 100 : n);
// Até 4 casas: 0,125% reabre como 0,125, não arredondado para 0,13.
const comoTexto = (n: number) => String(Math.round(n * 10000) / 10000).replace(".", ",");

function validar(indicador: AnaliseMetaIndicador, texto: string): { valor: number } | { erro: string } {
  const n = lerNumeroBr(texto);
  if (n === null || n <= 0) return { erro: "Digite um valor maior que zero, por exemplo 300.000 ou 2,5." };
  if (indicador.indicador === "pessoas" && !Number.isInteger(n)) return { erro: "Pessoas é um número inteiro." };
  const teto = TETO[indicador.indicador];
  if (n > teto.valor) return { erro: `Valor acima do limite de ${teto.texto}. Confira se não sobrou um zero.` };
  return { valor: doTexto(indicador, n) };
}

export function EditorDeMeta({ indicador, onSalvar, onFechar }: Props) {
  const { hidden } = useHideValues();
  const { reais } = useFormato();
  const [texto, setTexto] = useState(indicador.meta === null || hidden ? "" : comoTexto(paraEntrada(indicador, indicador.meta)));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const referencia = indicador.referencia;

  async function gravar(valor: number | null) {
    // Sem `disabled`: um botão desabilitado joga o foco no <body>. O clique repetido é ignorado aqui.
    if (salvando) return;
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
    const resultado = validar(indicador, texto);
    if ("erro" in resultado) {
      setErro(resultado.erro);
      return;
    }
    void gravar(resultado.valor);
  }

  const preencher = (valor: number) => setTexto(comoTexto(paraEntrada(indicador, valor)));

  return (
    <form className="meta-editor" onSubmit={enviar} noValidate>
      <TextField
        label={`Meta de ${indicador.rotulo.toLowerCase()}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        // Com "ocultar valores" ligado o número digitado não aparece na tela.
        type={hidden ? "password" : "text"}
        inputMode="decimal"
        autoComplete="off"
        autoFocus
        readOnly={salvando}
        aria-invalid={erro ? true : undefined}
        hint={UNIDADE[indicador.indicador]}
      />
      {erro && (
        <p className="meta-erro" role="alert">
          {erro}
        </p>
      )}
      {referencia && (
        <div className="meta-sugestoes">
          <span className="meta-sugestoes-rotulo">Partir de:</span>
          <button type="button" className="insight-link" onClick={() => preencher(referencia.media3)}>
            média dos últimos {referencia.mesesNaMedia} meses ({formatarValor(indicador.indicador, referencia.media3, reais, true)})
          </button>
          <button type="button" className="insight-link" onClick={() => preencher(referencia.melhor)}>
            melhor mês ({formatarValor(indicador.indicador, referencia.melhor, reais, true)})
          </button>
        </div>
      )}
      <div className="meta-editor-acoes">
        <Button type="submit" size="sm" aria-busy={salvando}>
          {salvando ? "Salvando…" : "Salvar meta"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onFechar}>
          Cancelar
        </Button>
        {indicador.meta !== null && (
          <Button type="button" variant="danger" size="sm" onClick={() => void gravar(null)}>
            Remover meta
          </Button>
        )}
      </div>
    </form>
  );
}
