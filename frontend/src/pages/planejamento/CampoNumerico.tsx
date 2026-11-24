import { useEffect, useId, useState } from "react";

// Campo de número que guarda o texto enquanto a pessoa digita e só avisa o pai quando o texto vira um valor
// válido; ao sair do campo com texto inválido, volta ao último valor aceito (a tela nunca mostra um número
// diferente do que será salvo). Serve aos campos de R$ e de % dos gastos.

type Props = {
  id?: string;
  valor: number | null;
  rotulo: string;
  desabilitado: boolean;
  aceitaVazio?: boolean;
  /** Texto → valor, ou null se inválido. */
  interpretar: (texto: string) => number | null;
  /** Valor → texto exibido. */
  formatar: (valor: number) => string;
  /** O valor interpretado é aceito? (faixa). */
  valido?: (valor: number) => boolean;
  largura?: number | string;
  onMudar: (valor: number | null) => void;
};

export function CampoNumerico({ id, valor, rotulo, desabilitado, aceitaVazio = false, interpretar, formatar, valido, largura = 76, onMudar }: Props) {
  const [texto, setTexto] = useState(valor === null ? "" : formatar(valor));
  const [invalido, setInvalido] = useState(false);
  const idDoErro = useId();

  useEffect(() => {
    const atual = texto.trim() === "" ? null : interpretar(texto);
    if (atual !== valor) {
      setTexto(valor === null ? "" : formatar(valor));
      setInvalido(false);
    }
    // Só reage ao valor vindo de fora; o texto em edição não deve disparar a regravação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  function digitar(novo: string) {
    setTexto(novo);
    if (novo.trim() === "") {
      setInvalido(!aceitaVazio);
      if (aceitaVazio) onMudar(null);
      return;
    }
    const lido = interpretar(novo);
    const ok = lido !== null && (valido ? valido(lido) : true);
    setInvalido(!ok);
    if (ok && lido !== null) onMudar(lido);
  }

  function aoSair() {
    if (!invalido) return;
    setTexto(valor === null ? "" : formatar(valor));
    setInvalido(false);
  }

  const mensagem = texto.trim() === "" ? "Digite um valor." : interpretar(texto) === null ? "Digite um número." : "Fora da faixa aceita.";

  return (
    <span className="plan-campo-envoltorio">
    <input
      id={id}
      className={`plan-campo${invalido ? " plan-campo-invalido" : ""}`}
      style={{ width: largura }}
      inputMode="decimal"
      aria-label={rotulo}
      aria-invalid={invalido || undefined}
      aria-describedby={invalido ? idDoErro : undefined}
      value={texto}
      disabled={desabilitado}
      onChange={(e) => digitar(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={aoSair}
    />
    {invalido && <span id={idDoErro} className="plan-campo-erro" role="status">{mensagem}</span>}
    </span>
  );
}
