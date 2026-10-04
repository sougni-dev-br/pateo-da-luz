import { Copy, Printer, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  deleteBuffetPlateList, getBuffetPlateList, saveBuffetPlateList,
  type BuffetPlateItem, type BuffetPlateListSummary, type PlateFormat, type PlateListKind, type PlateTheme,
} from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { useNavigationGuard } from "../../../lib/navigationGuard";
import { Alert, Button, FormField, Select, Switch, TextField } from "../../../design-system";
import { BuscaPrato } from "./BuscaPrato";
import { FORMATOS, FolhaPlaquinhas, paginar, textoDaPlaca, type PlacaImpressa } from "./FolhaPlaquinhas";
import { ListaDaFolha } from "./ListaDaFolha";
import { PratoDialog } from "./PratoDialog";
import { PreviaFolhas } from "./PreviaFolhas";
import { chaveTamanho, useTamanhos, type TextoPlaca } from "./medidaFonte";
import {
  FORMATO_SUGERIDO, TEMAS, TIPOS_LISTA, adicionarEntrada, novaEntrada, rotuloLista, sugerirCategoria, type Entrada,
} from "./plaquinhasFormato";

type Folha = { listaId: string | null; nome: string; tipo: PlateListKind; data: string; formato: PlateFormat; tema: PlateTheme; entradas: Entrada[] };
type Confirmacao = { titulo: string; texto: string; ok: string; acao: () => void };
type Aviso = { tom: "success" | "error"; texto: string };

const CLASSE_IMPRIMINDO = "imprimindo-plaquinhas";
const CHAVE_CATEGORIA = "pateo.plaquinhas.mostrarCategoria";
const LISTAS_DE_ATALHO = 5;
const hoje = () => new Date().toLocaleDateString("sv-SE");
const folhaVazia = (): Folha => ({ listaId: null, nome: "", tipo: "BUFFET", data: hoje(), formato: "std", tema: "wine", entradas: [] });
const assinatura = (f: Folha) => JSON.stringify({ ...f, entradas: f.entradas.map(({ itemId, qty }) => [itemId, qty]) });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function lerMostrarCategoria() {
  try { return localStorage.getItem(CHAVE_CATEGORIA) !== "0"; } catch { return true; }
}

