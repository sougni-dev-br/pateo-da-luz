import { ChefHat, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bulkUpdateDishes,
  confirmDishFicha,
  deactivateDish,
  getDishCategories,
  getDishDetail,
  getBuffetDishes,
  getDishes,
  reactivateDish,
  unconfirmDishFicha,
  type BuffetDish,
  type DishCategory,
  type DishDetail,
  type DishListItem,
  type DishMenu,
  type SaveDishResult
} from "../../../api/client";
import { Notice, useNotice } from "../../../components/Notice";
import { useSession } from "../../../context/SessionContext";
import { Alert, Button, ListDetailLayout, Tabs } from "../../../design-system";
import {
  contarPorSituacao,
  filtrarPratos,
  ordenarPratos,
  type FiltroDaLista,
  type OrdemDaLista,
  type SituacaoDaFicha
} from "../../../lib/fichaTecnica";
import { cardapioCombina, categoriaCombina, contarPorCardapio, type FiltroDeCardapio } from "../../../lib/categoriasDasFichas";
import { folhaDoNome, folhaDoPrato, type FolhaDados } from "../../../lib/folhaDaFicha";
import { montarFilaAPreencher } from "../../../lib/fichasAPreencher";
import { montarPainel } from "../../../lib/painelFichas";
import { useNavigationGuard } from "../../../lib/navigationGuard";
import { hasPermission } from "../../../lib/permissions";
import { useRevealScroll } from "../../../lib/useRevealScroll";
import { CmvPorCanal } from "./CmvPorCanal";
import { Categorias } from "./Categorias";
import { DetalheDoPrato } from "./DetalheDoPrato";
import { DialogoDeImpressao } from "./DialogoDeImpressao";
import { DialogoDeLote, type EscolhaDoLote } from "./DialogoDeLote";
import { useImpressaoDeFolhas } from "./FolhaDaFicha";
import { FormularioDoPrato, type ModoDoFormulario } from "./FormularioDoPrato";
import { ListaAPreencher } from "./ListaAPreencher";
import { ListaDeProducao } from "./ListaDeProducao";
import { ListaDePratos } from "./ListaDePratos";
import { PainelDasFichasView } from "./PainelDasFichas";
import { SeletorDeCardapio } from "./SeletorDeCardapio";
import "./fichas.css";
import "./painel.css";

type Aba = "painel" | "fichas" | "producao" | "preencher" | "cmv" | "categorias";
/** `chave` muda a cada abertura: reabrir "Novo prato" precisa de um formulário zerado, não do anterior. */
type Editor = { modo: ModoDoFormulario; base: DishDetail | null; chave: number; producao: boolean };

const FILTRO_INICIAL: FiltroDaLista = { busca: "", menu: "todos", categoriaId: "", situacao: "todos", mostrarInativos: false };
const AVISO_DE_DESCARTE = "Há alterações não salvas nesta ficha. Descartar?";

const mensagemDe = (erro: unknown, padrao: string) => (erro instanceof Error && erro.message ? erro.message : padrao);

