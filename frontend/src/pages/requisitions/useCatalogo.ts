import { useCallback, useEffect, useRef, useState } from "react";
import { getRequisitionCatalog, type RequisitionCatalogItem } from "../../api/client";

export type EstadoDoCatalogo = {
  itens: RequisitionCatalogItem[] | null;
  /** Não veio do servidor e não há cópia guardada: a lista não tem como abrir. */
  falhou: boolean;
  /** Lista guardada no aparelho usada porque o servidor não respondeu: os saldos podem estar desatualizados. */
  desatualizadaDesde: number | null;
  recarregar: () => void;
};

const chave = (userId: string) => `pateo:requisicao-catalogo:v2:${userId}`;

type Copia = { salvoEm: number; itens: RequisitionCatalogItem[] };

function lerCopia(userId: string): Copia | null {
  try {
    const bruto = localStorage.getItem(chave(userId));
    if (!bruto) return null;
    const copia = JSON.parse(bruto) as Partial<Copia>;
    return Array.isArray(copia.itens) && copia.itens.length > 0 ? { salvoEm: Number(copia.salvoEm) || 0, itens: copia.itens } : null;
  } catch {
    return null;
  }
}

function guardarCopia(userId: string, itens: RequisitionCatalogItem[]): void {
  try {
    localStorage.setItem(chave(userId), JSON.stringify({ salvoEm: Date.now(), itens } satisfies Copia));
  } catch {
    // Armazenamento cheio ou bloqueado: a lista segue funcionando, só não abre sem internet.
  }
}

/**
 * A lista de produtos com saldo vem inteira de uma vez, e filtrar e buscar acontece na tela.
 * A última lista fica guardada no aparelho: a tela abre na hora, com o saldo novo chegando por cima,
 * e quem está no estoque com sinal fraco não fica olhando uma tela vazia.
 */
export function useCatalogo(userId: string): EstadoDoCatalogo {
  const [copia] = useState<Copia | null>(() => lerCopia(userId));
  // Hora da última lista boa (guardada ou carregada nesta sessão): é a que o aviso mostra se o servidor falhar.
  const ultimaBoaRef = useRef<number | null>(copia?.salvoEm ?? null);
  const [itens, setItens] = useState<RequisitionCatalogItem[] | null>(copia?.itens ?? null);
  const [desatualizadaDesde, setDesatualizadaDesde] = useState<number | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let ativo = true;
    setFalhou(false);
    getRequisitionCatalog()
      .then((lista) => {
        if (!ativo) return;
        setItens(lista);
        setDesatualizadaDesde(null);
        guardarCopia(userId, lista);
        ultimaBoaRef.current = Date.now();
      })
      .catch(() => {
        if (!ativo) return;
        if (ultimaBoaRef.current != null) setDesatualizadaDesde(ultimaBoaRef.current);
        else setFalhou(true);
      });
    return () => {
      ativo = false;
    };
    // a cópia só vale na primeira abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tentativa]);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  return { itens, falhou, desatualizadaDesde, recarregar };
}
