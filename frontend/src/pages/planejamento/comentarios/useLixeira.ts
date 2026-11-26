import { useCallback, useEffect, useMemo, useState } from "react";
import { listarLixeiraDeComentarios, type PlanejamentoComentarioApagado } from "../../../api/client";
import { mensagemHumana } from "../erros";
import { agruparPorPonto } from "./ponto";

// Lixeira dos comentários do ano comparado. Só carrega para quem modera (o servidor recusa os demais com 403).

export function useLixeira(anoComparado: number, ativo: boolean) {
  const [apagados, setApagados] = useState<readonly PlanejamentoComentarioApagado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!ativo) { setApagados([]); return undefined; }
    let cancelado = false;
    listarLixeiraDeComentarios(anoComparado)
      .then((lista) => { if (!cancelado) { setApagados(lista); setErro(null); } })
      .catch((e: unknown) => { if (!cancelado) setErro(mensagemHumana(e, "Não foi possível carregar a lixeira.")); });
    return () => { cancelado = true; };
  }, [anoComparado, ativo, tentativa]);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);
  const remover = useCallback((id: string) => setApagados((atual) => atual.filter((c) => c.id !== id)), []);
  const porPonto = useMemo(() => agruparPorPonto(apagados), [apagados]);

  return { apagados, porPonto, erro, recarregar, remover };
}

export type LixeiraApi = ReturnType<typeof useLixeira>;
