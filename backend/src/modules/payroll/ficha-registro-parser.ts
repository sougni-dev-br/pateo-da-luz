// Leitura da "Ficha de Registro de Empregado" que a contabilidade exporta em PDF.
//
// Entrada: o texto do PDF extraído com `pdftotext -layout -enc UTF-8` (a pdf-parse embaralha
// as colunas e chega a trocar gozo por abono nas férias). Cada ficha começa numa página com
// "Autenticar"; fichas longas continuam numa página "REGISTRO DE EMPREGADO  Nº: 001431" com
// mais alterações salariais e férias. Funções puras, sem banco.

export type FichaFerias = {
  aquisitivoInicio: string; aquisitivoFim: string;
  gozoInicio: string | null; gozoFim: string | null;
  abonoInicio: string | null; abonoFim: string | null;
};
export type FichaSalario = { vigencia: string; valor: number; retroativoCompetencia: string | null };
export type FichaCargo = { data: string; deCbo: string; deCargo: string; paraCbo: string | null; paraCargo: string | null };

export type FichaRegistro = {
  registro: string; matriculaEsocial: string | null;
  empregador: { nome: string | null; cnpj: string | null };
  nome: string; beneficiarios: string[];
  endereco: string; cep: string | null;
  dataNascimento: string | null; naturalidade: string | null; nacionalidade: string | null; estadoCivil: string | null;
  pai: string | null; mae: string | null;
  rg: string | null; rgEmissao: string | null; rgOrgao: string | null;
  tituloEleitor: string | null; tituloZona: string | null; tituloSecao: string | null;
  ctpsNumero: string; ctpsSerie: string; ctpsEmissao: string | null; ctpsUf: string; cpf: string;
  racaCor: string | null; sexo: string | null; escolaridade: string | null; possuiDeficiencia: boolean | null;
  cargoAdmissao: string; cboAdmissao: string;
  dataAdmissao: string; salarioAdmissao: number;
  jornada: { inicio: string; fim: string; intervaloInicio: string; intervaloFim: string } | null;
  fgtsOpcao: string | null; pis: string | null;
  salarios: FichaSalario[]; cargos: FichaCargo[]; ferias: FichaFerias[];
};

const DATA = /\d{2}\/\d{2}\/\d{4}/g;
// "00/00/0000" é como a ficha diz "sem data" (férias não gozadas). Data que não existe no
// calendário (31/02) também vira null — senão chegaria ao banco como data inválida.
export function isoDeBr(d: string | null | undefined): string | null {
  if (!d || !/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return null;
  const iso = d.split("/").reverse().join("-");
  const t = new Date(`${iso}T00:00:00.000Z`);
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}
const dinheiro = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const colunas = (s: string | undefined) => (s ? s.trim().split(/\s{2,}/) : []);

type Bloco = { tipo: "ficha" | "continuacao"; linhas: string[] };

function blocos(texto: string): Bloco[] {
  const out: Bloco[] = [];
  let atual: Bloco | null = null;
  for (const bruta of texto.split(/\r?\n/)) {
    const l = bruta.replace(/\s+$/, "");
    if (l.trim() === "") continue;
    if (/Autenticar/.test(l) || /^\s*REGISTRO DE EMPREGADO\s+Nº: /.test(l)) {
      atual = { tipo: /Autenticar/.test(l) ? "ficha" : "continuacao", linhas: [] };
      out.push(atual);
    }
    atual?.linhas.push(l);
  }
  return out;
}

function indice(ls: string[], re: RegExp, desde = 0): number {
  for (let i = desde; i < ls.length; i++) if (re.test(ls[i])) return i;
  return -1;
}

function exigir(i: number, oQue: string, nome: string): number {
  if (i < 0) throw new Error(`Ficha ${nome || "(sem nome)"}: não achei ${oQue}.`);
  return i;
}

// Nº do registro e matrícula eSocial. Layout comum: "Matrícula eSocial  001431" e na linha de
// baixo "1431". Variante: "REGISTRO DE EMPREGADO" e logo depois "41  000041".
function lerRegistro(ls: string[]): { registro: string; matricula: string | null } {
  const iMat = indice(ls, /Matrícula eSocial\s+\d{6}/);
  if (iMat >= 0) {
    const registro = ls[iMat].match(/(\d{6})\s*$/)![1];
    const matricula = ls[iMat + 1]?.trim().match(/^(\d+)$/)?.[1] ?? null;
    return { registro, matricula };
  }
  const iAlt = indice(ls, /^\s*\d+\s+\d{6}\s*$/);
  if (iAlt >= 0) {
    const [matricula, registro] = ls[iAlt].trim().split(/\s+/);
    return { registro, matricula };
  }
  throw new Error("Ficha sem número de registro.");
}

function lerFiliacao(ls: string[]): { pai: string | null; mae: string | null } {
  const rotulo = /^(FILIAÇÃO|Pai|Mãe|FILIAÇÃO\s+Pai)$/;
  const fil = ls.map((l) => l.trim());
  const iPai = fil.findIndex((l) => /Pai$/.test(l));
  const iMae = fil.findIndex((l) => l === "Mãe");
  const depois = (i: number) => (i >= 0 && fil[i + 1] && !rotulo.test(fil[i + 1]) ? fil[i + 1] : null);
  return { pai: depois(iPai), mae: depois(iMae) };
}

// Linha do RG: as colunas vazias somem no texto, então cada valor é reconhecido pelo formato.
function lerDocumentos(linha: string) {
  const r = { rg: null as string | null, rgEmissao: null as string | null, rgOrgao: null as string | null,
    tituloEleitor: null as string | null, tituloZona: null as string | null, tituloSecao: null as string | null };
  for (const c of colunas(linha)) {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(c)) r.rgEmissao = isoDeBr(c);
    else if (/^SSP/.test(c)) r.rgOrgao = c;
    else if (/^\d{12}$/.test(c)) r.tituloEleitor = c;
    else if (/^\d{3}\s+\d{3,4}$/.test(c)) [r.tituloZona, r.tituloSecao] = c.split(/\s+/);
    else if (!r.rg) r.rg = c;
  }
  return r;
}