type Props = {
  ativa: boolean;
  catalogo: BuffetPlateItem[];
  listas: BuffetPlateListSummary[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
  aoMudarListas: () => void;
  aoCadastrarPrato: (p: BuffetPlateItem) => void;
};

export function MontarFolha({ ativa, catalogo, listas, podeCriar, podeEditar, podeExcluir, aoMudarListas, aoCadastrarPrato }: Props) {
  const [folha, setFolha] = useState<Folha>(folhaVazia);
  const [salva, setSalva] = useState(() => assinatura(folhaVazia()));
  const [mostrarCategoria, setMostrarCategoria] = useState(lerMostrarCategoria);
  const [novoPrato, setNovoPrato] = useState<{ texto: string; categoria: string | null } | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [destaque, setDestaque] = useState<{ chave: string; vez: number } | null>(null);
  // Cada pedido de impressão ganha um número: se o navegador não avisar o fim (iPhone/Safari),
  // o próximo clique reinicia em vez de ficar travado.
  const [pedidoImpressao, setPedidoImpressao] = useState(0);
  const [versaoLista, setVersaoLista] = useState(0);
  const buscaRef = useRef<HTMLInputElement>(null);

  const porId = useMemo(() => new Map(catalogo.map((p) => [p.id, p])), [catalogo]);
  const alterada = assinatura(folha) !== salva;
  const podeSalvar = folha.listaId ? podeEditar : podeCriar;
  const naFolha = useMemo(() => new Map(folha.entradas.map((e) => [e.itemId, e.qty])), [folha.entradas]);

  const placas: PlacaImpressa[] = useMemo(() => folha.entradas.flatMap((e) => {
    const p = porId.get(e.itemId);
    return p ? Array.from({ length: e.qty }, (_, i) => ({ key: `${e.key}-${i}`, namePt: p.namePt, nameEn: p.nameEn, category: p.category })) : [];
  }), [folha.entradas, porId]);

  // Um texto por prato (não por plaquinha): é isso que precisa ser medido.
  const textos = useMemo(() => {
    const unicos = new Map<string, TextoPlaca & { namePt: string }>();
    for (const e of folha.entradas) {
      const p = porId.get(e.itemId);
      if (p && !unicos.has(p.id)) unicos.set(p.id, { ...textoDaPlaca(p), namePt: p.namePt });
    }
    return [...unicos.values()];
  }, [folha.entradas, porId]);
  const tamanhos = useTamanhos(textos, folha.formato, mostrarCategoria);
  const naoCouberam = textos.filter((t) => tamanhos.get(chaveTamanho(folha.formato, mostrarCategoria, t))?.estoura).map((t) => t.namePt);
  const folhas = paginar(placas, FORMATOS[folha.formato].porFolha).length;
  const resumo = placas.length ? `${plural(placas.length, "plaquinha", "plaquinhas")} em ${plural(folhas, "folha", "folhas")} A4` : "A prévia aparece aqui";

  useEffect(() => {
    try { localStorage.setItem(CHAVE_CATEGORIA, mostrarCategoria ? "1" : "0"); } catch { /* sem armazenamento: só não lembra */ }
  }, [mostrarCategoria]);

  useEffect(() => {
    if (!aviso || aviso.tom !== "success") return undefined;
    const t = window.setTimeout(() => setAviso(null), 4000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  // Fechar a aba ou recarregar com a folha montada e não salva pede confirmação do navegador.
  const temTrabalhoPerdivel = alterada && folha.entradas.length > 0;
  useEffect(() => {
    if (!temTrabalhoPerdivel) return undefined;
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [temTrabalhoPerdivel]);
  // Trocar de tela pelo menu (ou sair do ERP) com a folha não salva também pergunta antes.
  useNavigationGuard(temTrabalhoPerdivel, "A folha de plaquinhas tem mudanças não salvas. Sair desta tela e perder as mudanças?");

  const mudar = (parcial: Partial<Folha>) => setFolha((f) => ({ ...f, ...parcial }));
  const mudarEntradas = useCallback((fn: (es: Entrada[]) => Entrada[]) => setFolha((f) => ({ ...f, entradas: fn(f.entradas) })), []);

  function seguroTrocar(acao: () => void) {
    if (!temTrabalhoPerdivel) return acao();
    setConfirmacao({ titulo: "Descartar alterações?", texto: "A folha atual tem mudanças que não foram salvas.", ok: "Descartar", acao });
  }

  function abrirLista(id: string) {
    seguroTrocar(async () => {
      setAviso(null);
      if (!id) {
        setVersaoLista((n) => n + 1);
        const v = folhaVazia();
        setFolha(v);
        setSalva(assinatura(v));
        return;
      }
      setOcupado(true);
      try {
        const l = await getBuffetPlateList(id);
        setVersaoLista((v) => v + 1);
        const nova: Folha = { listaId: l.id, nome: l.name, tipo: l.kind, data: l.eventDate ?? "", formato: l.format, tema: l.theme, entradas: l.items.map((i) => novaEntrada(i.itemId, i.qty)) };
        setFolha(nova);
        setSalva(assinatura(nova));
      } catch (x) {
        setAviso({ tom: "error", texto: x instanceof Error ? x.message : "Não foi possível abrir a lista." });
      } finally {
        setOcupado(false);
      }
    });
  }

  function adicionar(itemId: string) {
    // A linha nova é criada aqui fora para a chave do destaque ser a mesma que entra na folha.
    const nova = novaEntrada(itemId);
    setFolha((f) => ({ ...f, entradas: adicionarEntrada(f.entradas, itemId, nova).entradas }));
    const chave = adicionarEntrada(folha.entradas, itemId, nova).chave;
    setDestaque((d) => ({ chave, vez: (d?.vez ?? 0) + 1 }));
  }

  async function salvar(comoNova: boolean) {
    if (ocupado) return;
    const nome = folha.nome.trim();
    if (!nome) {
      setAviso({ tom: "error", texto: "Dê um nome para a lista antes de salvar. Ex.: Buffet de sexta, Coffee break Stand B." });
      document.getElementById("plq-nome-lista")?.focus();
      return;
    }
    setOcupado(true);
    setAviso(null);
    try {
      const enviada = { ...folha, nome };
      const r = await saveBuffetPlateList({
        name: nome, kind: folha.tipo, eventDate: folha.data || null, format: folha.formato, theme: folha.tema,
        items: folha.entradas.map(({ itemId, qty }) => ({ itemId, qty })),
      }, comoNova ? undefined : folha.listaId ?? undefined);
      // Só marca como salvo o que foi enviado: o que mudou durante a gravação continua "não salvo".
      setFolha((f) => ({ ...f, nome: f.nome.trim() === nome ? nome : f.nome, listaId: r.id }));
      setSalva(assinatura({ ...enviada, listaId: r.id }));
      setAviso({ tom: "success", texto: `Lista “${nome}” salva.` });
      aoMudarListas();
    } catch (x) {
      setAviso({ tom: "error", texto: x instanceof Error ? x.message : "Não foi possível salvar a lista." });
    } finally {
      setOcupado(false);
    }
  }

  function excluirLista() {
    const { listaId, nome } = folha;
    if (!listaId) return;
    setConfirmacao({
      titulo: "Apagar lista?", texto: `A lista “${nome}” some das listas salvas. Os pratos continuam no catálogo.`, ok: "Apagar",
      acao: async () => {
        try {
          await deleteBuffetPlateList(listaId);
          setVersaoLista((n) => n + 1);
          const v = folhaVazia();
          setFolha(v);
          setSalva(assinatura(v));
          setAviso({ tom: "success", texto: `Lista “${nome}” apagada.` });
          aoMudarListas();
        } catch (x) {
          setAviso({ tom: "error", texto: x instanceof Error ? x.message : "Não foi possível apagar a lista." });
        }
      },
    });
  }

  const imprimir = useCallback(() => { if (placas.length) setPedidoImpressao((n) => n + 1); }, [placas.length]);

  // A cópia de impressão só existe enquanto imprime: montar as folhas duas vezes o tempo todo
  // deixava cada clique lento com muitas plaquinhas.
  useEffect(() => {
    if (!pedidoImpressao) return undefined;
    const estilo = document.createElement("style");
    estilo.textContent = "@page { size: A4 portrait; margin: 0; }";
    document.head.appendChild(estilo);
    document.body.classList.add(CLASSE_IMPRIMINDO);
    let ativo = true;
    const terminar = () => { if (ativo) setPedidoImpressao(0); };
    window.addEventListener("afterprint", terminar);
    const quadro = requestAnimationFrame(async () => {
      const logos = [...document.querySelectorAll<HTMLImageElement>(".plq-area-impressao img")];
      await Promise.all(logos.map((img) => img.decode().catch(() => undefined)));
      if (ativo) window.print();
    });
    return () => {
      ativo = false;
      cancelAnimationFrame(quadro);
      window.removeEventListener("afterprint", terminar);
      document.body.classList.remove(CLASSE_IMPRIMINDO);
      estilo.remove();
    };
  }, [pedidoImpressao]);

  // Ctrl+P imprime as plaquinhas (e não a tela do ERP); Ctrl+S salva a lista.
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(() => {
    if (!ativa || novoPrato || confirmacao) return undefined;
    const tecla = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "p" && placas.length) { e.preventDefault(); imprimir(); }
      if (k === "s" && podeSalvar && folha.entradas.length) { e.preventDefault(); void salvarRef.current(false); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ativa, novoPrato, confirmacao, imprimir, placas.length, podeSalvar, folha.entradas.length]);

  const folhaProps = { placas, formato: folha.formato, tema: folha.tema, mostrarCategoria, tamanhos };
  const atalhos = folha.entradas.length === 0 ? listas.slice(0, LISTAS_DE_ATALHO) : [];

  return (
    <div className="plq-montar">
      <div className="plq-coluna">
        <section className="plq-bloco" aria-labelledby="plq-titulo-lista-salva">
          <h3 className="plq-bloco-titulo" id="plq-titulo-lista-salva"><span className="plq-passo">1</span> Lista</h3>
          <div className="plq-linha">
            <Select aria-label="Abrir lista salva" containerClassName="plq-cresce" value={folha.listaId ?? ""} disabled={ocupado}
              onChange={(e) => abrirLista(e.target.value)}
              options={[{ value: "", label: "Nova lista (em branco)" }, ...listas.map((l) => ({ value: l.id, label: rotuloLista(l) }))]} />
            {folha.listaId && podeExcluir && (
              <Button variant="icon" aria-label="Apagar esta lista" title="Apagar esta lista" onClick={excluirLista}><Trash2 size={18} /></Button>
            )}
          </div>
          {atalhos.length > 0 && (
            <div className="plq-atalhos">
              <span>Começar de uma lista salva:</span>
              {atalhos.map((l) => <button key={l.id} type="button" className="plq-chip" onClick={() => abrirLista(l.id)}>{l.name}</button>)}
            </div>
          )}
          <div className="plq-campos">
            <TextField id="plq-nome-lista" label="Nome da lista" value={folha.nome} maxLength={120} placeholder="Ex.: Buffet de sexta" onChange={(e) => mudar({ nome: e.target.value })} />
            <Select label="Tipo" value={folha.tipo} options={TIPOS_LISTA}
              onChange={(e) => {
                const tipo = e.target.value as PlateListKind;
                mudar({ tipo, formato: folha.entradas.length ? folha.formato : FORMATO_SUGERIDO[tipo] });
              }} />
            <TextField label="Data" type="date" value={folha.data} onChange={(e) => mudar({ data: e.target.value })} />
          </div>
        </section>

        <section className="plq-bloco" aria-label="Adicionar prato">
          <BuscaPrato ref={buscaRef} catalogo={catalogo} naFolha={naFolha} podeCriar={podeCriar} onAdicionar={adicionar}
            onNovoPrato={(texto, categoria) => setNovoPrato({ texto, categoria })} />
          {folha.entradas.length === 0 && <p className="plq-vazio">Procure o prato pelo nome ou toque numa categoria para ver todos dela.</p>}
        </section>

        <ListaDaFolha key={versaoLista} entradas={folha.entradas} porId={porId} destaque={destaque} onMudar={mudarEntradas} />

        <section className="plq-bloco" aria-labelledby="plq-titulo-formato">
          <h3 className="plq-bloco-titulo" id="plq-titulo-formato"><span className="plq-passo">3</span> Formato e cores</h3>
          <div className="plq-opcoes" role="group" aria-label="Formato">
            {(Object.keys(FORMATOS) as PlateFormat[]).map((f) => (
              <button key={f} type="button" className="plq-opcao" aria-pressed={folha.formato === f} onClick={() => mudar({ formato: f })}>
                <i className={`plq-icone-formato plq-icone-formato--${f}`} aria-hidden="true" />
                <strong>{FORMATOS[f].nome}</strong><span>{FORMATOS[f].tamanho} · {FORMATOS[f].porFolha} por folha</span>
              </button>
            ))}
          </div>
          <div className="plq-opcoes plq-opcoes--2" role="group" aria-label="Cores">
            {TEMAS.map((t) => (
              <button key={t.value} type="button" className="plq-opcao" aria-pressed={folha.tema === t.value} onClick={() => mudar({ tema: t.value })}>
                <strong><i className={`plq-amostra plq-amostra--${t.value}`} aria-hidden="true" />{t.label}</strong><span>{t.dica}</span>
              </button>
            ))}
          </div>
          <FormField label="Mostrar a categoria no alto" inline><Switch checked={mostrarCategoria} onChange={setMostrarCategoria} /></FormField>
        </section>

        {aviso && <Alert tone={aviso.tom} role={aviso.tom === "error" ? "alert" : "status"}>{aviso.texto}</Alert>}

        <div className="plq-barra">
          <span className="plq-barra-estado">
            {placas.length ? <strong>{resumo}</strong> : "Nenhuma plaquinha ainda"}
            {temTrabalhoPerdivel && podeSalvar && <em>Não salvo</em>}
          </span>
          <div className="plq-barra-botoes">
            {folha.listaId && podeCriar && (
              <Button variant="secondary" size="sm" disabled={ocupado || !folha.entradas.length} onClick={() => salvar(true)} title="Salvar uma cópia com outro nome">
                <Copy size={16} /> Salvar cópia
              </Button>
            )}
            {podeSalvar && (
              <Button variant="secondary" disabled={ocupado || !folha.entradas.length || (!alterada && Boolean(folha.listaId))} onClick={() => salvar(false)} title="Ctrl+S">
                <Save size={16} /> {ocupado ? "Salvando…" : folha.listaId ? "Salvar" : "Salvar lista"}
              </Button>
            )}
            <Button disabled={!placas.length} onClick={imprimir} title="Ctrl+P">
              <Printer size={16} /> Imprimir
            </Button>
          </div>
        </div>
      </div>

      <PreviaFolhas resumo={resumo} naoCouberam={naoCouberam} tema={folha.tema} vazia={!placas.length}>
        <FolhaPlaquinhas {...folhaProps} />
      </PreviaFolhas>

      {pedidoImpressao > 0 && createPortal(<div className="plq-area-impressao" aria-hidden="true"><FolhaPlaquinhas {...folhaProps} /></div>, document.body)}

      <PratoDialog aberto={novoPrato !== null} prato={null} nomeInicial={novoPrato?.texto ?? ""}
        categoriaInicial={novoPrato?.categoria ?? sugerirCategoria(catalogo, novoPrato?.texto ?? "")}
        onFechar={() => { setNovoPrato(null); buscaRef.current?.focus(); }}
        onSalvo={(p) => { aoCadastrarPrato(p); setNovoPrato(null); adicionar(p.id); buscaRef.current?.focus(); }} />

      <Dialog open={confirmacao !== null} onOpenChange={(o) => { if (!o) setConfirmacao(null); }} title={confirmacao?.titulo ?? ""} description={confirmacao?.texto} size="sm">
        <div className="plq-form-acoes">
          <Button variant="secondary" onClick={() => setConfirmacao(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { const acao = confirmacao?.acao; setConfirmacao(null); acao?.(); }}>{confirmacao?.ok}</Button>
        </div>
      </Dialog>
    </div>
  );
}
