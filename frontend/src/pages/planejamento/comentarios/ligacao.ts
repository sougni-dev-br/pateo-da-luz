import type { PlanejamentoComentario } from "../../../api/client";
import type { PontoDeComentario } from "./ponto";

/** O que as telas do Comparativo precisam para mostrar marcas e abrir a gaveta de comentários. */
export type LigacaoDeComentarios = {
  todos: readonly PlanejamentoComentario[];
  porPonto: ReadonlyMap<string, readonly PlanejamentoComentario[]>;
  podeEscrever: boolean;
  abrir: (ponto: PontoDeComentario) => void;
};
