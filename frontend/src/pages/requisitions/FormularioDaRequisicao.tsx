import { Printer, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createRequisition,
  getRequisitions,
  type AppUser,
  type CreateRequisitionPayload,
  type InventoryRequisition,
  type InventorySector,
  type RequisitionCatalogItem
} from "../../api/client";
import { Button } from "../../design-system";
import { lerNumero } from "../../lib/fichaTecnica";
import { hojeLocalIso } from "../../lib/datas";
import { CabecalhoCompacto, MOTIVOS, TURNOS } from "./CabecalhoCompacto";
import { useImpressaoDaRequisicao } from "./ImpressaoDaRequisicao";
import { FiltrosDoCatalogo, type OpcaoDeLocal } from "./FiltrosDoCatalogo";
import { LinhaDoCatalogo } from "./LinhaDoCatalogo";
import { SEM_LOCAL, contarPorLocal, escolhaInicial, escolhasComQuantidade, filtrarCatalogo, linhaDe, turnoPelaHora, type Escolha, type Escolhas, type Visao } from "./catalogo";
import { resumirLinhas, situacaoDaLinha } from "./linhas";
import { apagarRascunho, lerRascunho, salvarRascunho, type DadosDoCabecalho } from "./rascunho";
import { useCatalogo } from "./useCatalogo";

export { MOTIVOS, TURNOS };

export const cabecalhoVazio = (): DadosDoCabecalho => ({ date: hojeLocalIso(), shift: turnoPelaHora(), reason: "DAILY_PRODUCTION", reasonNotes: "", sectorId: "", notes: "" });

/** Requisição duplicada do histórico: o cabeçalho e o que foi retirado, para conferir e ajustar. */
export type ModeloInicial = { cabecalho: DadosDoCabecalho; escolhas: Escolhas };

type Props = {
  user: AppUser;
  sectors: InventorySector[];
  /** Requisição duplicada; sem ela, vale o rascunho guardado no aparelho. */
  modelo: ModeloInicial | null;
  onCriada: (criada: InventoryRequisition) => void;
  onAviso: (tom: "success" | "warning" | "error", mensagem: string) => void;
  /** Muda quando uma conversão é cadastrada: a lista de produtos busca as unidades novas. */
  catalogoVersao?: number;
  /** "+ unidade" na linha: abre as conversões com este produto. */
  onPedirUnidade?: (item: RequisitionCatalogItem) => void;
};

const quando = (instante: number) => new Date(instante).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function QuadroVazio({ visao, filtrando, onLimpar }: { visao: Visao; filtrando: boolean; onLimpar: () => void }) {
  if (visao === "ESCOLHIDOS") return <div className="rq-vazio"><strong>Nada escolhido ainda.</strong><p>Volte em Produtos e toque em + ou digite a quantidade.</p></div>;
  if (visao === "PROBLEMA") return <div className="rq-vazio"><strong>Nenhum problema.</strong><p>Todos os itens escolhidos têm saldo.</p></div>;
  return (
    <div className="rq-vazio">
      <strong>Nenhum produto com saldo encontrado.</strong>
      <p>Confira a escrita ou procure em outro local do estoque.</p>
      {filtrando && <Button variant="secondary" onClick={onLimpar}>Limpar filtros</Button>}
    </div>
  );
}

