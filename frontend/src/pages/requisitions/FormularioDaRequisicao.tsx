import { RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createRequisition,
  getRequisitions,
  type AppUser,
  type CreateRequisitionPayload,
  type InventoryRequisition,
  type InventorySector,
  type RequisitionProductHit
} from "../../api/client";
import { Button } from "../../design-system";
import { lerNumero, normalizarUnidade } from "../../lib/fichaTecnica";
import { hojeLocalIso } from "../../lib/datas";
import { BuscaDeProduto } from "./BuscaDeProduto";
import { LinhaDoItem } from "./LinhaDoItem";
import { resumirLinhas, type LinhaDaRequisicao } from "./linhas";
import { apagarRascunho, lerRascunho, salvarRascunho, type DadosDoCabecalho, type Rascunho } from "./rascunho";

export const TURNOS: Record<string, string> = { MORNING: "Manhã", AFTERNOON: "Tarde", NIGHT: "Noite" };
export const MOTIVOS: Record<string, string> = { DAILY_PRODUCTION: "Produção do dia", PREP: "Pré-preparo", EVENT: "Evento", OTHER: "Outro" };

export const cabecalhoVazio = (): DadosDoCabecalho => ({ date: hojeLocalIso(), shift: "MORNING", reason: "DAILY_PRODUCTION", reasonNotes: "", sectorId: "", notes: "" });

export type ModeloInicial = Pick<Rascunho, "cabecalho" | "linhas">;

type Props = {
  user: AppUser;
  sectors: InventorySector[];
  /** null enquanto os saldos não carregaram: sem saldo não dá para dizer que falta. */
  saldos: Map<string, number> | null;
  /** Requisição duplicada do histórico; sem ela, vale o rascunho guardado no aparelho. */
  modelo: ModeloInicial | null;
  onCriada: (criada: InventoryRequisition) => void;
  onAviso: (tom: "success" | "warning" | "error", mensagem: string) => void;
};

type ErroDoServidor = { mensagem: string };

const linhaDoProduto = (produto: RequisitionProductHit): LinhaDaRequisicao => ({
  productId: produto.id,
  productName: produto.name,
  productCode: produto.code,
  stockUnit: produto.unit,
  conversions: produto.conversions,
  unit: normalizarUnidade(produto.unit) || "UN",
  quantity: ""
});

