import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Layers, ListChecks, Search } from "lucide-react";
import type { CreditCardFinal, CreditCardStatementDetail } from "../../api/client";
import { Money } from "../../design-system";
import {
  buscarLinhas,
  ordenarLinhas,
  rotuloDoFinal,
  tipoDoFinal,
  transicaoDeSelecao
} from "./cartoes-vinculados";
import { ConciliarExtrato } from "./ConciliarExtrato";
import { ListaDoCartao, type AcoesDaLinha } from "./ListaDoCartao";
import "./cards-finais.css";

type Props = {
  detalhe: CreditCardStatementDetail;
  podeEditar: boolean;
  /** Define o cartão de uma ou mais linhas (null = voltar para "não definido"). Devolve false se falhou. */
  onClassificar: (itemIds: string[], cardFinalId: string | null) => Promise<boolean>;
  /** Grava o total que o extrato traz para um cartão ("" apaga). */
  onTotalDoExtrato: (cardFinalId: string, valor: string) => Promise<boolean>;
  /** Marca várias linhas como conferidas (conciliação com o extrato colado). */
  onConferirLinhas: (itemIds: string[]) => Promise<void>;
  acoes: AcoesDaLinha;
};

function totalDeclarado(detalhe: CreditCardStatementDetail, cardFinalId: string): string {
  const achado = detalhe.finalTotals?.find((t) => t.cardFinalId === cardFinalId);
  return achado ? Number(achado.statedAmount).toFixed(2).replace(".", ",") : "";
}

