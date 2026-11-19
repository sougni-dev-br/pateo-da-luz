import { useEffect, useMemo, useState } from "react";
import { type TipComputation, type TipMudanca, getTipChanges } from "../../api/client";
import { StatusBadge } from "../../design-system";
import { TIPO_MUDANCA, fmtDia, fmtDiaDigitado } from "./HistoricoLinhaDoTempo";
import { mudancasDoCiclo } from "./listaMudancasDoCiclo";

// Linha do tempo do ciclo aberto: quem mudou de função ou de pontos, de quando vale, por quê e
// quem registrou. Some quando nada mudou, para não ocupar a tela.
export function MudancasDoCiclo({ comp }: { comp: TipComputation }) {
  const [dados, setDados] = useState<TipMudanca[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const inicio = comp.periodStart.slice(0, 10);
  const fim = comp.periodEnd.slice(0, 10);
  // Pontos e funções mudam o cálculo: recarrega quando mudam (e não a cada edição de falta).
  const assinatura = useMemo(
    () => comp.participants.map((p) => `${p.employeeId}:${p.functionName ?? ""}:${p.basePoints}`).join("|"),
    [comp.participants],
  );

  useEffect(() => {
    let atual = true;
    setFalhou(false);
    setDados(null); // o ciclo mudou: não mostra a lista do anterior enquanto a nova não chega
    getTipChanges(inicio, fim)
      .then((r) => { if (atual) setDados(r); })
      .catch(() => { if (atual) setFalhou(true); });
    return () => { atual = false; };
  }, [inicio, fim, assinatura]);

  const mudancas = useMemo(() => (dados ? mudancasDoCiclo(dados, comp.periodStart, comp.periodEnd) : []), [dados, comp.periodStart, comp.periodEnd]);

  if (falhou) return <p className="mudancas-ciclo-aviso" role="status">Não consegui carregar as mudanças de função e pontos deste ciclo.</p>;
  if (mudancas.length === 0) return null;
  const retroativas = mudancas.filter((m) => m.retroativa).length;

  return (
    <details className="mudancas-ciclo">
      <summary>
        Mudanças de função e pontos neste ciclo ({mudancas.length})
        {retroativas > 0 && <StatusBadge tone="warning">{retroativas} lançada{retroativas === 1 ? "" : "s"} depois do fim do ciclo</StatusBadge>}
      </summary>
      <ul>
        {mudancas.map((m) => (
          <li key={m.id}>
            <strong>{m.apelido ?? m.employeeName}</strong>
            <StatusBadge tone={TIPO_MUDANCA[m.tipo].tom}>{TIPO_MUDANCA[m.tipo].rotulo}</StatusBadge>
            <span>{m.resumo}</span>
            <span className="mudancas-ciclo-meta">
              vale desde {fmtDia(m.validFrom)}
              {m.registradoPor ? ` · registrada por ${m.registradoPor}` : ""} em {fmtDiaDigitado(m.registradoEm)}
              {m.motivo ? ` · ${m.motivo}` : ""}
            </span>
            {m.retroativa && <StatusBadge tone="warning">depois do fim do ciclo</StatusBadge>}
          </li>
        ))}
      </ul>
    </details>
  );
}
