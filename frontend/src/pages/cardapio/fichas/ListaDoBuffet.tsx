import { Clock3 } from "lucide-react";
import type { BuffetDish } from "../../../api/client";
import { StatusBadge } from "../../../design-system";
import { formatDate } from "../../../utils/format";

const quantidade = (valor: number, unidade: string) => `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unidade}`;

type Props = {
  pratos: BuffetDish[];
  selecionadoId: string | null;
  carregando: boolean;
  onSelecionar: (id: string) => void;
};

/**
 * Preparações do buffet (purê, farofa…) criadas pelo lançamento de desperdício. As que aguardam ficha vêm
 * primeiro, com o que mais saiu na frente: é o que o responsável cobra da equipe (ingredientes e quantidades).
 */
export function ListaDoBuffet({ pratos, selecionadoId, carregando, onSelecionar }: Props) {
  const aguardando = pratos.filter((p) => p.pending);
  const concluidas = pratos.filter((p) => !p.pending);

  if (pratos.length === 0) {
    return (
      <div className="ft-buffet-vazio">
        {carregando ? <p role="status">Carregando…</p> : (
          <>
            <h2>Nenhuma preparação do buffet ainda</h2>
            <p>Quando alguém lançar um desperdício de um prato que não tem ficha (o purê, uma guarnição), ele aparece aqui para a ficha ser montada.</p>
          </>
        )}
      </div>
    );
  }

  const grupo = (titulo: string, itens: BuffetDish[], aguardandoFicha: boolean) => itens.length === 0 ? null : (
    <section className="ft-buffet-grupo" aria-label={titulo}>
      <h3>{titulo} <span>{itens.length}</span></h3>
      <ul>
        {itens.map((p) => (
          <li key={p.id}>
            <button type="button" className={p.id === selecionadoId ? "ft-buffet-item ft-buffet-item--ativo" : "ft-buffet-item"} aria-current={p.id === selecionadoId || undefined} onClick={() => onSelecionar(p.id)}>
              <span className="ft-buffet-linha">
                <strong>{p.name}</strong>
                {aguardandoFicha ? <StatusBadge tone="warning">Aguardando ficha</StatusBadge> : <StatusBadge tone="success">Com ficha</StatusBadge>}
              </span>
              <span className="ft-buffet-meta">
                {p.wasteEntries > 0
                  ? `${p.wasteEntries} ${p.wasteEntries === 1 ? "lançamento" : "lançamentos"} · ${quantidade(p.wasteQuantity, p.unit)} perdidos`
                  : "Nenhum lançamento de desperdício"}
              </span>
              {aguardandoFicha && (
                <span className="ft-buffet-meta">
                  <Clock3 size={12} aria-hidden /> Pedido{p.requestedBy ? ` por ${p.requestedBy}` : ""}{p.pendingSince ? ` em ${formatDate(p.pendingSince)}` : ""}
                </span>
              )}
              {aguardandoFicha && p.notes && <span className="ft-buffet-obs">Leva: {p.notes}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="ft-buffet">
      {grupo("Aguardando ficha", aguardando, true)}
      {grupo("Com ficha", concluidas, false)}
    </div>
  );
}