export function FaturaPorCartao({ detalhe, podeEditar, onClassificar, onTotalDoExtrato, onConferirLinhas, acoes }: Props) {
  const finais: CreditCardFinal[] = (detalhe.creditCard.finais ?? []).filter((final) => final.isActive);
  const temFinais = finais.length > 0;
  // Cartão inativado que já teve compras continua tendo a sua lista: senão as linhas dele somem da
  // tela, mas seguem no total e no bloqueio por extrato.
  const finaisInativosComLinhas = (detalhe.creditCard.finais ?? []).filter(
    (final) => !final.isActive && detalhe.items.some((linha) => linha.cardFinalId === final.id)
  );
  const [selecionadas, setSelecionadas] = useState<ReadonlySet<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const [gravadoId, setGravadoId] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<"data" | "valor">("data");
  const [conciliando, setConciliando] = useState(false);
  const statusEditavel = ["OPEN", "CHECKED"].includes(detalhe.status);
  const editavel = podeEditar && statusEditavel;

  const visiveis = useMemo(() => buscarLinhas(detalhe.items, busca), [detalhe.items, busca]);
  const listaDe = (cardFinalId: string | null) =>
    ordenarLinhas(visiveis.filter((linha) => (linha.cardFinalId ?? null) === cardFinalId), ordem);
  const visiveisIds = visiveis.map((linha) => linha.id);
  const semCartao = detalhe.items.filter((linha) => !linha.cardFinalId).length;
  const subtotais = detalhe.subtotaisPorCartao ?? [];
  const divergentes = new Map((detalhe.divergenciasPorCartao ?? []).map((d) => [d.cardFinalId, d]));
  const totalGeral = Number(detalhe.totalAmount ?? 0) || 1;

  // Trocar de fatura nunca deixa busca ou seleção da anterior.
  useEffect(() => {
    setSelecionadas(new Set());
    setBusca("");
    setRascunhos({});
  }, [detalhe.id]);
  useEffect(() => {
    const ids = new Set(detalhe.items.map((linha) => linha.id));
    setSelecionadas((atual) => new Set([...atual].filter((id) => ids.has(id))));
  }, [detalhe.items]);

  async function classificar(ids: string[], cardFinalId: string | null) {
    // Só as linhas que estão à vista: uma seleção escondida pela busca não vai junto.
    const aVista = new Set(visiveisIds);
    const alvo = ids.filter((id) => aVista.has(id));
    if (alvo.length === 0 || ocupado) return;
    setOcupado(true);
    try {
      // Se falhou, a seleção fica: o dono não perde o trabalho de marcar várias linhas.
      if (await onClassificar(alvo, cardFinalId)) setSelecionadas(new Set());
    } finally {
      setOcupado(false);
    }
  }

  function gravarExtrato(final: CreditCardFinal) {
    const declarado = totalDeclarado(detalhe, final.id);
    const rascunho = rascunhos[final.id] ?? declarado;
    if (rascunho === declarado) return;
    void onTotalDoExtrato(final.id, rascunho).then((gravou) => {
      if (!gravou) return;
      setGravadoId(final.id);
      window.setTimeout(() => setGravadoId((atual) => (atual === final.id ? null : atual)), 2500);
    });
  }

  function irPara(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const propsComuns = {
    finais,
    editavel,
    podeEditar,
    statusEditavel,
    selecionadas,
    ocupado,
    onSelecionar: (ids: string[], marcar: boolean) => setSelecionadas(transicaoDeSelecao(selecionadas, ids, marcar)),
    onClassificar: (ids: string[], cardFinalId: string | null) => void classificar(ids, cardFinalId),
    acoes
  };

  return (
    <div className="fatura-cartoes">
      <div className="fatura-barra">
        <label className="fatura-busca">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={busca}
            placeholder="Buscar por descrição, fornecedor ou valor"
            aria-label="Buscar lançamentos da fatura"
            onChange={(event) => setBusca(event.target.value)}
          />
        </label>
        <select value={ordem} aria-label="Ordenar lançamentos" onChange={(event) => setOrdem(event.target.value as "data" | "valor")}>
          <option value="data">Mais recentes primeiro</option>
          <option value="valor">Maior valor primeiro</option>
        </select>
        {editavel && (
          <button type="button" className={`fatura-conciliar-botao${conciliando ? " ativo" : ""}`} onClick={() => setConciliando(!conciliando)}>
            <ListChecks size={15} /> Conciliar com o extrato
          </button>
        )}
      </div>

      {conciliando && editavel && (
        <ConciliarExtrato
          itens={detalhe.items}
          onConferir={async (ids) => {
            await onConferirLinhas(ids);
          }}
          onFechar={() => setConciliando(false)}
        />
      )}

      {temFinais && editavel && selecionadas.size > 0 && (
        <div className="fatura-cartoes-lote" role="region" aria-label="Ação em lote">
          <strong>{selecionadas.size} selecionado(s)</strong>
          {finais.map((final) => (
            <button key={final.id} type="button" disabled={ocupado} onClick={() => void classificar([...selecionadas], final.id)}>
              Passar para {rotuloDoFinal(final)}
            </button>
          ))}
          <button type="button" disabled={ocupado} onClick={() => void classificar([...selecionadas], null)}>Sem cartão definido</button>
          <button type="button" className="limpar" onClick={() => setSelecionadas(new Set())}>Limpar</button>
        </div>
      )}

      {temFinais ? (
        <>
          <nav className="fatura-resumo-nav" aria-label="Ir para a lista">
            {finais.map((final) => (
              <button key={final.id} type="button" onClick={() => irPara(`lista-${final.id}`)}>
                <span>{tipoDoFinal(final.kind)}</span>
                <strong><Money value={subtotais.find((s) => s.cardFinalId === final.id)?.total ?? 0} /></strong>
              </button>
            ))}
            {semCartao > 0 && (
              <button type="button" className="pendente" onClick={() => irPara("lista-sem-cartao")}>
                <span>Sem cartão</span>
                <strong><Money value={subtotais.find((s) => s.cardFinalId === null)?.total ?? 0} /></strong>
              </button>
            )}
          </nav>

          {semCartao > 0 && (
            <div className="fatura-aviso-sem-cartao" role="status">
              <AlertTriangle size={15} aria-hidden />
              <span>
                <strong>{semCartao}</strong> {semCartao === 1 ? "lançamento ainda sem cartão definido" : "lançamentos ainda sem cartão definido"}.
                Escolha o cartão de cada um na lista abaixo, ou selecione vários para passar de uma vez.
              </span>
            </div>
          )}

          {semCartao > 0 && (
            <ListaDoCartao
              {...propsComuns}
              final={null}
              linhas={listaDe(null)}
              subtotal={subtotais.find((s) => s.cardFinalId === null)}
              parte={0}
              declarado=""
              gravado={false}
              rascunho=""
              onRascunho={() => undefined}
              onGravarExtrato={() => undefined}
            />
          )}

          <div className="fatura-listas">
            {[...finais, ...finaisInativosComLinhas].map((final) => {
              const subtotal = subtotais.find((s) => s.cardFinalId === final.id);
              const declarado = totalDeclarado(detalhe, final.id);
              return (
                <ListaDoCartao
                  key={final.id}
                  {...propsComuns}
                  final={final}
                  linhas={listaDe(final.id)}
                  subtotal={subtotal}
                  parte={Math.round(((subtotal?.total ?? 0) / totalGeral) * 100)}
                  declarado={declarado}
                  divergencia={divergentes.get(final.id)}
                  gravado={gravadoId === final.id}
                  rascunho={rascunhos[final.id] ?? declarado}
                  onRascunho={(valor) => setRascunhos({ ...rascunhos, [final.id]: valor })}
                  onGravarExtrato={() => gravarExtrato(final)}
                />
              );
            })}
          </div>
        </>
      ) : (
        <>
          <ListaDoCartao
            {...propsComuns}
            final={null}
            linhas={ordenarLinhas(visiveis, ordem)}
            subtotal={subtotais.find((s) => s.cardFinalId === null) ?? { cardFinalId: null, itens: detalhe.items.length, total: Number(detalhe.totalAmount ?? 0) }}
            parte={0}
            declarado=""
            gravado={false}
            rascunho=""
            onRascunho={() => undefined}
            onGravarExtrato={() => undefined}
            semFinais
          />
          {podeEditar && (
            <p className="text-muted fatura-cartoes-dica">
              <Layers size={14} /> A fatura traz mais de um cartão (físico e virtual)? Cadastre os finais em
              “Editar” no cartão para separar as compras de cada um e conferir o subtotal.
            </p>
          )}
        </>
      )}
    </div>
  );
}
