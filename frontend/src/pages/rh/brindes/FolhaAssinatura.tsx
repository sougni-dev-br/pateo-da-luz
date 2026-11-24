import { createPortal } from "react-dom";
import type { DetalheBrinde } from "../../../api/client";
import { agruparPorEmpresa, dataBr } from "./brindeLista";

// Folha para imprimir e colher a assinatura na entrega: só funcionários ativos (e quem já recebeu).
// Vai para o <body> e só aparece na impressão (ver brindes.css).
export function FolhaAssinatura({ detalhe }: { detalhe: DetalheBrinde }) {
  const grupos = agruparPorEmpresa(detalhe.pessoas.filter((p) => p.ativo || p.entrega));
  return createPortal(
    <div className="br-area-impressao" aria-hidden="true">
      <h1>{detalhe.campanha.nome} {detalhe.campanha.ano}</h1>
      <p className="br-folha-sub">
        Impresso em {dataBr(detalhe.hoje)} · {detalhe.resumo.entregues} de {detalhe.resumo.ativos} ativos já receberam
      </p>
      {grupos.map((g) => (
        <section key={g.empresa} className="br-folha-grupo">
          <h2>{g.empresa}</h2>
          <table>
            <thead><tr><th>Nome</th><th>Setor</th><th>Entregue em</th><th>Assinatura</th></tr></thead>
            <tbody>
              {g.pessoas.map((p) => (
                <tr key={p.employeeId}>
                  <td>{p.nomeCompleto}</td>
                  <td>{p.setor ?? ""}</td>
                  <td>{p.entrega ? dataBr(p.entrega.entregueEm) : ""}</td>
                  <td className="br-assina" />
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>,
    document.body,
  );
}
