import { useCallback, useEffect, useState } from "react";
import { getRequisitionCatalog, type RequisitionCatalogItem } from "../../api/client";

export type EstadoDoCatalogo = { itens: RequisitionCatalogItem[] | null; falhou: boolean; recarregar: () => void };

/** A lista de produtos com saldo vem inteira de uma vez: filtrar e buscar acontece na tela, sem esperar o servidor. */
export function useCatalogo(): EstadoDoCatalogo {
  const [itens, setItens] = useState<RequisitionCatalogItem[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let ativo = true;
    setFalhou(false);
    getRequisitionCatalog()
      .then((lista) => {
        if (ativo) setItens(lista);
      })
      .catch(() => {
        if (ativo) setFalhou(true);
      });
    return () => {
      ativo = false;
    };
  }, [tentativa]);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  return { itens, falhou, recarregar };
}
