import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apagarComentario, criarComentario, editarComentario, listarComentariosDoComparativo, restaurarComentario, type PlanejamentoComentario } from "../../../api/client";
import { mensagemHumana } from "../erros";
import { agruparPorPonto, ordenarComoOServidor, type PontoDeComentario } from "./ponto";
import { useLixeira } from "./useLixeira";

// Comentários do ano comparado. Falha isolada: se só a lista falha, `erro` fica preenchido e o resto da tela segue.
// O estado é imutável; cada mutação devolve {ok} para o formulário decidir o que mostrar. Apagar manda para a lixeira
// e deixa `apagadoRecente` para o aviso com "Desfazer".

export type ResultadoDaMutacao = { ok: true } | { ok: false; mensagem: string };

const substituir = (lista: readonly PlanejamentoComentario[], novo: PlanejamentoComentario) => lista.map((c) => (c.id === novo.id ? novo : c));
const inserir = (lista: readonly PlanejamentoComentario[], novo: PlanejamentoComentario) => ordenarComoOServidor([...lista.filter((c) => c.id !== novo.id), novo]);

async function executar(acao: () => Promise<void>, padrao: string, aoConflito?: () => void): Promise<ResultadoDaMutacao> {
  try {
    await acao();
    return { ok: true };
  } catch (e) {
    if (aoConflito && e instanceof ApiError && e.status === 409) aoConflito();
    return { ok: false, mensagem: mensagemHumana(e, padrao) };
  }
}

function useListaDoAno(anoComparado: number, ativo: boolean) {
  const [comentarios, setComentarios] = useState<readonly PlanejamentoComentario[]>([]);
  const [podeModerar, setPodeModerar] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!ativo) return undefined;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    listarComentariosDoComparativo(anoComparado)
      .then((r) => { if (!cancelado) { setComentarios(r.comentarios); setPodeModerar(r.podeModerar); } })
      .catch((e: unknown) => { if (!cancelado) { setComentarios([]); setErro(mensagemHumana(e, "Não foi possível carregar os comentários.")); } })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [anoComparado, ativo, tentativa]);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);
  return { comentarios, setComentarios, podeModerar, carregando, erro, recarregar };
}

export function useComentarios(anoBase: number, anoComparado: number, ativo: boolean) {
  const { comentarios, setComentarios, podeModerar, carregando, erro, recarregar } = useListaDoAno(anoComparado, ativo);
  const lixeira = useLixeira(anoComparado, ativo && podeModerar);
  const { recarregar: recarregarLixeira, remover: removerDaLixeira } = lixeira;
  const [apagadoRecente, setApagadoRecente] = useState<PlanejamentoComentario | null>(null);
  const porPonto = useMemo(() => agruparPorPonto(comentarios), [comentarios]);

  const criar = useCallback((ponto: PontoDeComentario, texto: string, naImpressao: boolean) =>
    executar(async () => {
      const criado = await criarComentario({ anoBase, anoComparado, ...ponto, texto, naImpressao });
      setComentarios((atual) => [...atual, criado]);
    }, "Não foi possível salvar o comentário.", recarregar), [anoBase, anoComparado, recarregar, setComentarios]);

  const editar = useCallback((comentario: PlanejamentoComentario, alteracao: { texto?: string; naImpressao?: boolean }) =>
    executar(async () => {
      const salvo = await editarComentario(comentario.id, { ...alteracao, atualizadoEm: comentario.atualizadoEm });
      setComentarios((atual) => substituir(atual, salvo));
    }, "Não foi possível salvar a alteração.", recarregar), [recarregar, setComentarios]);

  const apagar = useCallback((comentario: PlanejamentoComentario) =>
    executar(async () => {
      await apagarComentario(comentario.id);
      setComentarios((atual) => atual.filter((c) => c.id !== comentario.id));
      setApagadoRecente(comentario);
      if (podeModerar) recarregarLixeira();
    }, "Não foi possível apagar o comentário.", recarregar), [podeModerar, recarregar, recarregarLixeira, setComentarios]);

  const restaurar = useCallback((comentario: PlanejamentoComentario) =>
    executar(async () => {
      const devolvido = await restaurarComentario(comentario.id);
      setComentarios((atual) => inserir(atual, devolvido));
      removerDaLixeira(comentario.id);
      setApagadoRecente((recente) => (recente?.id === comentario.id ? null : recente));
    }, "Não foi possível restaurar o comentário.", recarregar), [recarregar, removerDaLixeira, setComentarios]);

  const desfazer = useCallback(() => (apagadoRecente ? restaurar(apagadoRecente) : Promise.resolve<ResultadoDaMutacao>({ ok: true })), [apagadoRecente, restaurar]);
  const descartarAviso = useCallback(() => setApagadoRecente(null), []);

  return { comentarios, porPonto, carregando, erro, recarregar, criar, editar, apagar, podeModerar, lixeira, apagadoRecente, desfazer, descartarAviso, restaurar };
}

export type ComentariosApi = ReturnType<typeof useComentarios>;