const quando = (instante: number) => new Date(instante).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function FormularioDaRequisicao({ user, sectors, saldos, modelo, onCriada, onAviso }: Props) {
  const guardado = useMemo(() => (modelo ? null : lerRascunho(user.id)), [modelo, user.id]);
  const [cabecalho, setCabecalho] = useState<DadosDoCabecalho>(modelo?.cabecalho ?? guardado?.cabecalho ?? cabecalhoVazio());
  const [linhas, setLinhas] = useState<LinhaDaRequisicao[]>(modelo?.linhas ?? guardado?.linhas ?? []);
  const [deFora, setDeFora] = useState<LinhaDaRequisicao[]>(guardado?.deFora ?? []);
  const [recuperadoEm, setRecuperadoEm] = useState<number | null>(guardado ? guardado.salvoEm : null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroDoServidor | null>(null);
  const buscaRef = useRef<HTMLInputElement | null>(null);
  const idDoPedidoRef = useRef<string | null>(null);

  // O rascunho acompanha cada mudança: perder 35 itens digitados por recarregar a página não pode acontecer.
  useEffect(() => {
    if (enviando) return;
    const espera = setTimeout(() => salvarRascunho(user.id, { cabecalho, linhas, deFora }), 400);
    return () => clearTimeout(espera);
  }, [user.id, cabecalho, linhas, deFora, enviando]);

  useEffect(() => {
    if (linhas.length === 0) buscaRef.current?.focus();
  }, [linhas.length]);

  const resumo = useMemo(() => resumirLinhas(linhas, saldos ?? new Map(linhas.map((l) => [l.productId, Number.POSITIVE_INFINITY]))), [linhas, saldos]);
  const saldoDe = (id: string) => (saldos ? saldos.get(id) : null);
  const pronta = linhas.length > 0 && resumo.comQuantidade === linhas.length && resumo.semSaldo.length === 0 && resumo.semConversao.length === 0;

  const mudarLinha = (productId: string, parcial: Partial<LinhaDaRequisicao>) => {
    setErro(null);
    setLinhas((atuais) => atuais.map((l) => (l.productId === productId ? { ...l, ...parcial } : l)));
  };

  function adicionar(produto: RequisitionProductHit) {
    if (linhas.some((l) => l.productId === produto.id)) {
      onAviso("warning", `${produto.name} já está na lista.`);
      return;
    }
    setLinhas((atuais) => [...atuais, linhaDoProduto(produto)]);
    setDeFora((atuais) => atuais.filter((l) => l.productId !== produto.id));
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-produto="${produto.id}"] .req-qty-input`)?.focus(), 60);
  }

  function irParaProxima(productId: string) {
    const campos = Array.from(document.querySelectorAll<HTMLInputElement>(".req-item .req-qty-input"));
    const atual = campos.findIndex((c) => c.closest<HTMLElement>(".req-item")?.dataset.produto === productId);
    (campos[atual + 1] ?? buscaRef.current)?.focus();
  }

  function tirarSemSaldo() {
    const ids = new Set(resumo.semSaldo.map((l) => l.productId));
    setDeFora((atuais) => [...atuais, ...linhas.filter((l) => ids.has(l.productId))]);
    setLinhas((atuais) => atuais.filter((l) => !ids.has(l.productId)));
    setErro(null);
  }

  function limpar() {
    if (linhas.length > 0 && !window.confirm(`Descartar a requisição com ${linhas.length} ${linhas.length === 1 ? "item" : "itens"}?`)) return;
    apagarRascunho(user.id);
    setCabecalho(cabecalhoVazio());
    setLinhas([]);
    setDeFora([]);
    setRecuperadoEm(null);
    setErro(null);
    idDoPedidoRef.current = null;
  }

  async function registrar() {
    if (!pronta || enviando) return;
    if (!idDoPedidoRef.current) idDoPedidoRef.current = crypto.randomUUID();
    const clientRequestId = idDoPedidoRef.current;
    const payload: CreateRequisitionPayload = {
      clientRequestId,
      date: cabecalho.date,
      shift: cabecalho.shift,
      reason: cabecalho.reason,
      reasonNotes: cabecalho.reasonNotes || null,
      sectorId: cabecalho.sectorId || null,
      notes: cabecalho.notes || null,
      items: linhas.map((l) => ({ productId: l.productId, quantity: lerNumero(l.quantity), unit: l.unit }))
    };

    setEnviando(true);
    setErro(null);
    try {
      const criada = await createRequisition(payload);
      apagarRascunho(user.id);
      idDoPedidoRef.current = null;
      onCriada(criada);
    } catch (falha) {
      if (falha instanceof DOMException && falha.name === "AbortError") {
        // Sem resposta a tempo: a requisição pode ter sido gravada. Confere pelo identificador antes de mandar de novo.
        onAviso("warning", "Conferindo se a requisição foi registrada…");
        try {
          const achadas = await getRequisitions({ clientRequestId });
          if (achadas.length > 0) {
            apagarRascunho(user.id);
            idDoPedidoRef.current = null;
            onCriada(achadas[0]);
            return;
          }
        } catch {
          // segue para a mensagem abaixo: a lista continua intacta para tentar de novo
        }
        setErro({ mensagem: "Não recebi a resposta do servidor e a requisição não aparece registrada. Seus itens continuam aqui: toque em Registrar para tentar de novo." });
      } else {
        setErro(erroDoServidor(falha));
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="req-form">
      {recuperadoEm != null && (
        <div className="req-banner is-info" role="status">
          <span>Rascunho recuperado{recuperadoEm ? ` (salvo em ${quando(recuperadoEm)})` : ""}. Nada se perde se você sair desta tela.</span>
          <button type="button" onClick={() => setRecuperadoEm(null)} aria-label="Fechar aviso"><X size={14} /></button>
        </div>
      )}

      <section className="req-bloco" aria-labelledby="req-dados">
        <h3 id="req-dados" className="req-section-title">Dados da requisição</h3>
        <div className="req-meta-fields">
          <label className="req-field"><span>Data</span>
            <input type="date" value={cabecalho.date} max={hojeLocalIso()} onChange={(e) => setCabecalho({ ...cabecalho, date: e.target.value })} />
          </label>
          <label className="req-field"><span>Turno</span>
            <select value={cabecalho.shift} onChange={(e) => setCabecalho({ ...cabecalho, shift: e.target.value })}>
              {Object.entries(TURNOS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </label>
          <label className="req-field"><span>Setor</span>
            <select value={cabecalho.sectorId} onChange={(e) => setCabecalho({ ...cabecalho, sectorId: e.target.value })}>
              <option value="">Todos os setores</option>
              {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="req-field"><span>Motivo</span>
            <select value={cabecalho.reason} onChange={(e) => setCabecalho({ ...cabecalho, reason: e.target.value })}>
              {Object.entries(MOTIVOS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </label>
          {cabecalho.reason === "OTHER" && (
            <label className="req-field req-field-wide"><span>Especificar motivo</span>
              <input value={cabecalho.reasonNotes} placeholder="Descreva o motivo" onChange={(e) => setCabecalho({ ...cabecalho, reasonNotes: e.target.value })} />
            </label>
          )}
          <label className="req-field req-field-wide"><span>Observações</span>
            <input value={cabecalho.notes} placeholder="Opcional" onChange={(e) => setCabecalho({ ...cabecalho, notes: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="req-bloco" aria-labelledby="req-itens">
        <h3 id="req-itens" className="req-section-title">
          Itens retirados
          {linhas.length > 0 && <span className="req-item-count">{linhas.length}</span>}
        </h3>

        <BuscaDeProduto ref={buscaRef} jaNaLista={new Set(linhas.map((l) => l.productId))} saldos={saldos} onEscolher={adicionar} />

        {saldos == null && (
          <div className="req-banner is-aviso" role="status">Os saldos ainda não carregaram. Você pode montar a lista; a conferência de saldo é feita ao registrar.</div>
        )}

        {linhas.length > 0 ? (
          <ul className="req-itens">
            {linhas.map((linha) => (
              <LinhaDoItem
                key={linha.productId}
                linha={linha}
                saldo={saldoDe(linha.productId)}
                onQuantidade={(id, quantity) => mudarLinha(id, { quantity })}
                onUnidade={(id, unit) => mudarLinha(id, { unit })}
                onRemover={(id) => setLinhas((atuais) => atuais.filter((l) => l.productId !== id))}
                onEnter={irParaProxima}
              />
            ))}
          </ul>
        ) : (
          <div className="req-items-empty">
            <p><strong>Nenhum item ainda.</strong></p>
            <p>Busque um produto acima. A unidade pode ser trocada em cada linha (g, kg, ml, l ou a embalagem).</p>
          </div>
        )}

        {resumo.semSaldo.length > 0 && (
          <div className="req-banner is-erro" role="alert">
            <span>
              <strong>{resumo.semSaldo.length} {resumo.semSaldo.length === 1 ? "item não tem" : "itens não têm"} saldo</strong> para a quantidade pedida:{" "}
              {resumo.semSaldo.map((l) => l.productName).join(", ")}. O servidor recusa a requisição inteira se um deles ficar.
            </span>
            <Button variant="secondary" onClick={tirarSemSaldo}>Tirar da requisição</Button>
          </div>
        )}

        {deFora.length > 0 && (
          <details className="req-de-fora">
            <summary>{deFora.length} {deFora.length === 1 ? "item ficou" : "itens ficaram"} de fora por falta de saldo</summary>
            <ul>
              {deFora.map((l) => (
                <li key={l.productId}>
                  <span>{l.productName} — {l.quantity} {l.unit}</span>
                  <button type="button" onClick={() => { setLinhas((a) => [...a, l]); setDeFora((a) => a.filter((x) => x.productId !== l.productId)); }}>
                    <RotateCcw size={13} /> voltar
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}

        {erro && (
          <div className="req-banner is-erro" role="alert">
            <span>{erro.mensagem}</span>
          </div>
        )}
      </section>

      <div className="req-action-bar">
        <p className="req-action-resumo" aria-live="polite">
          {linhas.length === 0
            ? "Adicione itens para registrar."
            : pronta
              ? `${linhas.length} ${linhas.length === 1 ? "item pronto" : "itens prontos"} para registrar`
              : [
                  resumo.semQuantidade > 0 && `${resumo.semQuantidade} sem quantidade`,
                  resumo.semSaldo.length > 0 && `${resumo.semSaldo.length} sem saldo`,
                  resumo.semConversao.length > 0 && `${resumo.semConversao.length} com unidade que não converte`
                ].filter(Boolean).join(" · ")}
        </p>
        <Button variant="secondary" leadingIcon={<X size={14} />} onClick={limpar} disabled={enviando || (linhas.length === 0 && deFora.length === 0)}>Limpar</Button>
        <Button variant="primary" onClick={registrar} disabled={!pronta || enviando}>{enviando ? "Registrando…" : "Registrar requisição"}</Button>
      </div>
    </div>
  );
}

/** Mensagem do servidor com o que importa: quais produtos faltam e quanto. */
function erroDoServidor(falha: unknown): ErroDoServidor {
  if (!(falha instanceof ApiError)) {
    return { mensagem: falha instanceof Error ? falha.message : "Erro ao registrar a requisição." };
  }
  const produtos = Array.isArray(falha.body?.products) ? (falha.body.products as Array<{ productName: string; requested: number; available: number; unit: string | null }>) : [];
  const detalhes = produtos.map((p) => `${p.productName}: pediu ${p.requested} ${p.unit ?? ""}, saldo ${p.available}`.trim());
  return { mensagem: detalhes.length > 0 ? `${falha.message} ${detalhes.join("; ")}.` : falha.message };
}
