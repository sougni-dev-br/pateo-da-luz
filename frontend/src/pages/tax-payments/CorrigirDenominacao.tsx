import { useState, type FormEvent } from "react";
import { Button, FormField, TextField } from "../../design-system";
import { Janela } from "../payables/Janela";
import "./tax-payments.css";

type Props = {
  tipo: string;
  codigo: string;
  descricaoAtual: string;
  /** Grava a correção no catálogo; se falhar, lança um Error com a mensagem para mostrar. */
  onSalvar: (descricao: string) => Promise<void>;
  onFechar: () => void;
};

// O primeiro texto digitado para um código vira o oficial: aqui se corrige um erro de digitação sem mexer no banco.
export function CorrigirDenominacao({ tipo, codigo, descricaoAtual, onSalvar, onFechar }: Props) {
  const [texto, setTexto] = useState(descricaoAtual);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const novo = texto.trim();
  const podeSalvar = novo !== "" && novo !== descricaoAtual && !salvando;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!podeSalvar) return;
    setErro(null);
    setSalvando(true);
    try {
      await onSalvar(novo);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível corrigir a denominação.");
      setSalvando(false);
    }
  }

  return (
    <Janela eyebrow="Catálogo de códigos" titulo={`Corrigir o código ${codigo}`} onFechar={onFechar} ocupado={salvando} largura="estreita">
      <form onSubmit={salvar} noValidate className="ip-form">
        <p className="ip-aviso" role="note">
          Vale para as próximas guias de {tipo}. As guias já lançadas guardam o texto que tinham até serem editadas e salvas de novo.
        </p>
        <FormField label="Denominação" required>
          <TextField value={texto} maxLength={200} autoFocus disabled={salvando} onChange={(e) => setTexto(e.target.value)} />
        </FormField>
        {erro && <p className="field-hint field-hint--alerta" role="alert">{erro}</p>}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={!podeSalvar}>{salvando ? "Salvando…" : "Salvar correção"}</Button>
        </div>
      </form>
    </Janela>
  );
}
