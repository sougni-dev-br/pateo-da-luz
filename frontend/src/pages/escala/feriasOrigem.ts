// As férias que a grade da Escala sombreia vêm de dois lugares; o texto da célula diz de qual.
export type OrigemDasFerias = "FOLHA" | "PROGRAMACAO";

export const TITULO_DAS_FERIAS: Record<OrigemDasFerias, string> = {
  FOLHA: "Férias (gerenciado na Folha)",
  PROGRAMACAO: "Férias programadas (RH > Férias)",
};
export const ROTULO_ACESSIVEL_DAS_FERIAS: Record<OrigemDasFerias, string> = {
  FOLHA: "Férias (Folha)",
  PROGRAMACAO: "Férias (programadas)",
};
