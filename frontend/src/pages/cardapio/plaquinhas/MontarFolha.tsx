import { Copy, FileDown, Printer, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ApiError, deleteBuffetPlateList, getBuffetPlateList, registerBuffetPlatePrint, saveBuffetPlateList,
  type BuffetPlateItem, type BuffetPlateListSummary, type PlateFormat, type PlateListKind, type PlateTheme,
} from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button, FormField, Select, Switch, TextField } from "../../../design-system";
import { ArquivoGrafica, paginaDaGrafica, type PratoDaGrafica } from "./ArquivoGrafica";
import { BuscaPrato } from "./BuscaPrato";
import { LembretesDoBuffet } from "./LembretesDoBuffet";
import { useAcompanhamento } from "./acompanhamento";
import { FORMATOS, FolhaPlaquinhas, paginar, textoDaPlaca, type PlacaImpressa } from "./FolhaPlaquinhas";
import { ListaDaFolha } from "./ListaDaFolha";
import { PratoDialog } from "./PratoDialog";
import { PreviaFolhas } from "./PreviaFolhas";
import { esperarImagens } from "./impressao";
import { chaveTamanho, useTamanhos, type TextoPlaca } from "./medidaFonte";
import {
  FORMATO_SUGERIDO, TEMAS, TIPOS_LISTA, adicionarEntrada, novaEntrada, rotuloLista, sugerirCategoria, type Entrada,
} from "./plaquinhasFormato";

type Folha = { listaId: string | null; nome: string; tipo: PlateListKind; data: string; formato: PlateFormat; tema: PlateTheme; entradas: Entrada[] };
type Confirmacao = { titulo: string; texto: string; ok: string; acao: () => void };
type Aviso = { tom: "success" | "error" | "warning"; texto: string };

const CLASSE_IMPRIMINDO = "imprimindo-plaquinhas";
const CLASSE_GRAFICA = "imprimindo-grafica";
const CHAVE_CATEGORIA = "pateo.plaquinhas.mostrarCategoria";
const LISTAS_DE_ATALHO = 5;
const REPETICAO_MS = 10_000;
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
  aoMudarPendencia: (pendente: boolean) => void;
  /** Avisa a página que uma impressão entrou no acompanhamento. */
  aoRegistrarImpressao: () => void;
  versaoAcompanhamento: number;
};

