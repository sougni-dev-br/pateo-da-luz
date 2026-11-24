import { Check, Undo2 } from "lucide-react";
import type { PessoaBrinde } from "../../../api/client";
import { Button, StatusBadge, TextField } from "../../../design-system";
import { dataBr } from "./brindeLista";

type Props = {
  pessoa: PessoaBrinde;
  ocupada: boolean;
  onAlternar: (p: PessoaBrinde) => void;
  onData: (p: PessoaBrinde, iso: string) => void;
  onObservacao: (p: PessoaBrinde, texto: string) => void;
};

// Os quatro blocos ficam sempre na mesma posição: o botão da ação é o MESMO elemento ao marcar e ao
// desfazer, então o foco do teclado não se perde quando a linha muda de situação.
export function LinhaPessoa({ pessoa, ocupada, onAlternar, onData, onObservacao }: Props) {
  const e = pessoa.entrega;
  const classe = ["br-linha", e && "br-linha--feito", !e && pessoa.saidaEm && "br-linha--atencao"].filter(Boolean).join(" ");
  return (
    <li className={classe}>
      <div className="br-nome">
        <strong>{pessoa.nome}</strong>
        <span className="br-sub">{[pessoa.setor, pessoa.cargo].filter(Boolean).join(" · ") || "Sem setor"}</span>
      </div>

      <div className="br-situacao">
        {e ? <StatusBadge tone="success">Recebeu em {dataBr(e.entregueEm)}</StatusBadge> : <StatusBadge>Ainda não recebeu</StatusBadge>}
        {!pessoa.ativo && <StatusBadge tone="warning">Já saiu da empresa</StatusBadge>}
        {pessoa.saidaEm && <StatusBadge tone="warning">Saída em {dataBr(pessoa.saidaEm)}</StatusBadge>}
        {e?.registradoPor && <span className="br-sub">Marcado por {e.registradoPor}</span>}
      </div>

      <div className="br-detalhes">
        {e && (
          <>
            <TextField
              key={`d-${e.entregueEm}`} type="date" label="Data da entrega" defaultValue={e.entregueEm} disabled={ocupada}
              onBlur={(ev) => { if (ev.target.value && ev.target.value !== e.entregueEm) onData(pessoa, ev.target.value); }}
            />
            <TextField
              key={`o-${e.observacao ?? ""}`} label="Observação" placeholder="Ex.: retirou o irmão" maxLength={300} defaultValue={e.observacao ?? ""} disabled={ocupada}
              onBlur={(ev) => { if (ev.target.value.trim() !== (e.observacao ?? "")) onObservacao(pessoa, ev.target.value); }}
              onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur(); }}
            />
          </>
        )}
      </div>

      <div className="br-acao">
        <Button
          size="sm" variant="secondary" disabled={ocupada || (!e && !pessoa.ativo)}
          leadingIcon={e ? <Undo2 size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
          aria-label={e ? `Desfazer a entrega de ${pessoa.nome}` : `Marcar ${pessoa.nome} como entregue`}
          onClick={() => onAlternar(pessoa)}
        >
          {e ? "Desfazer" : "Marcar como entregue"}
        </Button>
      </div>
    </li>
  );
}
