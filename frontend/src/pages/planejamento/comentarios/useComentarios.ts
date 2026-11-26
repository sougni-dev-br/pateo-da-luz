import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apagarComentario, criarComentario, editarComentario, listarComentariosDoComparativo, type PlanejamentoComentario } from "../../../api/client";
import { mensagemHumana } from "../erros";
import { agruparPorPonto, type PontoDeComentario } from "./ponto";

// Comentários do ano comparado. Falha isolada: se só a lista falha, `erro` fica preenchido e o resto da tela segue.
// O estado é imutável; cada mutação devolve {ok} para o formulário decidir o que mostrar.

export type ResultadoDaMutacao = { ok: true } | { ok: false; mensagem: string };

const substituir = (lista: readonly PlanejamentoComentario[], novo: PlanejamentoComentario) => lista.map((c) => (c.id === novo.id ? novo : c));

export function useComentarios(anoBase: number, anoComparado: number, ativo: boolean) {
  const [comentarios, setComentarios] = useState<readonly PlanejamentoComentario[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!ativo) return undefined;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    listarComentariosDoComparativo(anoComparado)
      .then((lista) => { if (!cancelado) setComentarios(lista); })
      .catch((e: unknown) => { if (!cancelado) { setComentarios([]); setErro(mensagemHumana(e, "Não foi possível carregar os comentários.")); } })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [anoComparado, ativo, tentativa]);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);
  const porPonto = useMemo(() => agruparPorPonto(comentarios), [comentarios]);

  const executar = useCallback(async (acao: () => Promise<void>, padrao: string, aoConflito?: () => void): Promise<ResultadoDaMutacao> => {
    try {
      await acao();
      return { ok: true };
    } catch (e) {
      if (aoConflito && e instanceof ApiError && e.status === 409) aoConflito();
      return { ok: false, mensagem: mensagemHumana(e, padrao) };
    }
  }, []);

  const criar = useCallback((ponto: PontoDeComentario, texto: string, naImpressao: boolean) =>
    executar(async () => {
      const criado = await criarComentario({ anoBase, anoComparado, ...ponto, texto, naImpressao });
      setComentarios((atual) => [...atual, criado]);
    }, "Não foi possível salvar o comentário.", recarregar), [anoBase, anoComparado, executar, recarregar]);

  const editar = useCallback((comentario: PlanejamentoComentario, alteracao: { texto?: string; naImpressao?: boolean }) =>
    executar(async () => {
      const salvo = await editarComentario(comentario.id, { ...alteracao, atualizadoEm: comentario.atualizadoEm });
      setComentarios((atual) => substituir(atual, salvo));
    }, "Não foi possível salvar a alteração.", recarregar), [executar, recarregar]);

  const apagar = useCallback((comentario: PlanejamentoComentario) =>
    executar(async () => {
      await apagarComentario(comentario.id);
      setComentarios((atual) => atual.filter((c) => c.id !== comentario.id));
    }, "Não foi possível apagar o comentário.", recarregar), [executar, recarregar]);

  return { comentarios, porPonto, carregando, erro, recarregar, criar, editar, apagar };
}

export type ComentariosApi = ReturnType<typeof useComentarios>;
