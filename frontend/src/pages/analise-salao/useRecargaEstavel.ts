import { useRef, useState } from "react";

type Relatorio<T> = { dados: T | null; carregando: boolean; erro: string | null; recarregar: () => void };

// Depois de uma gravação (vincular, desfazer) o relatório é relido. Em vez de sumir com o painel e jogar o foco no
// <body>, o dado anterior continua na tela até o novo chegar, e um aviso de status confirma o que aconteceu. O dado e o
// aviso valem só para o período em que foram dados: trocar de período volta ao comportamento normal, e nunca aparece
// o dado de um período sob o outro.
export function useRecargaEstavel<T>(relatorio: Relatorio<T>, chavePeriodo: string) {
  const ultimo = useRef<{ chave: string; dados: T } | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; chave: string } | null>(null);
  if (relatorio.dados) ultimo.current = { chave: chavePeriodo, dados: relatorio.dados };
  const avisoAtual = aviso && aviso.chave === chavePeriodo ? aviso.texto : null;
  const anterior = ultimo.current && ultimo.current.chave === chavePeriodo ? ultimo.current.dados : null;
  const naTela = relatorio.dados ?? (relatorio.carregando && avisoAtual !== null ? anterior : null);

  return {
    naTela,
    aviso: avisoAtual,
    recalculando: relatorio.carregando,
    erro: relatorio.erro,
    anunciarERecarregar(texto: string) {
      setAviso({ texto, chave: chavePeriodo });
      relatorio.recarregar();
    }
  };
}
