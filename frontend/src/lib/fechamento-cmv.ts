// Qual e o proximo passo para fechar o CMV do mes.
//
// O Inventario Final CMV nasce em RASCUNHO e so vira base do CMV depois de
// enviado para revisao e aprovado. O painel que explicava isso na tela de
// detalhe so aparecia com status EM_REVISAO: quem estava em RASCUNHO — ou seja,
// todo mundo que acabou de consolidar — nao via nenhuma indicacao do que fazer,
// e o botao "Enviar para revisao" ficava numa barra generica no fim da pagina,
// sem se apresentar como o proximo passo.
//
// Esta funcao e a fonte unica dessa resposta, usada tanto no card do fechamento
// quanto no painel de dentro do inventario.

export type StatusInventario = string;

export type ProximoPasso = {
  /** O que fazer agora, em uma frase. */
  titulo: string;
  /** Por que, ou o que acontece ao fazer. */
  descricao: string;
  /** Texto do botao. Ausente quando nao ha acao a tomar. */
  rotuloAcao?: string;
  /** Qual acao o botao dispara. */
  acao?: "submit" | "approve";
  /** true quando o fechamento ja terminou. */
  concluido?: boolean;
};

export function proximoPassoDoFechamento(status: StatusInventario, cobertaCompleta: boolean): ProximoPasso {
  if (status === "RASCUNHO" || status === "REJEITADO") {
    return {
      titulo: status === "REJEITADO" ? "Inventário rejeitado — ajuste e reenvie" : "Falta enviar para revisão",
      descricao: cobertaCompleta
        ? "A contagem está completa. Enviar para revisão é o passo antes de aprovar e virar base do CMV."
        : "Ainda há produtos sem contagem. Dá para enviar assim mesmo, mas o que faltar entra como zero.",
      rotuloAcao: "Enviar para revisão",
      acao: "submit",
    };
  }

  if (status === "EM_REVISAO") {
    return {
      titulo: "Pronto para aprovação",
      descricao: "Ao aprovar, a base de estoque do CMV Real é criada. Depois disso, reabrir exige cancelar ou revisar o inventário.",
      rotuloAcao: "Aprovar e disponibilizar para CMV",
      acao: "approve",
    };
  }

  if (status === "APROVADO" || status === "FECHADO") {
    return {
      titulo: "Fechamento concluído",
      descricao: "A base de estoque do CMV Real já foi criada a partir deste inventário.",
      concluido: true,
    };
  }

  return {
    titulo: `Status ${status}`,
    descricao: "Sem próximo passo definido para este status.",
  };
}
