import type { Opcoes } from "./api";
import type { Campo } from "./etapas";
import { mascaraCep, mascaraCpf, mascaraData, mascaraPis, mascaraTelefone, mascaraTitulo } from "./formato";

type Props = {
  campo: Campo;
  valor: string | boolean | null;
  erro?: string;
  opcoes: Opcoes;
  onChange: (valor: string | boolean | null) => void;
  onBlur?: () => void;
};

const MASCARA: Partial<Record<Campo["tipo"], (v: string) => string>> = {
  cpf: mascaraCpf, cep: mascaraCep, data: mascaraData, telefone: mascaraTelefone, pis: mascaraPis, titulo: mascaraTitulo,
};
const NUMERICO = new Set<Campo["tipo"]>(["cpf", "cep", "data", "telefone", "pis", "titulo"]);
const PLACEHOLDER: Partial<Record<Campo["tipo"], string>> = {
  data: "DD/MM/AAAA", cpf: "000.000.000-00", cep: "00000-000", telefone: "(11) 90000-0000",
};

export function CampoFicha({ campo, valor, erro, opcoes, onChange, onBlur }: Props) {
  const id = `ficha-${campo.nome}`;
  const idDica = `${id}-dica`;
  const idErro = `${id}-erro`;
  const descritoPor = [campo.dica ? idDica : null, erro ? idErro : null].filter(Boolean).join(" ") || undefined;
  const classe = `fp-campo fp-campo--${campo.largura ?? "inteira"}${erro ? " fp-campo--erro" : ""}`;
  const rotulo = (
    <>
      {campo.rotulo}
      {campo.obrigatorio ? <span className="fp-obrigatorio" aria-hidden="true"> *</span> : <span className="fp-opcional"> (opcional)</span>}
    </>
  );
  const rodape = (
    <>
      {campo.dica && <small id={idDica} className="fp-dica">{campo.dica}</small>}
      {erro && <small id={idErro} className="fp-erro" role="alert">{erro}</small>}
    </>
  );

  if (campo.tipo === "simnao" || campo.tipo === "sexo") {
    const escolhas: Array<[string | boolean, string]> = campo.tipo === "sexo"
      ? [["FEMININO", "Feminino"], ["MASCULINO", "Masculino"]]
      : [[true, "Sim"], [false, "Não"]];
    return (
      <fieldset id={id} tabIndex={-1} className={classe} aria-describedby={descritoPor}>
        <legend className="fp-rotulo">{rotulo}</legend>
        <div className="fp-escolhas">
          {escolhas.map(([v, texto]) => (
            <label key={String(v)} className={`fp-escolha${valor === v ? " fp-escolha--marcada" : ""}`}>
              <input type="radio" name={id} aria-label={texto} checked={valor === v} onChange={() => onChange(v)} aria-invalid={Boolean(erro)} />
              <span>{texto}</span>
            </label>
          ))}
        </div>
        {rodape}
      </fieldset>
    );
  }

  if (campo.tipo === "lista") {
    const itens = campo.lista ? opcoes[campo.lista] : [];
    return (
      <div className={classe}>
        <label className="fp-rotulo" htmlFor={id}>{rotulo}</label>
        <select id={id} className="fp-entrada" value={typeof valor === "string" ? valor : ""} onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur} aria-invalid={Boolean(erro)} aria-describedby={descritoPor}>
          <option value="">Escolha…</option>
          {itens.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {rodape}
      </div>
    );
  }

  const mascara = MASCARA[campo.tipo];
  return (
    <div className={classe}>
      <label className="fp-rotulo" htmlFor={id}>{rotulo}</label>
      <input
        id={id}
        className="fp-entrada"
        type={campo.tipo === "email" ? "email" : "text"}
        inputMode={NUMERICO.has(campo.tipo) ? "numeric" : campo.tipo === "email" ? "email" : undefined}
        autoComplete={campo.autoComplete ?? "off"}
        autoCapitalize={campo.tipo === "texto" ? "words" : "off"}
        placeholder={PLACEHOLDER[campo.tipo]}
        value={typeof valor === "string" ? valor : ""}
        onChange={(e) => onChange(mascara ? mascara(e.target.value) : e.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(erro)}
        aria-describedby={descritoPor}
        aria-required={campo.obrigatorio}
      />
      {rodape}
    </div>
  );
}
