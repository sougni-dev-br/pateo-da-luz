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
import { PreviaFolhas } from "./PreviaFolhas";
import { esperarImagens } from "./impressao";
import { SecaoCardapio, chaveNova, itemVazio, type SecaoEdit } from "./SecaoCardapio";
import {
  MAX_DISPLAYS, SECOES_MODELO, TAMANHOS_FACE, cm, facesParaImprimir, layoutDaFolha, pendenciasDoCardapio,
} from "./cardapioFormato";
import { TEMAS, dataCurta, semAcento } from "./plaquinhasFormato";

type Cardapio = { id: string | null; nome: string; data: string; tema: PlateTheme; largura: number; altura: number; displays: number; secoes: SecaoEdit[] };
type Confirmacao = { titulo: string; texto: string; ok: string; acao: () => void };
type Aviso = { tom: "success" | "error"; texto: string };

const CLASSE_IMPRIMINDO = "imprimindo-cardapio";
const ID_SUGESTOES = "cdp-sugestoes-pratos";
const MAX_SECOES = 10;
const hoje = () => new Date().toLocaleDateString("sv-SE");
const novoCardapio = (): Cardapio => ({ id: null, nome: "", data: hoje(), tema: "wine", largura: 92, altura: 76, displays: 1, secoes: [] });
const paraSalvar = (c: Cardapio): BuffetMenuSection[] =>
  c.secoes.map(({ face, titlePt, titleEn, items }) => ({ face, titlePt: titlePt.trim(), titleEn: titleEn.trim(), items: items.map((i) => ({ namePt: i.namePt.trim(), nameEn: i.nameEn.trim() })) }));
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
};