export function FormularioDaRequisicao({ user, sectors, modelo, onCriada, onAviso, catalogoVersao = 0, onPedirUnidade }: Props) {
  const guardado = useMemo(() => (modelo ? null : lerRascunho(user.id)), [modelo, user.id]);
  const catalogo = useCatalogo(user.id, catalogoVersao);
  const { imprimir, portal } = useImpressaoDaRequisicao();
  const [salvo, setSalvo] = useState(false);
  const [cabecalho, setCabecalho] = useState<DadosDoCabecalho>(modelo?.cabecalho ?? guardado?.cabecalho ?? cabecalhoVazio());
  const [escolhas, setEscolhas] = useState<Escolhas>(modelo?.escolhas ?? guardado?.escolhas ?? {});
  const [recuperadoEm, setRecuperadoEm] = useState<number | null>(guardado ? guardado.salvoEm : null);
  const [texto, setTexto] = useState("");
  const [localId, setLocalId] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>("TODOS");
  const [mostrarSemSaldo, setMostrarSemSaldo] = useState(false);
  const [congelados, setCongelados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const buscaRef = useRef<HTMLInputElement | null>(null);
  const listaRef = useRef<HTMLUListElement | null>(null);
  const idDoPedidoRef = useRef<string | null>(null);
  const guardarAoSairRef = useRef(true);

  const itens = catalogo.itens;
  const itemPorId = useMemo(() => new Map((itens ?? []).map((i) => [i.id, i])), [itens]);

  // Produto do rascunho que saiu do cadastro não pode ficar invisível dentro da requisição.
  useEffect(() => {
    if (!itens) return;
    const faltando = Object.keys(escolhas).filter((id) => !itemPorId.has(id));
    if (faltando.length === 0) return;
    setEscolhas((atuais) => Object.fromEntries(Object.entries(atuais).filter(([id]) => itemPorId.has(id))));
    onAviso("warning", `${faltando.length} ${faltando.length === 1 ? "produto do rascunho não existe" : "produtos do rascunho não existem"} mais no estoque e ${faltando.length === 1 ? "saiu" : "saíram"} da lista.`);
    // só roda quando o catálogo chega
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens]);

  // O rascunho acompanha cada mudança: perder 35 itens digitados por recarregar a página não pode acontecer.
  const ultimoRef = useRef({ cabecalho, escolhas });
  ultimoRef.current = { cabecalho, escolhas };
  const guardarAgora = useCallback(() => {
    if (!guardarAoSairRef.current) return;
    const { cabecalho: c, escolhas: e } = ultimoRef.current;
    salvarRascunho(user.id, { cabecalho: c, escolhas: escolhasComQuantidade(e) });
  }, [user.id]);

  useEffect(() => {
    if (enviando) return;
    setSalvo(false);
    const espera = setTimeout(() => {
      guardarAgora();
      setSalvo(true);
    }, 400);
    return () => clearTimeout(espera);
  }, [cabecalho, escolhas, enviando, guardarAgora]);

  // Trocar de aba, recarregar ou o celular descartar a aba antes dos 400 ms não pode perder a última digitação.
  useEffect(() => {
    const aoEsconder = () => {
      if (document.visibilityState === "hidden") guardarAgora();
    };
    document.addEventListener("visibilitychange", aoEsconder);
    window.addEventListener("pagehide", guardarAgora);
    return () => {
      document.removeEventListener("visibilitychange", aoEsconder);
      window.removeEventListener("pagehide", guardarAgora);
      guardarAgora();
    };
  }, [guardarAgora]);

  // "/" leva à busca, como nas telas de código: quem lança por teclado não precisa do mouse.
  useEffect(() => {
    const aoApertar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (e.key !== "/" || alvo?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      buscaRef.current?.focus();
    };
    document.addEventListener("keydown", aoApertar);
    return () => document.removeEventListener("keydown", aoApertar);
  }, []);

  // Escolha sem quantidade guarda só a unidade que a pessoa selecionou enquanto redigita: não conta nem é enviada.
  const linhas = useMemo(
    () => Object.entries(escolhasComQuantidade(escolhas)).flatMap(([id, escolha]) => {
      const item = itemPorId.get(id);
      return item ? [linhaDe(item, escolha)] : [];
    }),
    [escolhas, itemPorId]
  );
  const saldos = useMemo(() => new Map((itens ?? []).map((i) => [i.id, i.balance])), [itens]);
  const resumo = useMemo(() => resumirLinhas(linhas, saldos), [linhas, saldos]);
  const problemas = useMemo(() => {
    const invalidas = linhas.filter((l) => situacaoDaLinha(l, saldos.get(l.productId)).tipo === "VAZIA");
    return new Set([...resumo.semSaldo, ...resumo.semConversao, ...invalidas].map((l) => l.productId));
  }, [linhas, saldos, resumo]);
  const pronta = linhas.length > 0 && resumo.comQuantidade === linhas.length && problemas.size === 0;

  const filtro = useMemo(() => ({ texto, setorId: localId, visao, mostrarSemSaldo }), [texto, localId, visao, mostrarSemSaldo]);
  // Na visão "Com problema" a lista fica como estava ao abrir: corrigir uma quantidade não pode tirar a linha dos dedos.
  const visiveis = useMemo(
    () => (itens ? filtrarCatalogo(itens, escolhas, visao === "PROBLEMA" ? congelados : problemas, filtro) : []),
    [itens, escolhas, problemas, congelados, visao, filtro]
  );
  const escolherVisao = useCallback((proxima: Visao) => {
    if (proxima === "PROBLEMA") setCongelados(new Set(problemas));
    setVisao(proxima);
  }, [problemas]);
  const locais: OpcaoDeLocal[] = useMemo(() => {
    const contagem = contarPorLocal(itens ?? [], mostrarSemSaldo);
    const dosSetores = sectors.map((s) => ({ id: s.id, nome: s.name, total: contagem.get(s.id) ?? 0 }));
    const semLocal = { id: SEM_LOCAL, nome: "Sem local", total: contagem.get(SEM_LOCAL) ?? 0 };
    return [...dosSetores, semLocal].filter((l) => l.total > 0);
  }, [itens, sectors, mostrarSemSaldo]);
  const totalDeProdutos = useMemo(() => Array.from(contarPorLocal(itens ?? [], mostrarSemSaldo).values()).reduce((a, b) => a + b, 0), [itens, mostrarSemSaldo]);

  // Funções estáveis: a linha só renderiza de novo quando o próprio produto muda.
  const mudar = useCallback((item: RequisitionCatalogItem, parcial: Partial<Escolha>) => {
    setErro(null);
    setEscolhas((atuais) => {
      const proxima = { ...(atuais[item.id] ?? escolhaInicial(item, "")), ...parcial };
      return { ...atuais, [item.id]: proxima };
    });
  }, []);

  const tirar = useCallback((productId: string) => {
    setEscolhas((atuais) => {
      const { [productId]: _tirada, ...resto } = atuais;
      return resto;
    });
  }, []);

  const irParaProxima = useCallback((productId: string, direcao: 1 | -1) => {
    const campos = Array.from(listaRef.current?.querySelectorAll<HTMLInputElement>(".rq-qtd:not(:disabled)") ?? []);
    const atual = campos.findIndex((c) => c.closest<HTMLElement>(".rq-linha")?.dataset.produto === productId);
    const destino = campos[atual + direcao];
    if (destino) {
      destino.focus();
      destino.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  function imprimirLista() {
    const localDe = new Map(sectors.map((setor) => [setor.id, setor.name]));
    imprimir({
      codigo: null,
      data: cabecalho.date,
      turno: TURNOS[cabecalho.shift] ?? cabecalho.shift,
      setor: sectors.find((setor) => setor.id === cabecalho.sectorId)?.name ?? null,
      motivo: cabecalho.reason === "OTHER" && cabecalho.reasonNotes ? cabecalho.reasonNotes : MOTIVOS[cabecalho.reason] ?? cabecalho.reason,
      observacoes: cabecalho.notes || null,
      responsavel: user.name,
      itens: linhas.map((linha) => ({
        codigo: linha.productCode,
        nome: linha.productName,
        quantidade: lerNumero(linha.quantity),
        unidade: linha.unit,
        local: localDe.get(itemPorId.get(linha.productId)?.sectorId ?? "") ?? null
      }))
    });
  }

  function limparFiltros() {
    setTexto("");
    setLocalId(null);
    setVisao("TODOS");
  }

  function descartar() {
    if (linhas.length > 0 && !window.confirm(`Descartar a requisição com ${linhas.length} ${linhas.length === 1 ? "item" : "itens"}?`)) return;
    guardarAoSairRef.current = true;
    apagarRascunho(user.id);
    setCabecalho(cabecalhoVazio());
    setEscolhas({});
    setRecuperadoEm(null);
    setErro(null);
    limparFiltros();
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
      guardarAoSairRef.current = false;
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
            guardarAoSairRef.current = false;
            apagarRascunho(user.id);
            idDoPedidoRef.current = null;
            onCriada(achadas[0]);
            return;
          }
        } catch {
          // segue para a mensagem abaixo: a lista continua intacta para tentar de novo
        }
        setErro("Não recebi a resposta do servidor e a requisição não aparece registrada. Seus itens continuam aqui: toque em Registrar para tentar de novo.");
      } else {
        setErro(mensagemDoServidor(falha));
      }
    } finally {
      setEnviando(false);
    }
  }

  const filtrando = texto.trim() !== "" || localId !== null || visao !== "TODOS";

  return (
    <div className="rq">
      {recuperadoEm != null && (
        <div className="req-banner is-info" role="status">
          <span>Rascunho recuperado{recuperadoEm ? ` (salvo em ${quando(recuperadoEm)})` : ""}. Nada se perde se você sair desta tela.</span>
          <button type="button" onClick={() => setRecuperadoEm(null)} aria-label="Fechar aviso"><X size={14} /></button>
        </div>
      )}

      <CabecalhoCompacto valor={cabecalho} setores={sectors} onMudar={setCabecalho} />

      <section className="rq-bloco" aria-label="Produtos">
        <FiltrosDoCatalogo
          ref={buscaRef}
          texto={texto}
          onTexto={setTexto}
          locais={locais}
          localId={localId}
          onLocal={setLocalId}
          visao={visao}
          onVisao={escolherVisao}
          totalDeProdutos={totalDeProdutos}
          escolhidos={linhas.length}
          comProblema={problemas.size}
          mostrarSemSaldo={mostrarSemSaldo}
          onMostrarSemSaldo={setMostrarSemSaldo}
        />

        {catalogo.desatualizadaDesde != null && (
          <div className="req-banner is-aviso" role="status">
            <span>Sem conexão com o servidor: usando a lista guardada às {quando(catalogo.desatualizadaDesde)}. Os saldos podem estar desatualizados; o servidor confere de novo ao registrar.</span>
            <Button variant="secondary" onClick={catalogo.recarregar}>Atualizar</Button>
          </div>
        )}

        {visao === "ESCOLHIDOS" && linhas.length > 0 && (
          <div className="rq-ferramentas">
            <span>{linhas.length} {linhas.length === 1 ? "produto escolhido" : "produtos escolhidos"}</span>
            <Button variant="secondary" leadingIcon={<Printer size={14} />} onClick={imprimirLista}>Imprimir lista</Button>
          </div>
        )}

        {catalogo.falhou && (
          <div className="req-banner is-erro" role="alert">
            <span>Não consegui carregar os produtos do estoque.</span>
            <Button variant="secondary" onClick={catalogo.recarregar}>Tentar de novo</Button>
          </div>
        )}

        {itens == null && !catalogo.falhou && (
          <ul className="rq-lista rq-esqueleto" aria-busy="true" aria-label="Carregando produtos">
            {Array.from({ length: 7 }, (_, i) => <li key={i} className="rq-linha" />)}
          </ul>
        )}

        {itens != null && (
          visiveis.length > 0 ? (
            <ul className="rq-lista" ref={listaRef}>
              {visiveis.map((item) => (
                <LinhaDoCatalogo key={item.id} item={item} escolha={escolhas[item.id]} onMudar={mudar} onTirar={tirar} onProxima={irParaProxima} onPedirUnidade={onPedirUnidade} />
              ))}
            </ul>
          ) : (
            <QuadroVazio visao={visao} filtrando={filtrando} onLimpar={limparFiltros} />
          )
        )}
      </section>

      {erro && <div className="req-banner is-erro" role="alert"><span>{erro}</span></div>}

      <div className="rq-barra">
        <div className="rq-barra-resumo" aria-live="polite">
          <strong>{linhas.length} {linhas.length === 1 ? "produto" : "produtos"}</strong>
          {linhas.length === 0 ? (
            <span>Toque em + para escolher.</span>
          ) : problemas.size > 0 ? (
            <button type="button" className="rq-barra-problema" onClick={() => escolherVisao("PROBLEMA")}>{problemas.size} com problema — ver</button>
          ) : (
            <span>pronto para registrar{salvo ? " · rascunho salvo" : ""}</span>
          )}
        </div>
        <Button variant="secondary" leadingIcon={<Trash2 size={16} />} aria-label="Limpar requisição" onClick={descartar} disabled={enviando || linhas.length === 0}><span className="rq-limpar-texto">Limpar</span></Button>
        <Button variant="primary" onClick={registrar} disabled={!pronta || enviando}>{enviando ? "Registrando…" : "Registrar"}</Button>
      </div>
      {portal}
    </div>
  );
}

/** Mensagem do servidor com o que importa: quais produtos faltam e quanto. */
function mensagemDoServidor(falha: unknown): string {
  if (!(falha instanceof ApiError)) return falha instanceof Error ? falha.message : "Erro ao registrar a requisição.";
  const produtos = Array.isArray(falha.body?.products) ? (falha.body.products as Array<{ productName: string; requested: number; available: number; unit: string | null }>) : [];
  const detalhes = produtos.map((p) => `${p.productName}: pediu ${p.requested} ${p.unit ?? ""}, saldo ${p.available}`.trim());
  return detalhes.length > 0 ? `${falha.message} ${detalhes.join("; ")}.` : falha.message;
}
