// Pessoas dentro do título do lote de pagamento da folha. Com o título em aberto, quem
// gere o Contas a Pagar tira alguém do título da empresa (vai para a "Folha à parte") ou,
// na folha à parte, devolve ao título de onde saiu.
import { Undo2, UserMinus } from "lucide-react";
import type { MembroFolhaLote, Payable } from "../../api/client";
import { Money } from "../../design-system";
import { ehFolhaAParte, estaEmAberto } from "./regras";

type Props = {
  titulo: Payable;
  podeGerir: boolean;
  ocupado?: boolean;
  onRetirar?: (titulo: Payable, membro: MembroFolhaLote) => void;
  onDevolver?: (titulo: Payable, membro: MembroFolhaLote) => void;
};

export function MembrosDoLote({ titulo, podeGerir, ocupado = false, onRetirar, onDevolver }: Props) {
  const membros = titulo.loteMembros ?? [];
  const aParte = ehFolhaAParte(titulo);
  const mexe = podeGerir && estaEmAberto(titulo);
  if (membros.length === 0) return <p className="pg-nota">Ninguém neste título.</p>;
  return (
    <ul className="pg-lote-membros" aria-label={`Pessoas em ${titulo.supplierName}`}>
      {membros.map((m) => (
        <li key={m.id}>
          <span className="pg-lote-nome">
            {m.nome}
            {aParte && m.origem && <small> · saiu de {m.origem}</small>}
          </span>
          <strong className="pg-num"><Money value={Number(m.valor)} /></strong>
          {mexe && !aParte && onRetirar && (
            <button type="button" className="pg-lote-acao" disabled={ocupado} onClick={() => onRetirar(titulo, m)}
              aria-label={`Retirar ${m.nome} do lote`} title="Tirar deste título: vai para a folha à parte">
              <UserMinus size={13} /> retirar
            </button>
          )}
          {mexe && aParte && onDevolver && (
            <button type="button" className="pg-lote-acao" disabled={ocupado} onClick={() => onDevolver(titulo, m)}
              aria-label={`Devolver ${m.nome} ao lote de origem`} title="Voltar ao título da empresa">
              <Undo2 size={13} /> devolver
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
