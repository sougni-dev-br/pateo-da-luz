import { Copy, Plus, Printer, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  deleteBuffetMenu, getBuffetMenu, saveBuffetMenu,
  type BuffetMenuSection, type BuffetMenuSummary, type BuffetPlateItem, type PlateTheme,
} from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button, Select, TextField } from "../../../design-system";
import { CampoCm } from "./CampoCm";
import { FolhasCardapio, useAjustesDoCardapio } from "./FaceCardapio";
import { PratoDialog } from "./PratoDialog";
import { PreviaFolhas } from "./PreviaFolhas";
import { esperarImagens } from "./impressao";
import { MAX_PRATOS_SECAO, SecaoCardapio, chaveNova, type SecaoEdit } from "./SecaoCardapio";
import {
  MAX_DISPLAYS, SECOES_MODELO, TAMANHOS_FACE, TAMANHO_DISPLAY, cm, facesParaImprimir, gruposDasFaces, layoutDaFolha, pendenciasDoCardapio, umPorDisplay,
  type Distribuicao,
} from "./cardapioFormato";
import { TEMAS, dataCurta, semAcento, sugerirCategoria } from "./plaquinhasFormato";

type Cardapio = { id: string | null; nome: string; data: string; tema: PlateTheme; largura: number; altura: number; displays: number; distribuicao: Distribuicao; secoes: SecaoEdit[] };
type Confirmacao = { titulo: string; texto: string; ok: string; acao: () => void };
type Aviso = { tom: "success" | "error"; texto: string };

const CLASSE_IMPRIMINDO = "imprimindo-cardapio";
const MAX_SECOES = 30;
const MODELOS_DE_ATALHO = 6;
const hoje = () => new Date().toLocaleDateString("sv-SE");
const novoCardapio = (): Cardapio => ({ id: null, nome: "", data: hoje(), tema: "wine", largura: TAMANHO_DISPLAY.largura, altura: TAMANHO_DISPLAY.altura, displays: 1, distribuicao: "same", secoes: [] });
const paraSalvar = (c: Cardapio): BuffetMenuSection[] =>
  c.secoes.map(({ face, titlePt, titleEn, items }) => ({ face, titlePt: titlePt.trim(), titleEn: titleEn.trim(), items: items.map((i) => ({ namePt: i.namePt.trim(), nameEn: i.nameEn.trim(), ...(i.qty && i.qty > 1 ? { qty: i.qty } : {}) })) }));
const assinatura = (c: Cardapio) => JSON.stringify({ ...c, secoes: paraSalvar(c) });

