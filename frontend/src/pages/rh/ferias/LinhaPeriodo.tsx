import { Check, MessageSquareText, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ProgramacaoFerias } from "../../../api/client";
import { Button, StatusBadge } from "../../../design-system";
import { type LinhaFerias, dataBr, plural, resumoProgramacao, rotuloDaSituacao, textoPrazo, tomDaSituacao } from "./feriasFormato";
import { ROTULO_DA_SITUACAO_DO_PEDIDO, compararPedido, diferencaEmPalavras, resumoDoPedido } from "./pedido";

type Props = {
  linha: LinhaFerias;
  ocupado: boolean;
  /** Formulário aberto nesta linha, quando houver. */
  formulario: ReactNode;
  onProgramar: () => void;
  /** Registrar ou ver o pedido do colaborador. */
  onPedido: () => void;
  onJaGozou: () => void;
  onEditar: (g: ProgramacaoFerias) => void;
  onCancelar: (g: ProgramacaoFerias) => void;
  onConfirmar: (g: ProgramacaoFerias) => void;
  onDesfazer: (g: ProgramacaoFerias) => void;
};

// Os botões levam o nome da pessoa e o texto visível no começo do nome acessível (WCAG 2.5.3):
// "Programar" → "Programar férias de Ana". O ocupado usa aria-disabled para o foco não se perder.
export function LinhaPeriodo({ linha, ocupado, formulario, onProgramar, onPedido, onJaGozou, onEditar, onCancelar, onConfirmar, onDesfazer }: Props) {
  const { pessoa, periodo: p } = linha;
  const nome = pessoa.nome;
  const podeProgramar = p.situacao !== "EM_AQUISICAO" && p.diasPendentes > 0 && !p.doHistorico;
  const urgente = p.nivel !== "ok";
  const guarda = (acao: () => void) => () => { if (!ocupado) acao(); };
  const comparacao = compararPedido(p);
  // Dá para pedir enquanto há o que programar; quem já gozou tudo (ou ainda está ganhando o direito) só vê o pedido que já existe.
  const podePedir = p.solicitacao !== null && p.solicitacao !== undefined || (p.situacao !== "EM_AQUISICAO" && p.situacao !== "GOZADA" && !p.doHistorico);

  return (
    <li className={`fe-linha fe-linha--${p.nivel}`}>
      <div className="fe-pessoa">
        <h3 className="fe-nome">{nome}</h3>
        {pessoa.empresa && <span className="fe-sub">{pessoa.empresa}</span>}
      </div>
      <div className="fe-periodo">
        <span className="fe-rotulo">Período aquisitivo</span>
        {dataBr(p.aquisitivoInicio)} a {dataBr(p.aquisitivoFim)}
      </div>
      <div className="fe-limite">
        <span className="fe-rotulo">Começar até</span>
        <strong>{dataBr(p.limiteInicioGozo)}</strong>
        <span className="fe-sub">{textoPrazo(p)}</span>
      </div>
      <div className="fe-situacao">
        <StatusBadge tone={tomDaSituacao(p)}>{rotuloDaSituacao(p)}</StatusBadge>
        {podeProgramar && <span className="fe-sub">{p.diasPendentes} {plural(p.diasPendentes, "dia", "dias")} a programar</span>}
        {p.doHistorico && <span className="fe-sub">consta na ficha de registro</span>}
      </div>
      <div className="fe-acoes">
        {p.solicitacao && comparacao && (
          <div className="fe-pedido-linha">
            <span><b>Pediu:</b> {resumoDoPedido(p.solicitacao)}</span>
            <span className={`fe-tl-situacao fe-tl-situacao--${comparacao.situacao.toLowerCase()}`}>{ROTULO_DA_SITUACAO_DO_PEDIDO[comparacao.situacao]}</span>
            {comparacao.situacao === "DIFERENTE" && diferencaEmPalavras(comparacao.diferencaEmDias) && <span className="fe-sub">{diferencaEmPalavras(comparacao.diferencaEmDias)}</span>}
            {comparacao.passaDoPrazo && <span className="fe-tl-situacao fe-tl-situacao--prazo">passa do prazo limite</span>}
          </div>
        )}
        {p.programacoes.map((g) => {
          const resumo = resumoProgramacao(g);
          return (
            <div key={g.id} className="fe-programacao">
              <span>{g.status === "GOZADA" ? "Gozou: " : p.solicitacao ? "Empresa quer: " : ""}{resumo}</span>
              <span className="fe-botoes">
                {g.status === "PROGRAMADA" && g.passouDaData && (
                  <Button size="sm" variant="secondary" leadingIcon={<Check size={14} />} aria-disabled={ocupado} aria-label={`Confirmar que gozou, férias de ${nome} (${resumo})`} onClick={guarda(() => onConfirmar(g))}>Confirmar que gozou</Button>
                )}
                {g.status === "PROGRAMADA" && (
                  <>
                    <Button size="sm" variant="icon" aria-disabled={ocupado} aria-label={`Editar férias de ${nome} (${resumo})`} onClick={guarda(() => onEditar(g))}><Pencil size={14} /></Button>
                    <Button size="sm" variant="icon" aria-disabled={ocupado} aria-label={`Cancelar programação de ${nome} (${resumo})`} onClick={guarda(() => onCancelar(g))}><Trash2 size={14} /></Button>
                  </>
                )}
                {g.status === "GOZADA" && (
                  <Button size="sm" variant="icon" aria-disabled={ocupado} aria-label={`Desfazer férias gozadas de ${nome} (${resumo})`} onClick={guarda(() => onDesfazer(g))}><Undo2 size={14} /></Button>
                )}
              </span>
            </div>
          );
        })}
        {podePedir && (
          <span className="fe-botoes">
            <Button size="sm" variant="secondary" leadingIcon={<MessageSquareText size={14} />} aria-disabled={ocupado}
              aria-label={`${p.solicitacao ? "Ver pedido" : "Registrar pedido"} de férias de ${nome}`} onClick={guarda(onPedido)}>
              {p.solicitacao ? "Ver pedido" : "Registrar pedido"}
            </Button>
          </span>
        )}
        {podeProgramar && (
          <span className="fe-botoes">
            <Button size="sm" variant={urgente ? "primary" : "secondary"} leadingIcon={<Plus size={14} />} aria-disabled={ocupado}
              aria-label={`${p.programacoes.length ? "Programar o resto das férias" : "Programar férias"} de ${nome}`} onClick={guarda(onProgramar)}>
              {p.programacoes.length ? "Programar o resto" : "Programar"}
            </Button>
            <Button size="sm" variant="secondary" aria-disabled={ocupado} aria-label={`Já gozou, período de ${nome}`} onClick={guarda(onJaGozou)}>Já gozou</Button>
          </span>
        )}
      </div>
      {formulario && <div className="fe-formulario">{formulario}</div>}
    </li>
  );
}