export function CardapioAcrilico({ ativa, catalogo, cardapios, podeCriar, podeEditar, podeExcluir, aoMudarCardapios, aoMudarPendencia }: Props) {
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
  const faces = facesParaImprimir(secoes, c.displays);
  const folhas = layout ? Math.ceil(faces.length / layout.porFolha) : 0;
  const { ajustes, molde } = useAjustesDoCardapio({ secoes, tema: c.tema, largura: c.largura, altura: c.altura });
  const naoCouberam = (["front", "back"] as const).filter((f) => ajustes[f].estoura && secoes.some((s) => s.face === f)).map((f) => (f === "front" ? "na frente" : "no verso"));
  const temVerso = secoes.some((s) => s.face === "back");
  const resumo = !secoes.length ? "A prévia aparece aqui" : `${c.displays} ${c.displays === 1 ? "display" : "displays"} (${temVerso ? "frente e verso" : "só frente"}) em ${folhas} ${folhas === 1 ? "folha" : "folhas"} A4`;

  // Sugestões do catálogo para o nome do prato; escolher uma traz o inglês junto.
  const porNome = useMemo(() => new Map(catalogo.filter((p) => p.isActive).map((p) => [semAcento(p.namePt), p])), [catalogo]);
  const sugestoes = useMemo(() => catalogo.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.namePt} />), [catalogo]);

  const mudar = (parcial: Partial<Cardapio>) => setC((atual) => ({ ...atual, ...parcial }));
  const mudarSecoes = (fn: (s: SecaoEdit[]) => SecaoEdit[]) => setC((atual) => ({ ...atual, secoes: fn(atual.secoes) }));

  function seguroTrocar(acao: () => void) {
    if (!temTrabalho) return acao();
    setConfirmacao({ titulo: "Descartar alterações?", texto: "O cardápio atual tem mudanças que não foram salvas.", ok: "Descartar", acao });
  }

  function abrir(id: string) {
    seguroTrocar(async () => {
      setAviso(null);
      setMostrarErros(false);
      if (!id) { const v = novoCardapio(); setC(v); setSalvo(assinatura(v)); setTamanhoProprio(false); return; }
      setOcupado(true);
      try {
        const m = await getBuffetMenu(id);
        const novo: Cardapio = {
          id: m.id, nome: m.name, data: m.eventDate ?? "", tema: m.theme, largura: m.faceWidthMm, altura: m.faceHeightMm, displays: m.copies,
          secoes: m.sections.map((s) => ({ ...s, chave: chaveNova(), items: s.items.map((i) => ({ ...i, chave: chaveNova() })) })),
        };
        setC(novo);
        setSalvo(assinatura(novo));
        setTamanhoProprio(!TAMANHOS_FACE.some((t) => t.largura === m.faceWidthMm && t.altura === m.faceHeightMm));
      } catch (x) {
        setAviso({ tom: "error", texto: x instanceof Error ? x.message : "Não foi possível abrir o cardápio." });
      } finally {
        setOcupado(false);
      }
    });
  }

  function novaSecao(titlePt = "", titleEn = "", face: "front" | "back" = "front") {
    if (c.secoes.length >= MAX_SECOES) return setAviso({ tom: "error", texto: `O cardápio comporta até ${MAX_SECOES} seções.` });
    mudarSecoes((ss) => [...ss, { chave: chaveNova(), face, titlePt, titleEn, items: [itemVazio()] }]);
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
        name: enviado.nome, eventDate: c.data || null, theme: c.tema, faceWidthMm: c.largura, faceHeightMm: c.altura, copies: c.displays, sections: secoes,
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
    if (!layout) { setAviso({ tom: "error", texto: "Essa medida não cabe numa folha A4. Ajuste a largura e a altura da face." }); return; }
    if (pendenciasDeConteudo.length) { setMostrarErros(true); setAviso({ tom: "error", texto: pendenciasDeConteudo[0] }); return; }
    // Texto que não coube sairia cortado no papel: bloqueia em vez de imprimir pela metade.
    if (naoCabe) { setAviso({ tom: "error", texto: `O texto não coube ${naoCabe}. Tire pratos, encurte os nomes ou use uma face maior antes de imprimir.` }); return; }
    setPedidoImpressao((n) => n + 1);
  }, [secoes.length, layout, pendenciasDeConteudo, naoCabe]);

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
  const folhasProps = layout ? { faces, layout, secoes, tema: c.tema, largura: c.largura, altura: c.altura, ajustes } : null;

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
        </section>

        <section className="plq-bloco" aria-labelledby="cdp-titulo-secoes">
          <div className="plq-bloco-cabeca">
            <h3 className="plq-bloco-titulo" id="cdp-titulo-secoes"><span className="plq-passo">2</span> Seções e pratos</h3>
            <span className="plq-total">{secoes.length} {secoes.length === 1 ? "seção" : "seções"} · {secoes.reduce((a, s) => a + s.items.length, 0)} pratos</span>
          </div>
          {c.secoes.map((s, i) => (
            <SecaoCardapio key={s.chave} secao={s} indice={i} total={c.secoes.length} porNome={porNome} idLista={ID_SUGESTOES} mostrarErros={mostrarErros}
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
            <span>{c.secoes.length ? "Mais uma seção:" : "Comece por uma seção:"}</span>
            {SECOES_MODELO.filter((m) => !c.secoes.some((s) => s.titlePt === m.titlePt)).map((m) => (
              <button key={m.titlePt} type="button" className="plq-chip" onClick={() => novaSecao(m.titlePt, m.titleEn, m.face)}>{m.titlePt}</button>
            ))}
            <button type="button" className="plq-chip" onClick={() => novaSecao()}><Plus size={12} aria-hidden="true" /> Outra</button>
          </div>
          <datalist id={ID_SUGESTOES}>{sugestoes}</datalist>
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
          <div className="cdp-displays">
            <span>Quantos displays</span>
            <span className="plq-qtd">
              <button type="button" aria-label="Um display a menos" disabled={c.displays <= 1} onClick={() => mudar({ displays: c.displays - 1 })}>−</button>
              <output aria-label="Displays">{c.displays}</output>
              <button type="button" aria-label="Um display a mais" disabled={c.displays >= MAX_DISPLAYS} onClick={() => mudar({ displays: c.displays + 1 })}>+</button>
            </span>
            {layout && <small>{layout.porFolha} faces por folha</small>}
          </div>
          <div className="plq-opcoes plq-opcoes--2" role="group" aria-label="Cores">
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

      <PreviaFolhas resumo={resumo} tema={c.tema} vazia={!secoes.length}
        alerta={naoCouberam.length ? {
          curto: `Não coube ${naoCouberam.join(" e ")}`,
          longo: `O texto não coube ${naoCouberam.join(" e ")} mesmo com a letra no menor tamanho. Tire pratos, encurte os nomes ou use uma face maior (a face aparece com borda vermelha).`,
        } : null}>
        {folhasProps && secoes.length > 0 && <FolhasCardapio {...folhasProps} />}
      </PreviaFolhas>

      {molde}
      {pedidoImpressao > 0 && folhasProps && createPortal(<div className="cdp-area-impressao" aria-hidden="true"><FolhasCardapio {...folhasProps} /></div>, document.body)}

      <Dialog open={confirmacao !== null} onOpenChange={(o) => { if (!o) setConfirmacao(null); }} title={confirmacao?.titulo ?? ""} description={confirmacao?.texto} size="sm">
        <div className="plq-form-acoes">
          <Button variant="secondary" onClick={() => setConfirmacao(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { const acao = confirmacao?.acao; setConfirmacao(null); acao?.(); }}>{confirmacao?.ok}</Button>
        </div>
      </Dialog>
    </div>
  );
}