function lerFicha(ls: string[]): FichaRegistro {
  const texto = ls.join("\n");
  const { registro, matricula } = lerRegistro(ls);

  const iNome = exigir(indice(ls, /^Empregado\s+Beneficiários/), "o nome", registro);
  const [nome, benef] = colunas(ls[iNome + 1]);
  const beneficiarios = benef ? benef.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean) : [];

  const iEmp = indice(ls, /Empregador/);
  const linhaEmp = iEmp >= 0 ? colunas(ls[iEmp + 1]) : [];
  const empregador = { nome: linhaEmp[0] ?? null, cnpj: linhaEmp.find((c) => /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(c)) ?? null };

  const iRes = exigir(indice(ls, /^Residência/), "o endereço", nome);
  const iNasc = exigir(indice(ls, /Data de nascimento/), "o nascimento", nome);
  const end = ls.slice(iRes + 1, iNasc).map((l) => l.trim()).join(" ");
  const cep = end.match(/(\d{5}-\d{3})/)?.[1] ?? null;
  const endereco = end.replace(/,?\s*-\s*CEP:?\s*\d{5}-\d{3}/, "").replace(/,\s*$/, "").trim();

  const nasc = colunas(ls[iNasc + 1]);
  const [naturalidade, nacionalidade, estadoCivil] = nasc.length >= 4 ? nasc.slice(1, 4) : [null, nasc[1] ?? null, nasc[2] ?? null];

  const iRg = exigir(indice(ls, /Cédula de Identidade/), "o RG", nome);
  const { pai, mae } = lerFiliacao(ls.slice(iNasc + 2, iRg));
  const iRgValor = /^\s*Categoria\s*$/.test(ls[iRg + 1]) ? iRg + 2 : iRg + 1;
  const docs = lerDocumentos(ls[iRgValor]);

  const iCtps = exigir(indice(ls, /^\s*CTPS\s+Série/), "a CTPS", nome);
  const mC = ls[iCtps + 1].trim().match(/^(\S+)\s+(\S+)\s+(?:(\d{2}\/\d{2}\/\d{4})\s+)?([A-Z]{2})\s+(\d{3}\.\d{3}\.\d{3}-\d{2})/);
  if (!mC) throw new Error(`Ficha ${nome}: linha da CTPS/CPF fora do formato.`);

  const iCor = exigir(indice(ls, /Doc\. militar/), "raça/sexo/escolaridade", nome);
  const [cor, sexo, escolaridade] = colunas(ls[iCor + 1]);
  const iDef = indice(ls, /^\s*Deficiência/);
  const def = iDef >= 0 ? ls[iDef + 1].trim() : "";

  const iCargo = exigir(indice(ls, /^\s*Cargo\s+Função/), "o cargo", nome);
  const cargo = colunas(ls[iCargo + 1]);

  const iAdm = exigir(indice(ls, /^Data de Admissão/), "a admissão", nome);
  const adm = ls[iAdm + 1].match(/(\d{2}\/\d{2}\/\d{4})\s+R\$\s+([\d.,]+)\s+\S+(?:\s+das (\S+) as (\S+))?(?:\s+das (\S+) as (\S+))?/);
  if (!adm) throw new Error(`Ficha ${nome}: linha da admissão fora do formato.`);

  return {
    registro, matriculaEsocial: matricula, empregador, nome, beneficiarios, endereco, cep,
    dataNascimento: isoDeBr(nasc[0]), naturalidade, nacionalidade, estadoCivil, pai, mae, ...docs,
    ctpsNumero: mC[1], ctpsSerie: mC[2], ctpsEmissao: isoDeBr(mC[3]), ctpsUf: mC[4], cpf: mC[5],
    racaCor: cor && cor !== "Não Informada" ? cor : null, sexo: sexo ?? null, escolaridade: escolaridade ?? null,
    possuiDeficiencia: def === "Não" ? false : def === "Sim" ? true : null,
    cargoAdmissao: cargo[0], cboAdmissao: cargo[cargo.length - 1],
    dataAdmissao: isoDeBr(adm[1])!, salarioAdmissao: dinheiro(adm[2]),
    jornada: adm[3] ? { inicio: adm[3], fim: adm[4], intervaloInicio: adm[5] ?? "", intervaloFim: adm[6] ?? "" } : null,
    fgtsOpcao: isoDeBr(texto.match(/FGTS\s+(\d{2}\/\d{2}\/\d{4})/)?.[1]),
    pis: texto.match(/(\d{3}\.\d{5}\.\d{2}-\d)/)?.[1] ?? null,
    salarios: [], cargos: [], ferias: [],
  };
}

