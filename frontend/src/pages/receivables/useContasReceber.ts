import { useCallback, useEffect, useRef, useState } from "react";
import { getReceivables, getReceivableSummary, type ReceivableSummary, type ReceivableView } from "../../api/client";
import type { Vista } from "./regras";

export const LIMITE_DA_LISTA = 1000;

type Periodo = { startDate: string; endDate: string };

type Estado = {
  resumo: ReceivableSummary | null;
  /** Tudo que falta receber: alimenta o panorama, a agenda e a vista "A receber". */
  pendentes: ReceivableView[];
  /** Vistas de histórico (recebidas, canceladas, todas). Vazio na vista "A receber". */
  historico: ReceivableView[];
  carregando: boolean;
  erro: string | null;
  /** A lista bateu no limite do servidor: faltam linhas, é preciso refinar o período. */
  truncado: boolean;
};

const INICIAL: Estado = { resumo: null, pendentes: [], historico: [], carregando: true, erro: null, truncado: false };

function consultaDoHistorico(vista: Exclude<Vista, "pendentes">, periodo: Periodo) {
  const base = { startDate: periodo.startDate || undefined, endDate: periodo.endDate || undefined, limit: LIMITE_DA_LISTA };
  if (vista === "recebidas") return { ...base, status: "RECEIVED" as const, dateField: "received" as const };
  if (vista === "canceladas") return { ...base, status: "CANCELLED" as const, dateField: "expected" as const };
  return { ...base, dateField: "expected" as const };
}

/**
 * Carrega o resumo (totais do servidor, que não dependem do limite da lista), as contas
 * pendentes e, nas vistas de histórico, a lista do período. Respostas atrasadas são descartadas.
 */
export function useContasReceber(vista: Vista, periodo: Periodo) {
  const [estado, setEstado] = useState<Estado>(INICIAL);
  const sequencia = useRef(0);
  const { startDate, endDate } = periodo;

  const recarregar = useCallback(async () => {
    const minha = ++sequencia.current;
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
    try {
      const [resumo, pendentes, historico] = await Promise.all([
        getReceivableSummary(),
        getReceivables({ status: "PENDING", limit: LIMITE_DA_LISTA }),
        vista === "pendentes" ? Promise.resolve<ReceivableView[]>([]) : getReceivables(consultaDoHistorico(vista, { startDate, endDate }))
      ]);
      if (minha !== sequencia.current) return;
      setEstado({
        resumo,
        pendentes: Array.isArray(pendentes) ? pendentes : [],
        historico: Array.isArray(historico) ? historico : [],
        carregando: false,
        erro: null,
        truncado: pendentes.length >= LIMITE_DA_LISTA || historico.length >= LIMITE_DA_LISTA
      });
    } catch (e) {
      if (minha !== sequencia.current) return;
      setEstado({ ...INICIAL, carregando: false, erro: e instanceof Error ? e.message : "Falha ao carregar contas a receber." });
    }
  }, [vista, startDate, endDate]);

  useEffect(() => {
    void recarregar();
    return () => { sequencia.current += 1; };
  }, [recarregar]);

  return { ...estado, recarregar };
}