type Props = {
  ativa: boolean;
  catalogo: BuffetPlateItem[];
  cardapios: BuffetMenuSummary[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
  aoMudarCardapios: () => void;
  aoMudarPendencia: (pendente: boolean) => void;
  aoCadastrarPrato: (p: BuffetPlateItem) => void;
};

// Prato a cadastrar no catálogo a partir do cardápio: volta para a seção de onde saiu.
type Cadastro = { secao: string; namePt: string; nameEn: string; substituir?: string };

export function CardapioAcrilico({ ativa, catalogo, cardapios, podeCriar, podeEditar, podeExcluir, aoMudarCardapios, aoMudarPendencia, aoCadastrarPrato }: Props) {
  const [cadastro, setCadastro] = useState<Cadastro | null>(null);
  // Displays que vão para a impressora agora (chaves dos grupos); null = todos.
  const [soImprimir, setSoImprimir] = useState<string[] | null>(null);
  const [c, setC] = useState<Cardapio>(novoCardapio);
  const [salvo, setSalvo] = useState(() => assinatura(novoCardapio()));
  const [mostrarErros, setMostrarErros] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pedidoImpressao, setPedidoImpressao] = useState(0);
  const [tamanhoProprio, setTamanhoProprio] = useState(false);

  const alterado = assinatura(c) !== salvo;
  const temTrabalho = alterado && c.secoes.length > 0;
  const podeSalvar = c.id ? podeEditar : podeCriar;
  useEffect(() => { aoMudarPendencia(temTrabalho); }, [temTrabalho, aoMudarPendencia]);

  // Só as seções entram aqui: digitar o nome ou a data não remede a letra nem redesenha as faces.
  const secoes = useMemo(() => paraSalvar({ ...novoCardapio(), secoes: c.secoes }), [c.secoes]);
  const pendencias = pendenciasDoCardapio(c.nome, secoes);
  const pendenciasDeConteudo = useMemo(() => pendenciasDoCardapio("ok", secoes), [secoes]);
  const layout = layoutDaFolha(c.largura, c.altura);
  const porSecao = c.distribuicao === "perSection";
  const porPrato = c.distribuicao === "perItem";
  const separados = umPorDisplay(c.distribuicao);
  const grupos = useMemo(() => gruposDasFaces(secoes, c.distribuicao), [secoes, c.distribuicao]);
  const escolhidos = soImprimir ? grupos.filter((g) => soImprimir.includes(g.chave)) : grupos;
  const faces = facesParaImprimir(escolhidos, c.displays, c.distribuicao);
  const folhas = layout ? Math.ceil(faces.length / layout.porFolha) : 0;
  const { ajustes, molde } = useAjustesDoCardapio({ grupos, tema: c.tema, largura: c.largura, altura: c.altura });
  const naoCouberam = grupos.filter((g) => g.secoes.length && ajustes[g.chave]?.estoura).map((g) => g.rotulo);
  const temVerso = secoes.some((s) => s.face === "back");
  const totalDisplays = separados ? escolhidos.reduce((a, g) => a + (g.copias ?? c.displays), 0) : c.displays;
  const comoSai = porPrato ? "um por prato, frente e verso iguais" : porSecao ? "um por seção, frente e verso iguais" : temVerso ? "frente e verso" : "só frente";
  const resumo = !secoes.length ? "A prévia aparece aqui" : `${totalDisplays} ${totalDisplays === 1 ? "display" : "displays"} (${comoSai}) em ${folhas} ${folhas === 1 ? "folha" : "folhas"} A4`;

  // Pratos do catálogo pelo nome: traz o inglês de quem escreve à mão e diz quem ainda não está cadastrado.
  const porNome = useMemo(() => new Map(catalogo.filter((p) => p.isActive).map((p) => [semAcento(p.namePt), p])), [catalogo]);

  function cadastrado(p: BuffetPlateItem) {
    const pedido = cadastro;
    setCadastro(null);
    aoCadastrarPrato(p);
    if (!pedido) return;
    const novo = { namePt: p.namePt, nameEn: p.nameEn };
    mudarSecoes((ss) => ss.map((s) => {
      if (s.chave !== pedido.secao) return s;
      if (pedido.substituir) return { ...s, items: s.items.map((it) => (it.chave === pedido.substituir ? { ...it, ...novo } : it)) };
      return { ...s, items: [...s.items, { chave: chaveNova(), ...novo }] };
    }));
  }

  const mudar = (parcial: Partial<Cardapio>) => setC((atual) => ({ ...atual, ...parcial }));
  const mudarSecoes = (fn: (s: SecaoEdit[]) => SecaoEdit[]) => setC((atual) => ({ ...atual, secoes: fn(atual.secoes) }));

  function seguroTrocar(acao: () => void) {
    if (!temTrabalho) return acao();
    setConfirmacao({ titulo: "Descartar alterações?", texto: "O cardápio atual tem mudanças que não foram salvas.", ok: "Descartar", acao });
  }

  // comoModelo: copia o conteúdo para um cardápio novo, sem mexer no salvo (nome e data em branco).
  function abrir(id: string, comoModelo = false) {
    seguroTrocar(async () => {
      setAviso(null);
      setMostrarErros(false);
      setSoImprimir(null);
      if (!id) { const v = novoCardapio(); setC(v); setSalvo(assinatura(v)); setTamanhoProprio(false); return; }
      setOcupado(true);
      try {
        const m = await getBuffetMenu(id);
        const novo: Cardapio = {
          id: comoModelo ? null : m.id, nome: comoModelo ? "" : m.name, data: comoModelo ? hoje() : m.eventDate ?? "",
          tema: m.theme, largura: m.faceWidthMm, altura: m.faceHeightMm, displays: m.copies, distribuicao: m.layout ?? "same",
          secoes: m.sections.map((s) => ({ ...s, chave: chaveNova(), items: s.items.map((i) => ({ ...i, chave: chaveNova() })) })),
        };
        setC(novo);
        setSalvo(assinatura(comoModelo ? novoCardapio() : novo));
        if (comoModelo) {
          setAviso({ tom: "success", texto: `Começando do modelo “${m.name}”. Dê um nome ao cardápio, ajuste os pratos e salve: o modelo continua como estava.` });
          window.setTimeout(() => document.getElementById("cdp-nome")?.focus(), 0);
        }
        setTamanhoProprio(!TAMANHOS_FACE.some((t) => t.largura === m.faceWidthMm && t.altura === m.faceHeightMm));
      } catch (x) {
        setAviso({ tom: "error", texto: x instanceof Error ? x.message : "Não foi possível abrir o cardápio." });
      } finally {
        setOcupado(false);
      }
    });
  }

  // Tira o prato de uma seção e põe no fim de outra, avisando para onde foi.
  function moverPrato(de: string, chaveItem: string, para: string) {
    const origem = c.secoes.find((s) => s.chave === de);
    const destino = c.secoes.find((s) => s.chave === para);
    const item = origem?.items.find((i) => i.chave === chaveItem);
    if (!origem || !destino || !item) return;
    if (destino.items.length >= MAX_PRATOS_SECAO) {
      setAviso({ tom: "error", texto: `“${destino.titlePt || "A seção"}” já tem ${MAX_PRATOS_SECAO} pratos.` });
      return;
    }
    mudarSecoes((ss) => ss.map((s) => {
      if (s.chave === de) return { ...s, items: s.items.filter((i) => i.chave !== chaveItem) };
      if (s.chave === para) return { ...s, items: [...s.items, item] };
      return s;
    }));
    setAviso({ tom: "success", texto: `${item.namePt.trim() || "Prato"} foi para ${destino.titlePt.trim() || "a outra seção"}.` });
  }

  function novaSecao(titlePt = "", titleEn = "", face: "front" | "back" = "front") {
    if (c.secoes.length >= MAX_SECOES) return setAviso({ tom: "error", texto: `O cardápio comporta até ${MAX_SECOES} seções.` });
    mudarSecoes((ss) => [...ss, { chave: chaveNova(), face, titlePt, titleEn, items: [] }]);
  }

  async function salvar(comoNovo: boolean) {
    if (ocupado) return;
    if (pendencias.length) { setMostrarErros(true); return setAviso({ tom: "error", texto: pendencias[0] }); }
    setOcupado(true);
    setAviso(null);
    try {
      const nomeLimpo = c.nome.trim();
      const enviado = { ...c, nome: comoNovo && !/\(cópia\)$/.test(nomeLimpo) ? `${nomeLimpo} (cópia)`.slice(0, 120) : nomeLimpo };
      const r = await saveBuffetMenu({
        name: enviado.nome, eventDate: c.data || null, theme: c.tema, faceWidthMm: c.largura, faceHeightMm: c.altura, copies: c.displays, layout: c.distribuicao, sections: secoes,
      }, comoNovo ? undefined : c.id ?? undefined);
      setC((atual) => ({ ...atual, nome: atual.nome.trim() === nomeLimpo ? enviado.nome : atual.nome, id: r.id }));
      setSalvo(assinatura({ ...enviado, id: r.id }));
      setMostrarErros(false);
      setAviso({ tom: "success", texto: `Cardápio “${enviado.nome}” salvo.` });
      aoMudarCardapios();
    } catch (x) {
      setAviso({ tom: "error", texto: x instanceof Error ? x.message : "Não foi possível salvar o cardápio." });
    } finally {
      setOcupado(false);
    }
  }

  function excluir() {
    const { id, nome } = c;
    if (!id) return;
    setConfirmacao({
      titulo: "Apagar cardápio?", texto: `O cardápio “${nome}” some dos salvos.`, ok: "Apagar",
      acao: async () => {
        try {
          await deleteBuffetMenu(id);
          const v = novoCardapio();
          setC(v);
          setSalvo(assinatura(v));
          setTamanhoProprio(false);
          setMostrarErros(false);
          setAviso({ tom: "success", texto: `Cardápio “${nome}” apagado.` });
          aoMudarCardapios();
        } catch (x) {
          setAviso({ tom: "error", texto: x instanceof Error ? x.message : "Não foi possível apagar o cardápio." });
        }
      },
    });
  }

  // Imprimir exige o inglês completo: é a regra da casa para tudo que vai ao cliente.
  const naoCabe = naoCouberam.join(" e ");
  const imprimir = useCallback(() => {
    if (!secoes.length) return;
    if (!faces.length) { setAviso({ tom: "error", texto: "Marque pelo menos um display para imprimir." }); return; }
    if (!layout) { setAviso({ tom: "error", texto: "Essa medida não cabe numa folha A4. Ajuste a largura e a altura da face." }); return; }
    if (pendenciasDeConteudo.length) { setMostrarErros(true); setAviso({ tom: "error", texto: pendenciasDeConteudo[0] }); return; }
    // Texto que não coube sairia cortado no papel: bloqueia em vez de imprimir pela metade.
    if (naoCabe) { setAviso({ tom: "error", texto: `O texto não coube ${naoCabe}. Tire pratos, encurte os nomes ou use uma face maior antes de imprimir.` }); return; }
    setPedidoImpressao((n) => n + 1);
  }, [secoes.length, faces.length, layout, pendenciasDeConteudo, naoCabe]);

  useEffect(() => {
    if (!pedidoImpressao || !layout) return undefined;
    const estilo = document.createElement("style");
    estilo.textContent = `@page { size: A4 ${layout.orientacao}; margin: 0; }`;
    document.head.appendChild(estilo);
    document.body.classList.add(CLASSE_IMPRIMINDO);
    let ativo = true;
    const terminar = () => { if (ativo) setPedidoImpressao(0); };
    window.addEventListener("afterprint", terminar);
    // setTimeout e não requestAnimationFrame: a animação fica parada quando o navegador
    // está atrás de outra janela ou minimizado, e a impressão nunca começaria.
    const espera = window.setTimeout(async () => {
      await esperarImagens(".cdp-area-impressao img");
      if (ativo) window.print();
    }, 0);
    return () => {
      ativo = false;
      window.clearTimeout(espera);
      window.removeEventListener("afterprint", terminar);
      document.body.classList.remove(CLASSE_IMPRIMINDO);
      estilo.remove();
    };
    // O layout entra pelo pedido: mudar o tamanho no meio da impressão não reinicia a janela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoImpressao]);

  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(() => {
    if (!ativa || confirmacao) return undefined;
    const tecla = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "p" && secoes.length) { e.preventDefault(); imprimir(); }
      if (k === "s" && podeSalvar && secoes.length) { e.preventDefault(); void salvarRef.current(false); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ativa, confirmacao, imprimir, podeSalvar, secoes.length]);

  const tamanhoAtual = tamanhoProprio ? "proprio" : TAMANHOS_FACE.find((t) => t.largura === c.largura && t.altura === c.altura)?.id ?? "proprio";
  const folhasProps = layout ? { faces, layout, grupos, tema: c.tema, largura: c.largura, altura: c.altura, ajustes } : null;

  return (
    <div className="plq-montar">
      <div className="plq-coluna">
        <section className="plq-bloco" aria-labelledby="cdp-titulo-salvo">
          <h3 className="plq-bloco-titulo" id="cdp-titulo-salvo"><span className="plq-passo">1</span> Cardápio</h3>
          <div className="plq-linha">
            <Select aria-label="Abrir cardápio salvo" containerClassName="plq-cresce" value={c.id ?? ""} disabled={ocupado} onChange={(e) => abrir(e.target.value)}
              options={[{ value: "", label: "Novo cardápio (em branco)" }, ...cardapios.map((m) => ({ value: m.id, label: `${m.name}${m.eventDate ? ` · ${dataCurta(m.eventDate)}` : ""} · ${m.itemCount} pratos` }))]} />
            {c.id && podeExcluir && <Button variant="icon" aria-label="Apagar este cardápio" title="Apagar este cardápio" onClick={excluir}><Trash2 size={18} /></Button>}
          </div>
          <div className="plq-campos">
            <TextField id="cdp-nome" label="Nome do cardápio" value={c.nome} maxLength={120} placeholder="Ex.: Evento Stand B, 12/10" onChange={(e) => mudar({ nome: e.target.value })}
              error={mostrarErros && c.nome.trim().length < 2 ? "Dê um nome para o cardápio." : undefined} />
            <TextField label="Data do evento" type="date" value={c.data} onChange={(e) => mudar({ data: e.target.value })} />
          </div>
          {!c.id && !c.secoes.length && cardapios.length > 0 && (
            <div className="plq-atalhos">
              <span>Começar de um modelo:</span>
              {cardapios.slice(0, MODELOS_DE_ATALHO).map((m) => (
                <button key={m.id} type="button" className="plq-chip" disabled={ocupado} onClick={() => abrir(m.id, true)}
                  title="Copia as seções e os pratos para um cardápio novo; o modelo não muda">{m.name}</button>
              ))}
            </div>
          )}
        </section>

        <section className="plq-bloco" aria-labelledby="cdp-titulo-secoes">
          <div className="plq-bloco-cabeca">
            <h3 className="plq-bloco-titulo" id="cdp-titulo-secoes"><span className="plq-passo">2</span> Seções e pratos</h3>
            <span className="plq-total">{secoes.length} {secoes.length === 1 ? "seção" : "seções"} · {secoes.reduce((a, s) => a + s.items.length, 0)} pratos</span>
          </div>
          <div className="plq-segmento cdp-distribuicao" role="group" aria-label="Como distribuir nos displays">
            <button type="button" aria-pressed={!separados} onClick={() => { setSoImprimir(null); mudar({ distribuicao: "same" }); }}>Igual em todos</button>
            <button type="button" aria-pressed={porSecao} onClick={() => { setSoImprimir(null); mudar({ distribuicao: "perSection" }); }}>Um por seção</button>
            <button type="button" aria-pressed={porPrato} onClick={() => { setSoImprimir(null); mudar({ distribuicao: "perItem" }); }}>Um por prato</button>
          </div>
          <p className="plq-contagem">{porPrato
            ? "Cada prato vira um display, com o nome da seção em cima e a letra grande, igual na frente e no verso."
            : porSecao
              ? "Cada seção vira um display, com o mesmo texto na frente e no verso. Bom para coffee break: bebidas num, salgados noutro."
              : "Todos os displays saem iguais. Cada seção vai na frente ou no verso."}</p>
          {c.secoes.map((s, i) => (
            <SecaoCardapio key={s.chave} secao={s} indice={i} total={c.secoes.length} catalogo={catalogo} porNome={porNome} podeCadastrar={podeCriar}
              mostrarErros={mostrarErros} mostrarFace={!separados} abertaNoInicio={s.items.length === 0}
              outrasSecoes={c.secoes.filter((x) => x.chave !== s.chave).map((x) => ({ chave: x.chave, rotulo: x.titlePt.trim() || `Seção ${c.secoes.indexOf(x) + 1}` }))}
              onMoverPrato={(chaveItem, para) => moverPrato(s.chave, chaveItem, para)}
              onCadastrar={(p) => setCadastro({ secao: s.chave, ...p })}
              primeiroDisplay={porPrato ? c.secoes.slice(0, i).reduce((a, x) => a + x.items.reduce((n, it) => n + (it.qty ?? 1), 0), 0) + 1 : i + 1} umPorPrato={porPrato}
              onMudar={(nova) => mudarSecoes((ss) => ss.map((x) => (x.chave === s.chave ? nova : x)))}
              onMover={(delta) => mudarSecoes((ss) => {
                const alvo = i + delta;
                if (alvo < 0 || alvo >= ss.length) return ss;
                const copia = [...ss];
                [copia[i], copia[alvo]] = [copia[alvo], copia[i]];
                return copia;
              })}
              onRemover={() => mudarSecoes((ss) => ss.filter((x) => x.chave !== s.chave))} />
          ))}
          <div className="plq-atalhos">
            <Button variant="secondary" size="sm" disabled={c.secoes.length >= MAX_SECOES} onClick={() => novaSecao()}><Plus size={15} aria-hidden="true" /> Nova seção</Button>
            <span>ou já com o nome:</span>
            {/* Os modelos não somem depois de usados: dá para ter duas seções parecidas (bebidas quentes e geladas). */}
            {SECOES_MODELO.map((m) => (
              <button key={m.titlePt} type="button" className="plq-chip" disabled={c.secoes.length >= MAX_SECOES} onClick={() => novaSecao(m.titlePt, m.titleEn, m.face)}>{m.titlePt}</button>
            ))}
            {c.secoes.length >= MAX_SECOES && <small>Limite de {MAX_SECOES} seções por cardápio.</small>}
          </div>
        </section>

        <section className="plq-bloco" aria-labelledby="cdp-titulo-tamanho">
          <h3 className="plq-bloco-titulo" id="cdp-titulo-tamanho"><span className="plq-passo">3</span> Tamanho, displays e cores</h3>
          <div className="plq-opcoes" role="group" aria-label="Tamanho de cada face">
            {TAMANHOS_FACE.map((t) => (
              <button key={t.id} type="button" className="plq-opcao" aria-pressed={tamanhoAtual === t.id}
                onClick={() => { setTamanhoProprio(false); mudar({ largura: t.largura, altura: t.altura }); }}>
                <strong>{t.nome}</strong><span>{cm(t.largura)} × {cm(t.altura)} cm</span>
              </button>
            ))}
            <button type="button" className="plq-opcao" aria-pressed={tamanhoAtual === "proprio"} onClick={() => setTamanhoProprio(true)}>
              <strong>Medida própria</strong><span>medida com régua</span>
            </button>
          </div>
          {tamanhoAtual === "proprio" && (
            <div className="plq-campos cdp-medida">
              <CampoCm rotulo="Largura (cm)" mm={c.largura} minMm={40} maxMm={281} onMudar={(v) => mudar({ largura: v })} />
              <CampoCm rotulo="Altura (cm)" mm={c.altura} minMm={40} maxMm={281} onMudar={(v) => mudar({ altura: v })} />
            </div>
          )}
          {!layout && <Alert tone="error">Essa medida não cabe numa folha A4. O máximo é 19,4 × 28,1 cm (ou 28,1 × 19,4 cm).</Alert>}
          {porPrato ? (
            <p className="plq-contagem">No “Um por prato”, a quantidade de cada prato fica ao lado do nome, na seção.</p>
          ) : (
          <div className="cdp-displays">
            <span>{separados ? "Cópias de cada display" : "Quantos displays"}</span>
            <span className="plq-qtd">
              <button type="button" aria-label="Um display a menos" disabled={c.displays <= 1} onClick={() => mudar({ displays: c.displays - 1 })}>−</button>
              <output aria-label="Displays">{c.displays}</output>
              <button type="button" aria-label="Um display a mais" disabled={c.displays >= MAX_DISPLAYS} onClick={() => mudar({ displays: c.displays + 1 })}>+</button>
            </span>
            {layout && <small>{layout.porFolha} faces por folha</small>}
          </div>
          )}
          {separados && grupos.length > 1 && (
            <div className="cdp-escolha">
              <div className="plq-segmento" role="group" aria-label="O que imprimir">
                <button type="button" aria-pressed={!soImprimir} onClick={() => setSoImprimir(null)}>Imprimir todos</button>
                <button type="button" aria-pressed={Boolean(soImprimir)} onClick={() => setSoImprimir(soImprimir ?? grupos.map((g) => g.chave))}>Escolher displays</button>
              </div>
              {soImprimir && (
                <div className="cdp-escolha-lista" role="group" aria-label="Displays que vão para a impressora">
                  {grupos.map((g, i) => {
                    const marcado = soImprimir.includes(g.chave);
                    const nome = g.rotulo.replace(/^em “|”$/g, "");
                    return (
                      <button key={g.chave} type="button" className="plq-chip" aria-pressed={marcado}
                        onClick={() => setSoImprimir(marcado ? soImprimir.filter((k) => k !== g.chave) : [...soImprimir, g.chave])}>
                        {i + 1}. {nome}
                      </button>
                    );
                  })}
                  <small>{escolhidos.length} de {grupos.length} vão para a impressora.</small>
                </div>
              )}
            </div>
          )}
          <div className="plq-opcoes plq-opcoes--cores" role="group" aria-label="Cores">
            {TEMAS.map((t) => (
              <button key={t.value} type="button" className="plq-opcao" aria-pressed={c.tema === t.value} onClick={() => mudar({ tema: t.value })}>
                <strong><i className={`plq-amostra plq-amostra--${t.value}`} aria-hidden="true" />{t.label}</strong><span>{t.dica}</span>
              </button>
            ))}
          </div>
        </section>

        {aviso && <Alert tone={aviso.tom} role={aviso.tom === "error" ? "alert" : "status"}>{aviso.texto}</Alert>}

        <div className="plq-barra">
          <span className="plq-barra-estado">
            {secoes.length ? <strong>{resumo}</strong> : "Nenhuma seção ainda"}
            {temTrabalho && podeSalvar && <em>Não salvo</em>}
          </span>
          <div className="plq-barra-botoes">
            {c.id && podeCriar && <Button variant="secondary" size="sm" disabled={ocupado || !secoes.length} onClick={() => salvar(true)} title="Salvar uma cópia com outro nome"><Copy size={16} /> Salvar cópia</Button>}
            {podeSalvar && (
              <Button variant="secondary" disabled={ocupado || !secoes.length || (!alterado && Boolean(c.id))} onClick={() => salvar(false)} title="Ctrl+S">
                <Save size={16} /> {ocupado ? "Salvando…" : c.id ? "Salvar" : "Salvar cardápio"}
              </Button>
            )}
            <Button disabled={!secoes.length || !layout} onClick={imprimir} title="Ctrl+P"><Printer size={16} /> Imprimir</Button>
          </div>
        </div>
      </div>

      <PreviaFolhas resumo={resumo} tema={c.tema} vazia={!secoes.length} textoVazia="Escolha uma seção, como Antepastos ou Bebidas, e coloque os pratos. Cada display aparece aqui com a frente e o verso lado a lado."
        alerta={naoCouberam.length ? {
          curto: `Não coube ${naoCouberam.join(" e ")}`,
          longo: `O texto não coube ${naoCouberam.join(" e ")} mesmo com a letra no menor tamanho. Tire pratos, encurte os nomes ou use uma face maior (a face aparece com borda vermelha).`,
        } : null}>
        {folhasProps && secoes.length > 0 && <FolhasCardapio {...folhasProps} />}
      </PreviaFolhas>

      {molde}
      {pedidoImpressao > 0 && folhasProps && createPortal(<div className="cdp-area-impressao" aria-hidden="true"><FolhasCardapio {...folhasProps} /></div>, document.body)}

      <PratoDialog aberto={cadastro !== null} prato={null} nomeInicial={cadastro?.namePt ?? ""} inglesInicial={cadastro?.nameEn ?? ""}
        categoriaInicial={sugerirCategoria(catalogo, cadastro?.namePt ?? "")} onFechar={() => setCadastro(null)} onSalvo={cadastrado} />

      <Dialog open={confirmacao !== null} onOpenChange={(o) => { if (!o) setConfirmacao(null); }} title={confirmacao?.titulo ?? ""} description={confirmacao?.texto} size="sm">
        <div className="plq-form-acoes">
          <Button variant="secondary" onClick={() => setConfirmacao(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { const acao = confirmacao?.acao; setConfirmacao(null); acao?.(); }}>{confirmacao?.ok}</Button>
        </div>
      </Dialog>
    </div>
  );
}

