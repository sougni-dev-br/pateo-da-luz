import type { Employee, EmployeeFichaCampos } from "../../api/client";

// Campos da ficha de registro no formulário do cadastro: tudo texto (datas "AAAA-MM-DD"),
// deficiência como "" / "sim" / "nao". Ao salvar vai só o que a pessoa MUDOU na tela (vazio
// vira null): a ficha aberta antes da importação, salva depois, não apaga o que a importação
// preencheu — o backend só grava o campo que vem no corpo.
type CampoTexto = Exclude<keyof EmployeeFichaCampos, "possuiDeficiencia">;
export type FichaForm = Record<CampoTexto, string> & { possuiDeficiencia: "" | "sim" | "nao" };

const CAMPOS_TEXTO: CampoTexto[] = [
  "nomeCompleto", "registroNumero", "matriculaEsocial", "nomeMae", "nomePai", "estadoCivil", "nacionalidade", "naturalidade",
  "racaCor", "escolaridade", "rgDataEmissao", "rgOrgaoEmissor", "tituloEleitor", "tituloZona", "tituloSecao",
  "ctpsNumero", "ctpsSerie", "ctpsUf", "ctpsDataEmissao", "cbo", "jornadaInicio", "jornadaFim",
  "intervaloInicio", "intervaloFim", "fgtsDataOpcao",
];
const CAMPOS_DATA = new Set<CampoTexto>(["rgDataEmissao", "ctpsDataEmissao", "fgtsDataOpcao"]);

export const fichaFormVazio: FichaForm = {
  ...(Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, ""])) as Record<CampoTexto, string>),
  possuiDeficiencia: "",
};

export function fichaFormDe(e: Employee): FichaForm {
  const textos = Object.fromEntries(CAMPOS_TEXTO.map((c) => {
    const v = e[c] ?? "";
    return [c, CAMPOS_DATA.has(c) ? v.slice(0, 10) : v];
  })) as Record<CampoTexto, string>;
  const def = e.possuiDeficiencia;
  return { ...textos, possuiDeficiencia: def === true ? "sim" : def === false ? "nao" : "" };
}

// Só os campos que mudaram desde que a ficha foi aberta (cadastro novo: original vazio).
export function fichaParaSalvar(f: FichaForm, original: FichaForm = fichaFormVazio): Partial<EmployeeFichaCampos> {
  const out: Partial<EmployeeFichaCampos> = {};
  // Compara o texto como está: um campo gravado só com espaços também pode ser limpo.
  for (const c of CAMPOS_TEXTO) if (f[c] !== original[c]) out[c] = f[c].trim() || null;
  if (f.possuiDeficiencia !== original.possuiDeficiencia) {
    out.possuiDeficiencia = f.possuiDeficiencia === "sim" ? true : f.possuiDeficiencia === "nao" ? false : null;
  }
  return out;
}
