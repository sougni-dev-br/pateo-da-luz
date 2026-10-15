import { Trash2 } from "lucide-react";
import { Button } from "../../design-system";
import type { RascunhoDaRequisicaoResumo } from "../../api/client";
import { TURNOS } from "./CabecalhoCompacto";

type Props = {
  rascunhos: RascunhoDaRequisicaoResumo[] | null;
  falhou: boolean;
  /** Id do rascunho que está aberto nesta tela, para marcar. */
  abertoId: string | null;
  onAbrir: (id: string) => void;
  onDescartar: (rascunho: RascunhoDaRequisicaoResumo) => void;
  onTentarDeNovo: () => void;
};

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Requisições começadas e ainda não registradas: qualquer pessoa com acesso a Requisições abre e continua, de qualquer aparelho. */
export function EmAndamento({ rascunhos, falhou, abertoId, onAbrir, onDescartar, onTentarDeNovo }: Props) {
  if (falhou) {
    return (
      <div className="req-banner is-erro" role="alert">
        <span>Não consegui carregar as requisições em andamento.</span>
        <Button variant="secondary" onClick={onTentarDeNovo}>Tentar de novo</Button>
      </div>
    );
  }
  if (rascunhos == null) return <ul className="rq-lista rq-esqueleto" aria-busy="true" aria-label="Carregando"><li className="rq-linha" /><li className="rq-linha" /></ul>;
  if (rascunhos.length === 0) {
    return (
      <div className="rq-vazio">
        <strong>Nenhuma requisição em andamento.</strong>
        <p>O que você começar em “Nova requisição” fica salvo aqui e pode ser continuado de qualquer aparelho.</p>
      </div>
    );
  }
  return (
    <ul className="ea-lista" aria-label="Requisições em andamento">
      {rascunhos.map((r) => (
        <li key={r.id} className={`ea-cartao${r.id === abertoId ? " is-aberto" : ""}`}>
          <div className="ea-texto">
            <strong>{r.itemCount} {r.itemCount === 1 ? "produto" : "produtos"}{r.id === abertoId ? " · aberta agora" : ""}</strong>
            <span className="ea-resumo">{r.summary ?? "Sem nome de produto"}</span>
            <small className="muted">
              {r.shift ? `${TURNOS[r.shift] ?? r.shift} · ` : ""}
              Atualizada {quando(r.updatedAt)}{r.updatedByName ? ` por ${r.updatedByName}` : ""}
              {r.createdByName && r.createdByName !== r.updatedByName ? ` · começada por ${r.createdByName}` : ""}
            </small>
          </div>
          <div className="ea-acoes">
            <Button variant="primary" onClick={() => onAbrir(r.id)}>{r.id === abertoId ? "Voltar" : "Continuar"}</Button>
            {r.id !== abertoId && (
              <Button variant="secondary" leadingIcon={<Trash2 size={14} />} aria-label={`Descartar a requisição de ${r.summary ?? "sem nome"}`} onClick={() => onDescartar(r)}>Descartar</Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