function lerSalarios(texto: string): FichaSalario[] {
  const re = /(?:Em )?(\d{2}\/\d{2}\/\d{4}) R\$ ([\d.,]+) por m[êe]s(?: retroativo a compet[êe]ncia (\d{2}\/\d{4}))?/g;
  return [...texto.matchAll(re)].map((m) => ({ vigencia: isoDeBr(m[1])!, valor: dinheiro(m[2]), retroativoCompetencia: m[3] ?? null }));
}

// "01/10/2019 - Cargo: 141515 GERENTE DE PLANTAO" com "Para: 141510 GERENTE GERAL" na mesma
// linha ou numa das duas seguintes (a coluna da direita divide a linha com os salários).
function lerCargos(ls: string[]): FichaCargo[] {
  const out: FichaCargo[] = [];
  ls.forEach((l, i) => {
    const m = l.match(/(\d{2}\/\d{2}\/\d{4}) - Cargo: (\d{6}) (.+?)(?:\s+Para: (\d{6}) (.+))?$/);
    if (!m) return;
    const para = m[4] ? [m[4], m[5]] : ls.slice(i + 1, i + 3).map((x) => x.match(/Para: (\d{6}) (.+)$/)).find(Boolean)?.slice(1, 3);
    out.push({ data: isoDeBr(m[1])!, deCbo: m[2], deCargo: m[3].replace(/\s{2,}.*/, "").trim(),
      paraCbo: para?.[0] ?? null, paraCargo: para?.[1]?.trim() ?? null });
  });
  return out;
}

const feriasDe = (ds: string[]): FichaFerias => ({
  aquisitivoInicio: isoDeBr(ds[0])!, aquisitivoFim: isoDeBr(ds[1])!,
  gozoInicio: isoDeBr(ds[2]), gozoFim: isoDeBr(ds[3]), abonoInicio: isoDeBr(ds[4]), abonoFim: isoDeBr(ds[5]),
});

// Dois formatos: "De a a b De c a d [De e a f]" na página principal; "a - b c - d [e - f]" em
// duas colunas na continuação.
function lerFerias(ls: string[]): FichaFerias[] {
  const out: FichaFerias[] = [];
  for (const l of ls) {
    for (const m of l.matchAll(/De (\S+) a (\S+) De (\S+) a (\S+)(?: De (\S+) a (\S+))?/g)) {
      out.push(feriasDe(m.slice(1).filter((x): x is string => Boolean(x))));
    }
  }
  const iCont = indice(ls, /PERÍODO AQUISITIVO - PERÍODO GOZO/);
  if (iCont >= 0) {
    for (const l of ls.slice(iCont + 1)) {
      for (const seg of l.trim().split(/\s{2,}/)) {
        const ds = seg.match(DATA) ?? [];
        if (ds.length >= 4) out.push(feriasDe(ds));
      }
    }
  }
  return out;
}

export function lerFichasRegistro(texto: string): FichaRegistro[] {
  const fichas: FichaRegistro[] = [];
  for (const b of blocos(texto)) {
    let ficha: FichaRegistro;
    if (b.tipo === "ficha") {
      ficha = lerFicha(b.linhas);
      fichas.push(ficha);
    } else {
      const reg = b.linhas[0].match(/Nº: (\d{6})/)![1];
      const achada = fichas.find((f) => f.registro === reg);
      if (!achada) throw new Error(`Página de continuação do registro ${reg} sem a ficha principal antes.`);
      ficha = achada;
    }
    ficha.salarios.push(...lerSalarios(b.linhas.join("\n")));
    ficha.cargos.push(...lerCargos(b.linhas));
    ficha.ferias.push(...lerFerias(b.linhas));
  }
  for (const f of fichas) f.salarios.sort((a, b) => a.vigencia.localeCompare(b.vigencia));
  return fichas;
}
