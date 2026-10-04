import { useEffect, useRef, useState } from "react";
import { getBuffetUsage, type BuffetUsageReport, type PlateListKind } from "../../../api/client";

export type Janela = 7 | 30 | 90;
export const JANELAS: Array<{ dias: Janela; rotulo: string }> = [
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
];

export const dataCurtaIso = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
export const vezes = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

type Estado = { relatorio: BuffetUsageReport | null; carregando: boolean; erro: string | null };

// Lê o acompanhamento de um tipo de lista. `versao` muda quando uma impressão nova é
// registrada, para os números já virem com o dia de hoje.
export function useAcompanhamento(tipo: PlateListKind, janela: Janela, versao: number, ativo = true): Estado {
  const [estado, setEstado] = useState<Estado>({ relatorio: null, carregando: true, erro: null });
  const chaveAnterior = useRef("");
  useEffect(() => {
    if (!ativo) return undefined;
    let vivo = true;
    // Outro tipo ou período: os números antigos saem da tela até os novos chegarem.
    // Só uma impressão nova (mesma chave) mantém os números enquanto relê.
    const chave = `${tipo}|${janela}`;
    setEstado((e) => ({ relatorio: chave === chaveAnterior.current ? e.relatorio : null, carregando: true, erro: null }));
    chaveAnterior.current = chave;
    getBuffetUsage(tipo, janela)
      .then((relatorio) => { if (vivo) setEstado({ relatorio, carregando: false, erro: null }); })
      .catch((x) => { if (vivo) setEstado({ relatorio: null, carregando: false, erro: x instanceof Error ? x.message : "Não foi possível carregar o acompanhamento." }); });
    return () => { vivo = false; };
  }, [tipo, janela, versao, ativo]);
  return estado;
}
