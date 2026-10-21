import { useEffect, useState } from "react";
import { getTaxPayment, type TaxPaymentItem } from "../../api/client";
import { Money } from "../../design-system";
import "./tax-payments.css";

type Estado = { tipo: "carregando" } | { tipo: "erro" } | { tipo: "ok"; itens: TaxPaymentItem[] };

// A composição da guia (as linhas do documento), buscada só quando a pessoa abre a linha da lista.
export function ComposicaoDaGuia({ guiaId }: { guiaId: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });

  useEffect(() => {
    let descartada = false;
    getTaxPayment(guiaId)
      .then((d) => { if (!descartada) setEstado({ tipo: "ok", itens: d.items ?? [] }); })
      .catch(() => { if (!descartada) setEstado({ tipo: "erro" }); });
    return () => { descartada = true; };
  }, [guiaId]);

  if (estado.tipo === "carregando") return <p className="ip-composicao-msg" role="status">Carregando a composição…</p>;
  if (estado.tipo === "erro") return <p className="ip-composicao-msg ip-erro" role="alert">Não consegui carregar a composição desta guia.</p>;
  if (estado.itens.length === 0) {
    return <p className="ip-composicao-msg">Esta guia foi lançada sem composição (só o valor total). Abra "Editar guia" para discriminar as linhas.</p>;
  }

  const temMultaOuJuros = estado.itens.some((i) => Number(i.fine) > 0 || Number(i.interest) > 0);
  return (
    <table className="ip-composicao" aria-label="Composição da guia">
      <thead>
        <tr>
          <th scope="col">Código</th><th scope="col">Denominação</th><th scope="col">Principal</th>
          {temMultaOuJuros && <><th scope="col">Multa</th><th scope="col">Juros</th></>}
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {estado.itens.map((i) => (
          <tr key={i.id}>
            <td>{i.code ?? ""}</td>
            <td>{i.description}</td>
            <td><Money value={Number(i.principal)} /></td>
            {temMultaOuJuros && <><td><Money value={Number(i.fine)} /></td><td><Money value={Number(i.interest)} /></td></>}
            <td><strong><Money value={Number(i.principal) + Number(i.fine) + Number(i.interest)} /></strong></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
