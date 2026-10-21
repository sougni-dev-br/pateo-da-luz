// Modelos de lançamento: cada tipo de guia já traz as linhas que o documento oficial costuma ter,
// para quem lança só digitar os valores. Os códigos e denominações são os do documento impresso.

export type LinhaDoModelo = { code: string; description: string };

export type ModeloDeGuia = {
  /** Como o documento chama o campo do número ("Número do documento" no DAS/DARF, "Identificador" no FGTS). */
  rotuloDocumento: string;
  /** O documento sempre traz o número (DAS, DARF, FGTS): lançar sem ele é pendência. */
  numeroObrigatorio: boolean;
  /** O que costuma ir em Observações neste tipo (o documento traz, mas não tem campo próprio). */
  dicaObservacoes: string;
  /** Linhas que já aparecem ao escolher o tipo (as que ficarem sem valor são ignoradas ao salvar). */
  linhas: LinhaDoModelo[];
  /** Outras denominações conhecidas, oferecidas como sugestão ao digitar. */
  sugestoes: LinhaDoModelo[];
};

const DAS: LinhaDoModelo[] = [
  { code: "1001", description: "IRPJ - SIMPLES NACIONAL" },
  { code: "1002", description: "CSLL - SIMPLES NACIONAL" },
  { code: "1004", description: "COFINS - SIMPLES NACIONAL" },
  { code: "1005", description: "PIS - SIMPLES NACIONAL" },
  { code: "1006", description: "INSS - SIMPLES NACIONAL" },
  { code: "1007", description: "ICMS - SIMPLES NACIONAL SP" },
];

// O FGTS Digital não tem código: as colunas da guia viram linhas.
const FGTS: LinhaDoModelo[] = [
  { code: "", description: "FGTS Mensal" },
  { code: "", description: "FGTS Rescisório" },
  { code: "", description: "Indenização Compensatória" },
  { code: "", description: "Encargos FGTS" },
];

const DARF_PREVIDENCIARIO: LinhaDoModelo[] = [
  { code: "1082", description: "CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO" },
  { code: "1099", description: "CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL" },
];

const IRRF: LinhaDoModelo = { code: "0561", description: "IRRF - RENDIMENTO DO TRABALHO ASSALARIADO" };

const LINHA_EM_BRANCO: LinhaDoModelo = { code: "", description: "" };

export function modeloDoTipo(tipo: string): ModeloDeGuia {
  switch (tipo) {
    case "Simples Nacional / DAS":
      return { numeroObrigatorio: true, rotuloDocumento: "Número do documento", dicaObservacoes: "", linhas: DAS, sugestoes: [] };
    case "FGTS":
      return { numeroObrigatorio: true, rotuloDocumento: "Identificador", dicaObservacoes: "Ex.: quantidade de trabalhadores informada na guia.", linhas: FGTS, sugestoes: [] };
    case "DARF":
      return { numeroObrigatorio: true, rotuloDocumento: "Número do documento", dicaObservacoes: "Ex.: Nº do recibo da declaração, que vem no campo Observações da guia.", linhas: DARF_PREVIDENCIARIO, sugestoes: [IRRF] };
    case "DARF IR":
    case "IRRF":
      return { numeroObrigatorio: true, rotuloDocumento: "Número do documento", dicaObservacoes: "", linhas: [IRRF], sugestoes: [] };
    default:
      return { numeroObrigatorio: false, rotuloDocumento: "Número do documento", dicaObservacoes: "", linhas: [LINHA_EM_BRANCO], sugestoes: [] };
  }
}

// Denominações oferecidas na lista de sugestões: as do modelo e as extras.
export function sugestoesDoTipo(tipo: string): LinhaDoModelo[] {
  const m = modeloDoTipo(tipo);
  const todas = [...m.linhas, ...m.sugestoes].filter((l) => l.description);
  return todas.filter((l, i) => todas.findIndex((o) => o.description === l.description) === i);
}
