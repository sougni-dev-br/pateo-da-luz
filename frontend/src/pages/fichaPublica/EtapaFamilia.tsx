import { Plus, Trash2 } from "lucide-react";
import type { Filho } from "./api";
import { cpfValido, dataParaIso, mascaraCpf, mascaraData } from "./formato";

/** Filho como aparece no formulário: data em DD/MM/AAAA e CPF com máscara. */
export type FilhoTela = { nome: string; nascimento: string; cpf: string };

type Props = {
  nomeConjuge: string;
  filhos: FilhoTela[];
  erros: Record<string, string>;
  onConjuge: (v: string) => void;
  onFilhos: (f: FilhoTela[]) => void;
};

export function filhosParaTela(filhos: Filho[] | undefined): FilhoTela[] {
  return (filhos ?? []).map((f) => ({
    nome: f.nome,
    nascimento: f.dataNascimento ? f.dataNascimento.split("-").reverse().join("/") : "",
    cpf: f.cpf ? mascaraCpf(f.cpf) : "",
  }));
}

/** Filhos da tela → corpo, ou os erros por linha ("filho-0-cpf"). */
export function filhosParaSalvar(filhos: FilhoTela[]): { erros: Record<string, string> } | { filhos: Filho[] } {
  const erros: Record<string, string> = {};
  const lista: Filho[] = [];
  filhos.forEach((f, i) => {
    const nome = f.nome.trim();
    if (!nome && !f.nascimento && !f.cpf) return;
    if (!nome) erros[`filho-${i}-nome`] = "Escreva o nome.";
    const nascimento = f.nascimento ? dataParaIso(f.nascimento) : null;
    if (f.nascimento && !nascimento) erros[`filho-${i}-nascimento`] = "Data inválida.";
    if (f.cpf && !cpfValido(f.cpf)) erros[`filho-${i}-cpf`] = "CPF inválido.";
    lista.push({ nome, dataNascimento: nascimento, cpf: f.cpf || null });
  });
  return Object.keys(erros).length ? { erros } : { filhos: lista };
}

export function EtapaFamilia({ nomeConjuge, filhos, erros, onConjuge, onFilhos }: Props) {
  const alterar = (i: number, campo: keyof FilhoTela, valor: string) =>
    onFilhos(filhos.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));

  return (
    <div className="fp-grade">
      <div className="fp-campo fp-campo--inteira">
        <label className="fp-rotulo" htmlFor="ficha-conjuge">Nome do cônjuge <span className="fp-opcional">(opcional)</span></label>
        <input id="ficha-conjuge" className="fp-entrada" autoCapitalize="words" value={nomeConjuge} onChange={(e) => onConjuge(e.target.value)} />
        <small className="fp-dica">Se for casado(a) ou viver em união estável.</small>
      </div>

      <div className="fp-campo fp-campo--inteira">
        <p className="fp-rotulo">Filhos</p>
        <small className="fp-dica">Todos os filhos, de qualquer idade. Filho menor de 14 anos pode dar direito ao salário-família.</small>
      </div>

      {filhos.map((f, i) => (
        <fieldset key={i} className="fp-filho">
          <legend className="fp-filho-titulo">
            Filho(a) {i + 1}
            <button type="button" className="fp-filho-remover" onClick={() => onFilhos(filhos.filter((_, j) => j !== i))} aria-label={`Remover filho ${i + 1}`}>
              <Trash2 size={16} aria-hidden="true" /> Remover
            </button>
          </legend>
          <div className="fp-grade">
            <div className={`fp-campo fp-campo--inteira${erros[`filho-${i}-nome`] ? " fp-campo--erro" : ""}`}>
              <label className="fp-rotulo" htmlFor={`filho-${i}-nome`}>Nome completo</label>
              <input id={`filho-${i}-nome`} className="fp-entrada" autoCapitalize="words" value={f.nome} onChange={(e) => alterar(i, "nome", e.target.value)} />
              {erros[`filho-${i}-nome`] && <small className="fp-erro" role="alert">{erros[`filho-${i}-nome`]}</small>}
            </div>
            <div className={`fp-campo fp-campo--meia${erros[`filho-${i}-nascimento`] ? " fp-campo--erro" : ""}`}>
              <label className="fp-rotulo" htmlFor={`filho-${i}-nascimento`}>Nascimento</label>
              <input id={`filho-${i}-nascimento`} className="fp-entrada" inputMode="numeric" placeholder="DD/MM/AAAA" value={f.nascimento} onChange={(e) => alterar(i, "nascimento", mascaraData(e.target.value))} />
              {erros[`filho-${i}-nascimento`] && <small className="fp-erro" role="alert">{erros[`filho-${i}-nascimento`]}</small>}
            </div>
            <div className={`fp-campo fp-campo--meia${erros[`filho-${i}-cpf`] ? " fp-campo--erro" : ""}`}>
              <label className="fp-rotulo" htmlFor={`filho-${i}-cpf`}>CPF <span className="fp-opcional">(se tiver)</span></label>
              <input id={`filho-${i}-cpf`} className="fp-entrada" inputMode="numeric" placeholder="000.000.000-00" value={f.cpf} onChange={(e) => alterar(i, "cpf", mascaraCpf(e.target.value))} />
              {erros[`filho-${i}-cpf`] && <small className="fp-erro" role="alert">{erros[`filho-${i}-cpf`]}</small>}
            </div>
          </div>
        </fieldset>
      ))}

      {filhos.length < 10 && (
        <button type="button" className="fp-botao fp-botao--linha fp-campo--inteira" onClick={() => onFilhos([...filhos, { nome: "", nascimento: "", cpf: "" }])}>
          <Plus size={18} aria-hidden="true" /> {filhos.length ? "Adicionar outro filho" : "Adicionar filho"}
        </button>
      )}
    </div>
  );
}
