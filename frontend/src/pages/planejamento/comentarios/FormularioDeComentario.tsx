import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, Switch, Textarea } from "../../../design-system";
import type { ResultadoDaMutacao } from "./useComentarios";

// Texto livre de 1 a 1000 caracteres + "Sai na impressão". Ctrl+Enter salva; Esc cancela (só na edição: na criação o
// Esc fecha a gaveta). Erros em português claro, o texto digitado nunca se perde.

export const LIMITE_DO_TEXTO = 1000;
const PERTO_DO_LIMITE = 900;

type Props = {
  textoInicial?: string;
  naImpressaoInicial?: boolean;
  rotuloSalvar: string;
  aoSalvar: (texto: string, naImpressao: boolean) => Promise<ResultadoDaMutacao>;
  aoCancelar?: () => void;
  aoSalvarComSucesso?: () => void;
};

export function FormularioDeComentario({ textoInicial = "", naImpressaoInicial = true, rotuloSalvar, aoSalvar, aoCancelar, aoSalvarComSucesso }: Props) {
  const id = useId();
  const formulario = useRef<HTMLFormElement>(null);
  const focarCampo = () => formulario.current?.querySelector("textarea")?.focus();
  const [texto, setTexto] = useState(textoInicial);
  const [naImpressao, setNaImpressao] = useState(naImpressaoInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");

  async function salvar() {
    if (salvando) return;
    if (texto.trim() === "") { setErro("Escreva o comentário antes de salvar."); focarCampo(); return; }
    setSalvando(true);
    setErro(null);
    const resultado = await aoSalvar(texto.trim(), naImpressao);
    setSalvando(false);
    if (!resultado.ok) { setErro(resultado.mensagem); return; }
    if (!aoCancelar) { setTexto(""); setAviso("Comentário salvo."); focarCampo(); }
    aoSalvarComSucesso?.();
  }

  function teclas(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void salvar(); }
    else if (e.key === "Escape" && aoCancelar) { e.preventDefault(); aoCancelar(); }
  }

  const perto = texto.length >= PERTO_DO_LIMITE;
  return (
    <form ref={formulario} className="plan-coment-form" aria-busy={salvando} data-comentario-editando={aoCancelar ? "" : undefined} onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
      <Textarea
        label={aoCancelar ? "Editar comentário" : "Novo comentário"}
        value={texto}
        maxLength={LIMITE_DO_TEXTO}
        rows={4}
        placeholder="Explique o que aconteceu neste ponto…"
        readOnly={salvando}
        autoFocus={Boolean(aoCancelar)}
        aria-describedby={`${id}-contador ${id}-dica`}
        onChange={(e) => { setTexto(e.target.value); setErro(null); setAviso(""); }}
        onKeyDown={teclas}
      />
      <div className={`plan-coment-contador${perto ? " plan-coment-contador-cheio" : ""}`} id={`${id}-contador`} aria-live={perto ? "polite" : "off"}>
        {texto.length}/{LIMITE_DO_TEXTO}
      </div>
      <label className="plan-coment-chave" htmlFor={`${id}-imprime`}>
        <Switch id={`${id}-imprime`} checked={naImpressao} onChange={setNaImpressao} disabled={salvando} />
        Sai na impressão
      </label>
      <span className="plan-coment-dica" id={`${id}-dica`}>Ctrl+Enter salva{aoCancelar ? "; Esc cancela" : ""}.</span>
      {erro && <p className="plan-coment-erro" role="alert">{erro}</p>}
      <p className="plan-coment-status" role="status">{aviso}</p>
      <div className="plan-coment-form-acoes">
        {aoCancelar && <Button type="button" variant="secondary" onClick={aoCancelar} disabled={salvando}>Cancelar</Button>}
        <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : rotuloSalvar}</Button>
      </div>
    </form>
  );
}