export function MontarFolha({ ativa, catalogo, listas, podeCriar, podeEditar, podeExcluir, aoMudarListas, aoCadastrarPrato, aoMudarPendencia, aoRegistrarImpressao, versaoAcompanhamento }: Props) {
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
  // "folha": A4 para imprimir aqui. "grafica": uma página por prato, com sangria e marcas de corte.
  const [pedidoImpressao, setPedidoImpressao] = useState<{ n: number; modo: "folha" | "grafica"; formato: PlateFormat } | null>(null);
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

  // A página junta as pendências das abas e avisa ao sair (menu, Sair, fechar a aba).
  const temTrabalhoPerdivel = alterada && folha.entradas.length > 0;
  useEffect(() => { aoMudarPendencia(temTrabalhoPerdivel); }, [temTrabalhoPerdivel, aoMudarPendencia]);

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
    const nomeDigitado = folha.nome.trim();
    const nome = comoNova && nomeDigitado && !/\(cópia\)$/.test(nomeDigitado) ? `${nomeDigitado} (cópia)`.slice(0, 120) : nomeDigitado;
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
      setFolha((f) => ({ ...f, nome: f.nome.trim() === nomeDigitado ? nome : f.nome, listaId: r.id }));
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

  // Cada impressão anota os pratos do dia da folha: é o que alimenta o acompanhamento.
  // Se não registrar, a impressão sai igual e a cozinha fica sabendo.
  // Lista salva reaberta traz a data de quando foi montada: o que se imprime hoje sai hoje.
  // Só uma data à frente (folha preparada com antecedência) vale como está.
  // Clique duplo ou Ctrl+P segurado mandariam a mesma folha várias vezes: a repetida em
  // poucos segundos é ignorada.
  const ultimoRegistro = useRef({ chave: "", quando: 0 });
  const registrarImpressao = useCallback(() => {
    const itemIds = [...new Set(folha.entradas.map((e) => e.itemId))].filter((id) => porId.has(id));
    if (!itemIds.length) return;
    const servedOn = folha.data > hoje() ? folha.data : hoje();
    const chave = `${servedOn}|${folha.tipo}|${itemIds.join(",")}`;
    const agora = Date.now();
    if (ultimoRegistro.current.chave === chave && agora - ultimoRegistro.current.quando < REPETICAO_MS) return;
    ultimoRegistro.current = { chave, quando: agora };
    registerBuffetPlatePrint({ servedOn, kind: folha.tipo, listId: folha.listaId, listName: folha.nome.trim() || null, itemIds })
      .then(aoRegistrarImpressao)
      .catch((x) => {
        ultimoRegistro.current = { chave: "", quando: 0 };
        setAviso({ tom: "warning", texto: x instanceof ApiError && x.status === 403
        ? "As plaquinhas foram para a impressora, mas seu usuário não pode registrar no acompanhamento de pratos. Peça para liberar “Criar” em Plaquinhas do buffet."
        : "As plaquinhas foram para a impressora, mas este dia não entrou no acompanhamento de pratos. Imprima de novo para registrar." });
      });
  }, [folha.entradas, folha.data, folha.tipo, folha.listaId, folha.nome, porId, aoRegistrarImpressao]);

  const imprimirDeVez = useCallback(() => {
    setPedidoImpressao((p) => ({ n: (p?.n ?? 0) + 1, modo: "folha", formato: folha.formato }));
    registrarImpressao();
  }, [registrarImpressao, folha.formato]);
  // Nome que não coube sai cortado no papel: pergunta antes, em vez de imprimir pela metade sem avisar.
  const confirmarCortados = useCallback((acao: () => void) => {
    if (!naoCouberam.length) return acao();
    setConfirmacao({
      titulo: naoCouberam.length === 1 ? "Um nome vai sair cortado" : `${naoCouberam.length} nomes vão sair cortados`,
      texto: `Não coube mesmo com a letra no menor tamanho: ${naoCouberam.join(", ")}. Encurte o nome no Catálogo ou imprima assim mesmo.`,
      ok: "Imprimir assim mesmo", acao,
    });
  }, [naoCouberam]);
  const imprimir = useCallback(() => {
    if (!placas.length) return;
    confirmarCortados(imprimirDeVez);
  }, [placas.length, confirmarCortados, imprimirDeVez]);
  const acompanhamento = useAcompanhamento(folha.tipo, 30, versaoAcompanhamento, ativa);

  // Para a gráfica vai uma página por prato com a quantidade escrita: ela monta as cópias.
  // Não entra no acompanhamento: mandar para a gráfica não é servir o prato no dia.
  const pratosDaGrafica: PratoDaGrafica[] = useMemo(() => folha.entradas.flatMap((e) => {
    const p = porId.get(e.itemId);
    return p ? [{ key: e.key, namePt: p.namePt, nameEn: p.nameEn, category: p.category, qty: e.qty }] : [];
  }), [folha.entradas, porId]);
  const gerarArquivoGrafica = useCallback(() => {
    if (!pratosDaGrafica.length) return;
    confirmarCortados(() => setPedidoImpressao((p) => ({ n: (p?.n ?? 0) + 1, modo: "grafica", formato: folha.formato })));
  }, [pratosDaGrafica.length, confirmarCortados, folha.formato]);

  // A cópia de impressão só existe enquanto imprime: montar as folhas duas vezes o tempo todo
  // deixava cada clique lento com muitas plaquinhas.
  useEffect(() => {
    if (!pedidoImpressao) return undefined;
    const grafica = pedidoImpressao.modo === "grafica";
    const pagina = paginaDaGrafica(pedidoImpressao.formato);
    const classe = grafica ? CLASSE_GRAFICA : CLASSE_IMPRIMINDO;
    const estilo = document.createElement("style");
    estilo.textContent = grafica ? `@page { size: ${pagina.largura}mm ${pagina.altura}mm; margin: 0; }` : "@page { size: A4 portrait; margin: 0; }";
    document.head.appendChild(estilo);
    document.body.classList.add(classe);
    let ativo = true;
    const terminar = () => { if (ativo) setPedidoImpressao(null); };
    window.addEventListener("afterprint", terminar);
    // setTimeout e não requestAnimationFrame: a animação fica parada quando o navegador
    // está atrás de outra janela ou minimizado, e a impressão nunca começaria.
    const espera = window.setTimeout(async () => {
      await esperarImagens(grafica ? ".plq-area-grafica img" : ".plq-area-impressao img");
      if (!ativo) return;
      window.print();
      window.setTimeout(() => { if (ativo) window.addEventListener("focus", terminar, { once: true }); }, 1000);
    }, 0);
    return () => {
      ativo = false;
      window.clearTimeout(espera);
      window.removeEventListener("afterprint", terminar);
      window.removeEventListener("focus", terminar);
      document.body.classList.remove(classe);
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
      if (k === "p" && placas.length) { e.preventDefault(); if (!e.repeat) imprimir(); }
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
            onNovoPrato={(texto, categoria) => setNovoPrato({ texto, categoria })}
            dica={folha.entradas.length === 0 ? "Procure o prato pelo nome ou toque numa categoria para ver todos dela." : undefined} />
        </section>

        <LembretesDoBuffet relatorio={acompanhamento.relatorio} porId={porId} naFolha={naFolha} onAdicionar={adicionar}
          rotuloTipo={folha.tipo === "COFFEE_BREAK" ? "coffee break" : folha.tipo === "EVENTO" ? "evento" : "buffet"} />

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
          <div className="plq-opcoes plq-opcoes--cores" role="group" aria-label="Cores">
            {TEMAS.map((t) => (
              <button key={t.value} type="button" className="plq-opcao" aria-pressed={folha.tema === t.value} onClick={() => mudar({ tema: t.value })}>
                <strong><i className={`plq-amostra plq-amostra--${t.value}`} aria-hidden="true" />{t.label}</strong><span>{t.dica}</span>
              </button>
            ))}
          </div>
          <FormField label="Mostrar a categoria no alto" inline><Switch checked={mostrarCategoria} onChange={setMostrarCategoria} /></FormField>
          <div className="plq-grafica-acao">
            <button type="button" className="plq-link" disabled={!pratosDaGrafica.length} onClick={gerarArquivoGrafica}>
              <FileDown size={15} aria-hidden="true" /> Arquivo para gráfica
            </button>
            <span>PDF com uma página por prato, já com a sobra de cor (2 mm) e as marquinhas de onde cortar, como as gráficas pedem. Na janela de impressão, escolha “Salvar como PDF” e mande o arquivo.</span>
          </div>
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

      <PreviaFolhas resumo={resumo} tema={folha.tema} vazia={!placas.length} textoVazia="Abra uma lista salva ou procure os pratos. Cada plaquinha aparece na folha A4 do jeito que sai na impressora."
        alerta={naoCouberam.length ? {
          curto: naoCouberam.length === 1 ? "1 nome não coube" : `${naoCouberam.length} nomes não couberam`,
          longo: `${naoCouberam.length === 1 ? "Este nome não coube" : "Estes nomes não couberam"} mesmo com a letra no menor tamanho: ${naoCouberam.join(", ")}. Encurte na aba Catálogo (a plaquinha aparece com borda vermelha).`,
        } : null}>
        <FolhaPlaquinhas {...folhaProps} />
      </PreviaFolhas>

      {pedidoImpressao?.modo === "folha" && createPortal(<div className="plq-area-impressao" aria-hidden="true"><FolhaPlaquinhas {...folhaProps} /></div>, document.body)}
      {pedidoImpressao?.modo === "grafica" && createPortal(
        <div className="plq-area-grafica" aria-hidden="true">
          <ArquivoGrafica pratos={pratosDaGrafica} formato={folha.formato} tema={folha.tema} mostrarCategoria={mostrarCategoria} tamanhos={tamanhos} />
        </div>, document.body)}

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
