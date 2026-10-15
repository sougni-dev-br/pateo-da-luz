import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  apagarRascunhoDaRequisicao,
  criarRascunhoDaRequisicao,
  getRascunhoDaRequisicao,
  salvarRascunhoDaRequisicao,
  type ConteudoDoRascunhoDaRequisicao
} from "../../api/client";
import { escolhasComQuantidade, type Escolhas } from "./catalogo";
import type { DadosDoCabecalho } from "./rascunho";

/** Identificação do rascunho no sistema: o id e a versão que este aparelho viu por último. */
export type RascunhoNoServidor = { id: string; version: number };

export type EstadoDoRascunho = "parado" | "salvando" | "salvo" | "falhou" | "conflito";

/** Espera depois da última digitação: a requisição é montada em rajadas, não a cada tecla. */
const ESPERA_MS = 1500;

type Entrada = {
  inicial: RascunhoNoServidor | null;
  cabecalho: DadosDoCabecalho;
  escolhas: Escolhas;
  resumo: string;
  /** true enquanto se registra: nada é salvo por cima. */
  pausado: boolean;
  onAviso: (tom: "warning", mensagem: string) => void;
};

/**
 * Requisição em andamento salva no sistema: qualquer aparelho abre e continua. O rascunho do aparelho
 * (localStorage) segue como rede de segurança sem internet; este hook só espelha no servidor, com versão
 * para que dois aparelhos editando não se sobrescrevam em silêncio.
 */
export function useRascunhoNoServidor({ inicial, cabecalho, escolhas, resumo, pausado, onAviso }: Entrada) {
  const servidorRef = useRef<RascunhoNoServidor | null>(inicial);
  const [estado, setEstado] = useState<EstadoDoRascunho>(inicial ? "salvo" : "parado");
  const [conflito, setConflito] = useState<{ version: number; mensagem: string } | null>(null);
  const ultimoRef = useRef({ cabecalho, escolhas, resumo });
  ultimoRef.current = { cabecalho, escolhas, resumo };
  const emVooRef = useRef<Promise<void> | null>(null);
  const refazerRef = useRef(false);
  const conflitoRef = useRef(false);
  const encerradoRef = useRef(false);
  const avisoRef = useRef(onAviso);
  avisoRef.current = onAviso;

  const rodar = useCallback(async () => {
    do {
      refazerRef.current = false;
      const { cabecalho: c, escolhas: e, resumo: r } = ultimoRef.current;
      const comQuantidade = escolhasComQuantidade(e);
      if (Object.keys(comQuantidade).length === 0) {
        if (servidorRef.current) {
          await apagarRascunhoDaRequisicao(servidorRef.current.id);
          servidorRef.current = null;
        }
        setEstado("parado");
        continue;
      }
      setEstado("salvando");
      const conteudo: ConteudoDoRascunhoDaRequisicao = { cabecalho: c, escolhas: comQuantidade };
      const corpo = { conteudo, summary: r || null };
      if (!servidorRef.current) {
        const criado = await criarRascunhoDaRequisicao(corpo);
        servidorRef.current = { id: criado.id, version: criado.version };
      } else {
        try {
          const salvo = await salvarRascunhoDaRequisicao(servidorRef.current.id, { ...corpo, version: servidorRef.current.version });
          servidorRef.current = { id: salvo.id, version: salvo.version };
        } catch (falha) {
          if (falha instanceof ApiError && falha.status === 409) {
            conflitoRef.current = true;
            setConflito({ version: Number(falha.body?.version) || servidorRef.current.version, mensagem: falha.message });
            setEstado("conflito");
            return;
          }
          if (falha instanceof ApiError && falha.status === 404) {
            // Concluído ou descartado em outro aparelho: os itens continuam aqui e viram um rascunho novo.
            servidorRef.current = null;
            refazerRef.current = true;
            avisoRef.current("warning", "Este rascunho foi concluído ou descartado em outro aparelho. Seus itens continuam aqui e foram salvos como um rascunho novo.");
            continue;
          }
          throw falha;
        }
      }
      setEstado("salvo");
    } while (refazerRef.current);
  }, []);

  const sincronizar = useCallback((): Promise<void> => {
    if (encerradoRef.current || conflitoRef.current) return Promise.resolve();
    if (emVooRef.current) {
      refazerRef.current = true;
      return emVooRef.current;
    }
    const execucao = rodar()
      .catch(() => setEstado("falhou"))
      .finally(() => { emVooRef.current = null; });
    emVooRef.current = execucao;
    return execucao;
  }, [rodar]);

  // Alterou: espera a pessoa parar de digitar e espelha no servidor.
  useEffect(() => {
    if (pausado) return;
    const espera = setTimeout(() => { void sincronizar(); }, ESPERA_MS);
    return () => clearTimeout(espera);
  }, [cabecalho, escolhas, pausado, sincronizar]);

  // Sair da tela, trocar de aba ou o celular esconder o navegador: manda o que falta sem esperar.
  const pausadoRef = useRef(pausado);
  pausadoRef.current = pausado;
  useEffect(() => {
    const aoEsconder = () => { if (document.visibilityState === "hidden" && !pausadoRef.current) void sincronizar(); };
    document.addEventListener("visibilitychange", aoEsconder);
    return () => {
      document.removeEventListener("visibilitychange", aoEsconder);
      if (!pausadoRef.current) void sincronizar();
    };
  }, [sincronizar]);

  /** Antes de registrar: termina o que está salvando para saber se existe um rascunho a concluir. */
  const aguardar = useCallback(async () => { await emVooRef.current; }, []);

  /** Requisição registrada ou descartada: nenhum salvamento pendente pode recriar o rascunho. */
  const encerrar = useCallback(() => { encerradoRef.current = true; servidorRef.current = null; }, []);

  const descartar = useCallback(async () => {
    await emVooRef.current;
    const atual = servidorRef.current;
    encerradoRef.current = true;
    servidorRef.current = null;
    if (atual) await apagarRascunhoDaRequisicao(atual.id).catch(() => {});
    // A tela continua aberta para uma requisição nova: volta a salvar.
    encerradoRef.current = false;
    conflitoRef.current = false;
    setConflito(null);
    setEstado("parado");
  }, []);

  /** "Ver a versão mais recente": devolve o conteúdo do servidor para a tela adotar. */
  const usarDoServidor = useCallback(async () => {
    const atual = servidorRef.current;
    if (!atual) return null;
    const rascunho = await getRascunhoDaRequisicao(atual.id);
    servidorRef.current = { id: rascunho.id, version: rascunho.version };
    conflitoRef.current = false;
    setConflito(null);
    setEstado("salvo");
    return rascunho.conteudo;
  }, []);

  /** "Manter a minha": passa por cima da versão do outro aparelho. */
  const manterMinha = useCallback(() => {
    if (!servidorRef.current || !conflito) return;
    servidorRef.current = { ...servidorRef.current, version: conflito.version };
    conflitoRef.current = false;
    setConflito(null);
    void sincronizar();
  }, [conflito, sincronizar]);

  return { servidorRef, estado, conflito, aguardar, encerrar, descartar, usarDoServidor, manterMinha };
}