export function FichasTecnicas() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "dishes", "edit");
  const { notice, setNotice } = useNotice();

  const [aba, setAba] = useState<Aba>("painel");
  const [pratos, setPratos] = useState<DishListItem[]>([]);
  // Fichas de produção (a massa do nhoque): não são vendidas, então ficam fora da lista de pratos e do CMV.
  const [producao, setProducao] = useState<DishListItem[]>([]);
  // Preparações do buffet criadas pelo lançamento de desperdício: aguardam (ou já têm) a ficha.
  const [buffet, setBuffet] = useState<BuffetDish[]>([]);
  const [categorias, setCategorias] = useState<DishCategory[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);

  const [filtro, setFiltro] = useState<FiltroDaLista>(FILTRO_INICIAL);
  const [ordem, setOrdem] = useState<OrdemDaLista>("nome");

  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DishDetail | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [alterado, setAlterado] = useState(false);

  // Seleção em lote: organizar (cardápio/categoria) e imprimir fichas de vários pratos.
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [dialogoDeLote, setDialogoDeLote] = useState(false);
  const [dialogoDeImpressao, setDialogoDeImpressao] = useState(false);
  const { imprimir, portal: portalDaImpressao } = useImpressaoDeFolhas();

  // Respostas que chegam depois de o usuário já ter ido para outro prato são descartadas.
  const pedidoDeDetalhe = useRef(0);
  const pedidoDeCarga = useRef(0);
  const selecionadoRef = useRef<string | null>(null);
  const sequenciaDoEditor = useRef(0);
  const devolverFoco = useRef(false);

  useNavigationGuard(alterado, AVISO_DE_DESCARTE);

  const notificar = useCallback(
    (tom: "success" | "error", mensagem: string) => setNotice({ tone: tom, message: mensagem }),
    [setNotice]
  );

  const definirSelecionado = useCallback((id: string | null) => {
    selecionadoRef.current = id;
    setSelecionadoId(id);
  }, []);

  const carregar = useCallback(async () => {
    const meuPedido = ++pedidoDeCarga.current;
    setCarregando(true);
    setErroDeCarga(null);
    try {
      // Traz inativos também: o filtro é local, então busca e contadores respondem na hora.
      // O buffet é um extra: se a lista dele falhar, as fichas continuam abrindo.
      const [lista, categoriasDoServidor, doBuffet, deProducao] = await Promise.all([
        getDishes({ showInactive: true }),
        getDishCategories(),
        getBuffetDishes().catch(() => [] as BuffetDish[]),
        getDishes({ showInactive: true, tipo: "producao" })
      ]);
      if (meuPedido !== pedidoDeCarga.current) return;
      // Um backend ainda sem ?tipo devolveria tudo junto: cada lista fica só com o que é dela.
      setPratos(lista.filter((prato) => !prato.fichaDeProducao));
      setBuffet(doBuffet);
      setProducao(deProducao.filter((ficha) => ficha.fichaDeProducao));
      setCategorias(categoriasDoServidor);
    } catch (erro) {
      if (meuPedido !== pedidoDeCarga.current) return;
      setErroDeCarga(mensagemDe(erro, "Não foi possível carregar as fichas técnicas."));
    } finally {
      if (meuPedido === pedidoDeCarga.current) setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const abrirDetalhe = useCallback(async (id: string) => {
    const meuPedido = ++pedidoDeDetalhe.current;
    try {
      const encontrado = await getDishDetail(id);
      if (meuPedido === pedidoDeDetalhe.current) setDetalhe(encontrado);
    } catch (erro) {
      if (meuPedido !== pedidoDeDetalhe.current) return;
      definirSelecionado(null);
      setDetalhe(null);
      notificar("error", mensagemDe(erro, "Não foi possível abrir o prato."));
    }
  }, [notificar, definirSelecionado]);

  const confirmarDescarte = useCallback(() => !alterado || window.confirm(AVISO_DE_DESCARTE), [alterado]);

  function abrirEditor(modo: ModoDoFormulario, base: DishDetail | null, ehProducao = false) {
    setEditor({ modo, base, chave: ++sequenciaDoEditor.current, producao: base ? Boolean(base.fichaDeProducao) : ehProducao });
  }

  function fecharEditor() {
    devolverFoco.current = true;
    setEditor(null);
    setAlterado(false);
  }

  function selecionar(id: string) {
    if (id === selecionadoRef.current && !editor) return;
    if (!confirmarDescarte()) return;
    setEditor(null);
    setAlterado(false);
    definirSelecionado(id);
    setDetalhe(null);
    void abrirDetalhe(id);
  }

  function novoPrato() {
    if (!confirmarDescarte()) return;
    definirSelecionado(null);
    setDetalhe(null);
    setAlterado(false);
    abrirEditor("novo", null);
  }

  function novaFichaDeProducao() {
    if (!confirmarDescarte()) return;
    definirSelecionado(null);
    setDetalhe(null);
    setAlterado(false);
    abrirEditor("novo", null, true);
  }

  function cancelarEditor() {
    if (!confirmarDescarte()) return;
    fecharEditor();
  }

  /** Botão voltar do celular: do formulário para a ficha (ou lista), da ficha para a lista. */
  function voltar() {
    if (editor) {
      cancelarEditor();
      return;
    }
    definirSelecionado(null);
    setDetalhe(null);
  }

  function trocarAba(proxima: string) {
    if (proxima === aba) return;
    if (!confirmarDescarte()) return;
    setEditor(null);
    setAlterado(false);
    // Cada aba tem a sua lista: o prato aberto na anterior não fica no painel sem item marcado.
    definirSelecionado(null);
    setDetalhe(null);
    setAba(proxima as Aba);
  }

  /** Do painel para a lista, já filtrada: "206 pratos sem ficha" leva direto a eles. */
  function irParaPratos(parcial: { situacao?: SituacaoDaFicha; categoriaId?: string }) {
    if (!confirmarDescarte()) return;
    setEditor(null);
    setAlterado(false);
    setFiltro({ ...FILTRO_INICIAL, situacao: parcial.situacao ?? "todos", categoriaId: parcial.categoriaId ?? "" });
    setOrdem(parcial.situacao === "cmv-alto" ? "cmv" : "nome");
    setAba("fichas");
  }

  function abrirPratoDoPainel(id: string) {
    if (!confirmarDescarte()) return;
    setFiltro(FILTRO_INICIAL);
    setAba("fichas");
    selecionar(id);
  }

  // ── cardápio (salão x delivery) ──
  function escolherCardapio(valor: FiltroDeCardapio) {
    // A categoria escolhida pode não existir no outro cardápio: o filtro dela volta ao padrão.
    setFiltro((anterior) => ({ ...anterior, menu: valor, categoriaId: "" }));
    setSelecionados(new Set());
  }

  // ── seleção em lote ──
  function sairDaSelecao() {
    setModoSelecao(false);
    setSelecionados(new Set());
  }

  function alternarSelecao(id: string) {
    setSelecionados((anterior) => {
      const proximo = new Set(anterior);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  async function aplicarLote(escolha: EscolhaDoLote) {
    const resposta = await bulkUpdateDishes({ ids: [...selecionados], ...escolha });
    await carregar();
    const limpas = resposta.categoriasLimpas > 0 ? ` ${resposta.categoriasLimpas} ficaram sem categoria, por ser de outro cardápio.` : "";
    const nosDois = resposta.nosDois ? ` ${resposta.nosDois} passaram a ser vendidos nos dois cardápios.` : "";
    const jaEram = resposta.jaNoCardapio ? ` ${resposta.jaNoCardapio} já eram desse cardápio e ficaram como estão.` : "";
    const semDelivery = resposta.semQuantidadesNoDelivery
      ? ` Atenção: ${resposta.semQuantidadesNoDelivery} ficaram sem as quantidades do delivery (as do a la carte não valem para ele): abra cada um e informe.`
      : "";
    notificar("success", `${resposta.atualizados} prato${resposta.atualizados === 1 ? "" : "s"} organizado${resposta.atualizados === 1 ? "" : "s"}.${nosDois}${jaEram}${limpas}${semDelivery}`);
    sairDaSelecao();
  }

  // ── impressão ──
  function imprimirDosSelecionados() {
    const folhas = pratos.filter((prato) => selecionados.has(prato.id)).map((prato) => folhaDoNome(prato));
    imprimir(folhas);
  }

  async function atualizar() {
    const aberto = selecionadoRef.current;
    await Promise.all([carregar(), aberto ? abrirDetalhe(aberto) : Promise.resolve()]);
  }

  async function aoSalvar(id: string, modo: ModoDoFormulario, desperdicio?: SaveDishResult["desperdicio"], virouProducao = false) {
    fecharEditor();
    definirSelecionado(id);
    // O prato que virou ficha de produção saiu da lista de pratos: a aba dele passa a ser a de produção.
    if (virouProducao) setAba("producao");
    // Se o filtro atual esconderia o prato recém-salvo, ele some da lista mas continua aberto.
    await Promise.all([carregar(), abrirDetalhe(id)]);
    const deProducao = Boolean(editor?.producao);
    const base = virouProducao ? "Pronto: agora é uma ficha de produção (aba Produção). Ela pode ser usada como ingrediente de outras fichas." : modo === "editar" ? "Ficha atualizada." : modo === "copia" ? (deProducao ? "Cópia salva como uma ficha de produção nova." : "Cópia salva como um prato novo.") : deProducao ? "Ficha de produção criada." : "Prato criado.";
    // Ficha completa: o desperdício que estava sem valor passou a valer, e quem lançou já pode ver na Análise.
    const reflexo = desperdicio?.revalorizados
      ? ` ${desperdicio.revalorizados} ${desperdicio.revalorizados === 1 ? "lançamento" : "lançamentos"} de desperdício ${desperdicio.revalorizados === 1 ? "passou" : "passaram"} a ter valor.`
      : desperdicio?.concluiuPendencia ? " Ficha concluída." : "";
    notificar("success", `${base}${reflexo}`);
  }

  async function conferirFicha(conferida: boolean) {
    if (!detalhe) return;
    const { id, name } = detalhe;
    try {
      if (conferida) await confirmDishFicha(id);
      else await unconfirmDishFicha(id);
      await Promise.all([carregar(), selecionadoRef.current === id ? abrirDetalhe(id) : Promise.resolve()]);
      notificar("success", conferida ? `“${name}” marcada como conferida.` : `Conferência de “${name}” desmarcada.`);
    } catch (erro) {
      notificar("error", mensagemDe(erro, "Não foi possível atualizar a conferência."));
    }
  }

  async function alternarAtivo() {
    if (!detalhe) return;
    const { id, name, isActive } = detalhe;
    if (isActive && !window.confirm(`Inativar “${name}”? ${detalhe.fichaDeProducao ? "Ela sai da lista, mas dá para reativar depois." : "Ele sai da lista, mas dá para reativar depois."}`)) return;

    try {
      if (isActive) await deactivateDish(id);
      else await reactivateDish(id);
      // Quem clicou noutro prato enquanto isto rodava não pode ver a ficha do anterior de volta.
      await Promise.all([carregar(), selecionadoRef.current === id ? abrirDetalhe(id) : Promise.resolve()]);
      notificar("success", isActive ? (detalhe.fichaDeProducao ? `“${name}” inativada. Marque “Mostrar inativas” na aba Produção para vê-la.` : `“${name}” inativado. Marque “Mostrar inativos” para vê-lo na lista.`) : `“${name}” ${detalhe.fichaDeProducao ? "reativada" : "reativado"}.`);
    } catch (erro) {
      notificar("error", mensagemDe(erro, isActive ? "Não foi possível inativar o prato." : "Não foi possível reativar o prato."));
    }
  }

  const pratosDaLista = useMemo(() => ordenarPratos(filtrarPratos(pratos, filtro), ordem), [pratos, filtro, ordem]);
  const contagemPorCardapio = useMemo(() => contarPorCardapio(pratos), [pratos]);
  // O painel e os números do alto olham só o cardápio escolhido.
  const pratosDoCardapio = useMemo(() => pratos.filter((prato) => cardapioCombina(prato, filtro.menu)), [pratos, filtro.menu]);
  // O painel olha só os ativos; os chips da lista acompanham o que ela mostra (inclui inativos se ligado).
  // No cardápio onde o prato é vendido "também", a ficha e o custo são os dele (os números de CMV e margem da lista são do
  // principal, com o preço do salão): sem preço de loja aqui, ele entra no painel só como ficha, nunca com o CMV do outro cardápio.
  const pratosDoPainel = useMemo(
    () => pratosDoCardapio.map((prato) => (
      filtro.menu !== "todos" && prato.menu !== filtro.menu
        ? {
            ...prato,
            itemsCount: prato.alsoItemsCount ?? 0,
            custoPorcao: prato.alsoCustoPorcao ?? 0,
            custoIncompleto: prato.alsoCustoIncompleto ?? false,
            cmvPercentual: null,
            margemBruta: null
          }
        : prato
    )),
    [pratosDoCardapio, filtro.menu]
  );
  const painel = useMemo(() => montarPainel(pratosDoPainel), [pratosDoPainel]);
  // Base dos números do seletor de categoria: o cardápio escolhido, com ou sem inativos.
  const pratosDoSeletor = useMemo(
    () => pratosDoCardapio.filter((prato) => prato.isActive || filtro.mostrarInativos),
    [pratosDoCardapio, filtro.mostrarInativos]
  );
  // Os chips seguem a categoria escolhida: "Todos 216" ao lado de "nenhum prato" parecia filtro quebrado.
  const pratosDosChips = useMemo(
    () => (filtro.categoriaId ? pratosDoSeletor.filter((prato) => categoriaCombina(prato, filtro.categoriaId, filtro.menu)) : pratosDoSeletor),
    [pratosDoSeletor, filtro.categoriaId]
  );
  const contagemDosChips = useMemo(() => contarPorSituacao(pratosDosChips, filtro.mostrarInativos), [pratosDosChips, filtro.mostrarInativos]);

  // O que ainda falta preencher: preparações do desperdício, pratos sem ficha e fichas incompletas (aba "A preencher").
  const fila = useMemo(() => montarFilaAPreencher([...pratos, ...producao], buffet), [pratos, producao, buffet]);
  const detalheDoSelecionado = detalhe && detalhe.id === selecionadoId ? detalhe : null;
  const painelAberto = selecionadoId !== null || editor !== null;

  const revelarRef = useRevealScroll<HTMLDivElement>({
    when: editor ? `editor:${editor.chave}` : selecionadoId,
    focus: false,
    skipIfVisible: true
  });

  // Fechou o formulário: o foco volta para o título da ficha assim que ela estiver na tela.
  useEffect(() => {
    if (!devolverFoco.current || editor || !detalheDoSelecionado) return;
    const titulo = document.getElementById("ft-detalhe-titulo");
    if (!titulo) return;
    devolverFoco.current = false;
    titulo.focus();
  }, [editor, detalheDoSelecionado]);

  function renderizarPainel() {
    if (editor) {
      return (
        <FormularioDoPrato
          key={editor.chave}
          modo={editor.modo}
          base={editor.base}
          categorias={categorias}
          menuPadrao={filtro.menu === "DELIVERY" ? "DELIVERY" : "CARDAPIO"}
          producao={editor.producao}
          onCancelar={cancelarEditor}
          onSalvo={(id, modo, desperdicio, virouProducao) => void aoSalvar(id, modo, desperdicio, virouProducao)}
          onAlterado={setAlterado}
          notificar={notificar}
        />
      );
    }

    if (selecionadoId && !detalheDoSelecionado) return <p className="ft-carregando" role="status">Carregando a ficha…</p>;

    if (detalheDoSelecionado) {
      const pedido = buffet.find((p) => p.id === detalheDoSelecionado.id && p.pending);
      return (
        <>
        {pedido && (
          <Alert tone="warning" title="Aguardando ficha técnica">
            Criado no lançamento de desperdício{pedido.requestedBy ? ` por ${pedido.requestedBy}` : ""}. {pedido.wasteEntries}{" "}
            {pedido.wasteEntries === 1 ? "lançamento" : "lançamentos"} ({pedido.wasteQuantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {pedido.unit}) ficam sem valor até a ficha estar completa:
            todos os ingredientes com custo. Ao salvar uma ficha completa, o valor entra sozinho.
            {pedido.notes ? ` O que leva, segundo quem lançou: ${pedido.notes}.` : ""}
          </Alert>
        )}
        <DetalheDoPrato
          prato={detalheDoSelecionado}
          canEdit={canEdit}
          onEditar={() => abrirEditor("editar", detalheDoSelecionado)}
          onCopiar={() => abrirEditor("copia", detalheDoSelecionado)}
          onAlternarAtivo={() => void alternarAtivo()}
          onImprimir={() => imprimir([folhaDoPrato(detalheDoSelecionado)])}
          onFechar={voltar}
          onPrecosMudaram={() => { void abrirDetalhe(detalheDoSelecionado.id); void carregar(); }}
          onConferir={() => void conferirFicha(true)}
          onDesconferir={() => void conferirFicha(false)}
          notificar={notificar}
        />
        </>
      );
    }

    if (aba === "producao") {
      return (
        <div className="ft-vazio">
          <ChefHat size={30} aria-hidden />
          <h2>Escolha uma ficha de produção</h2>
          <p>O custo de cada unidade dela entra no CMV dos pratos que a usam como ingrediente. Ela não tem preço de venda nem CMV próprio.</p>
          {canEdit && <Button leadingIcon={<Plus size={16} aria-hidden />} onClick={novaFichaDeProducao}>Nova ficha de produção</Button>}
        </div>
      );
    }

    const semFicha = painel.pendencias.semFicha;
    return (
      <div className="ft-vazio">
        <ChefHat size={30} aria-hidden />
        <h2>Escolha um prato</h2>
        <p>
          A ficha mostra o custo de cada ingrediente, a margem e o CMV do prato.
          {semFicha > 0 && ` Faltam ingredientes em ${semFicha} prato${semFicha === 1 ? "" : "s"}: use o filtro “Sem ficha” para ir direto a eles.`}
        </p>
        {canEdit && <Button leadingIcon={<Plus size={16} aria-hidden />} onClick={novoPrato}>Novo prato</Button>}
      </div>
    );
  }

  return (
    <div className="ft-pagina">
      <Notice notice={notice} />

      <div className="ft-topo-controles">
      <Tabs
        value={aba}
        onChange={trocarAba}
        tabs={[
          { value: "painel", label: "Painel" },
          { value: "fichas", label: "Pratos" },
          { value: "producao", label: producao.some((ficha) => ficha.isActive) ? `Produção (${producao.filter((ficha) => ficha.isActive).length})` : "Produção" },
          { value: "preencher", label: fila.total > 0 ? `A preencher (${fila.total})` : "A preencher" },
          { value: "cmv", label: "CMV por canal" },
          { value: "categorias", label: "Categorias" }
        ]}
      />
      {/* Ficha de produção não tem cardápio: o seletor de salão/delivery só vale para os pratos vendidos. */}
      {aba !== "producao" && <SeletorDeCardapio valor={filtro.menu} contagem={contagemPorCardapio} onChange={escolherCardapio} />}
      </div>

      {erroDeCarga && (
        <Alert tone="error" title="Não foi possível carregar">
          {erroDeCarga}{" "}
          <button type="button" className="ft-link" onClick={() => void carregar()}>Tentar de novo</button>
        </Alert>
      )}

      {aba === "painel" ? (
        carregando && pratos.length === 0 ? (
          <p className="ft-carregando" role="status">Carregando o painel…</p>
        ) : (
          <PainelDasFichasView
            painel={painel}
            canEdit={canEdit}
            onIrParaPratos={irParaPratos}
            onAbrirPrato={abrirPratoDoPainel}
            onNovo={() => { setAba("fichas"); novoPrato(); }}
            onImprimirEmBranco={() => setDialogoDeImpressao(true)}
          />
        )
      ) : aba === "producao" ? (
        <ListDetailLayout
          className="ft-layout"
          detailActive={painelAberto}
          onBack={voltar}
          backLabel={editor?.base ? "Voltar à ficha" : "Voltar à lista"}
          list={<ListaDeProducao fichas={producao} selecionadoId={selecionadoId} carregando={carregando} comErro={erroDeCarga != null} canEdit={canEdit} onSelecionar={selecionar} onNova={novaFichaDeProducao} />}
          detail={<div ref={revelarRef} className="scroll-target ft-painel">{renderizarPainel()}</div>}
        />
      ) : aba === "preencher" ? (
        <ListDetailLayout
          className="ft-layout"
          detailActive={painelAberto}
          onBack={voltar}
          backLabel={editor?.base ? "Voltar à ficha" : "Voltar à lista"}
          list={<ListaAPreencher fila={fila} selecionadoId={selecionadoId} carregando={carregando} onSelecionar={selecionar} onImprimir={imprimir} onImprimirEmBranco={() => setDialogoDeImpressao(true)} />}
          detail={<div ref={revelarRef} className="scroll-target ft-painel">{renderizarPainel()}</div>}
        />
      ) : aba === "cmv" ? (
        <CmvPorCanal pratos={pratosDoCardapio} carregando={carregando} onAbrirPrato={abrirPratoDoPainel} />
      ) : aba === "categorias" ? (
        <Categorias categorias={categorias} pratos={pratos} filtroDeCardapio={filtro.menu} canEdit={canEdit} onSalvo={() => void carregar()} notificar={notificar} />
      ) : (
        <ListDetailLayout
          className="ft-layout"
          detailActive={painelAberto}
          onBack={voltar}
          backLabel={editor?.base ? "Voltar à ficha" : "Voltar à lista"}
          list={
            <ListaDePratos
              pratos={pratosDaLista}
              totalCadastrado={pratos.length}
              contagemDosChips={contagemDosChips}
              pratosDoSeletor={pratosDoSeletor}
              categorias={categorias}
              filtro={filtro}
              ordem={ordem}
              selecionadoId={selecionadoId}
              carregando={carregando}
              canEdit={canEdit}
              onFiltro={(parcial) => setFiltro((anterior) => ({ ...anterior, ...parcial }))}
              onOrdem={setOrdem}
              onSelecionar={selecionar}
              onNovo={novoPrato}
              onAtualizar={() => void atualizar()}
              modoSelecao={modoSelecao}
              selecionados={selecionados}
              onEntrarNaSelecao={() => setModoSelecao(true)}
              onSairDaSelecao={sairDaSelecao}
              onAlternarSelecao={alternarSelecao}
              onSelecionarTodos={() => setSelecionados(new Set(pratosDaLista.map((prato) => prato.id)))}
              onLimparSelecao={() => setSelecionados(new Set())}
              onMoverSelecionados={() => setDialogoDeLote(true)}
              onImprimirSelecionados={imprimirDosSelecionados}
              onImprimirEmBranco={() => setDialogoDeImpressao(true)}
            />
          }
          detail={<div ref={revelarRef} className="scroll-target ft-painel">{renderizarPainel()}</div>}
        />
      )}

      <DialogoDeLote
        aberto={dialogoDeLote}
        quantidade={selecionados.size}
        cardapiosAtuais={[...new Set(pratos.filter((prato) => selecionados.has(prato.id)).map((prato) => prato.menu))] as DishMenu[]}
        categorias={categorias}
        onFechar={() => setDialogoDeLote(false)}
        onAplicar={aplicarLote}
      />
      <DialogoDeImpressao
        aberto={dialogoDeImpressao}
        categorias={categorias}
        onFechar={() => setDialogoDeImpressao(false)}
        onImprimir={(folhas: FolhaDados[]) => imprimir(folhas)}
      />
      {portalDaImpressao}
    </div>
  );
}
