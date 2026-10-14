import { useState, type FormEvent } from "react";
import { Button, TextField, useHideValues } from "../../design-system";
import { lerNumeroBr, nomeDoMes } from "./formato";
import { useFormato } from "./useFormato";

type Props = {
  ano: number;
  mes: number;
  // Custo já informado para o mês (null = ainda não informado).
  atual: number | null;
  // Último custo informado em qualquer mês, para a pessoa partir dele.
  referencia: { ano: number; mes: number; valor: number } | null;
  onSalvar: (valor: number | null) => Promise<void>;
  // Gravou (ou removeu): o aviso de status assume o foco.
  onFechar: () => void;
  // Desistiu: quem chama devolve o foco ao botão que abriu o editor.
  onCancelar: () => void;
};

// O mesmo teto que o servidor aceita: um zero a mais é erro de digitação, não custo.
const TETO = 10_000;
const comoTexto = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

function validar(texto: string): { valor: number } | { erro: string } {
  const n = lerNumeroBr(texto);
  if (n === null || n <= 0) return { erro: "Digite um valor maior que zero, por exemplo 38,50." };
  if (n > TETO) return { erro: "Valor acima de R$ 10 mil por pessoa. Confira se não sobrou um zero." };
  const valor = Math.round(n * 100) / 100;
  // 0,004 arredonda para zero: o servidor recusaria.
  if (valor <= 0) return { erro: "Digite um valor de pelo menos R$ 0,01." };
  return { valor };
}

// Custo médio de comida por pessoa de UM mês do buffet. É informado, não calculado: o PDV não tem custo da refeição.
export function EditorDeCustoDoBuffet({ ano, mes, atual, referencia, onSalvar, onFechar, onCancelar }: Props) {
  const { hidden } = useHideValues();
  const { reaisCentavos } = useFormato();
  const [texto, setTexto] = useState(atual === null || hidden ? "" : comoTexto(atual));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const mesmoMes = referencia !== null && referencia.ano === ano && referencia.mes === mes;

  async function gravar(valor: number | null) {
    // Sem `disabled`: um botão desabilitado joga o foco no <body>. O clique repetido é ignorado aqui.
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(valor);
      onFechar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar o custo.");
    } finally {
      setSalvando(false);
    }
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    const resultado = validar(texto);
    if ("erro" in resultado) {
      setErro(resultado.erro);
      return;
    }
    void gravar(resultado.valor);
  }

  return (
    <form className="meta-editor" onSubmit={enviar} noValidate>
      <TextField
        label={`Custo de comida por pessoa em ${nomeDoMes(mes, ano)}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        // Com "ocultar valores" ligado o número digitado não aparece na tela.
        type={hidden ? "password" : "text"}
        inputMode="decimal"
        autoComplete="off"
        autoFocus
        readOnly={salvando}
        aria-invalid={erro ? true : undefined}
        hint="em reais, por pessoa que comeu no buffet"
      />
      {erro && (
        <p className="meta-erro" role="alert">
          {erro}
        </p>
      )}
      {referencia && !mesmoMes && (
        <div className="meta-sugestoes">
          <span className="meta-sugestoes-rotulo">Partir de:</span>
          <button type="button" className="insight-link" onClick={() => setTexto(comoTexto(referencia.valor))}>
            último custo informado, {nomeDoMes(referencia.mes, referencia.ano)} ({reaisCentavos(referencia.valor)})
          </button>
        </div>
      )}
      <div className="meta-editor-acoes">
        <Button type="submit" size="sm" aria-busy={salvando}>
          {salvando ? "Salvando…" : "Salvar custo"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
        {atual !== null && (
          <Button type="button" variant="danger" size="sm" onClick={() => void gravar(null)}>
            Remover custo
          </Button>
        )}
      </div>
    </form>
  );
}
