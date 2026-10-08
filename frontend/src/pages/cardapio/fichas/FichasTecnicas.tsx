import { ChefHat, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deactivateDish,
  getDishCategories,
  getDishDetail,
  getDishes,
  reactivateDish,
  type DishCategory,
  type DishDetail,
  type DishListItem
} from "../../../api/client";
import { Notice, useNotice } from "../../../components/Notice";
import { useSession } from "../../../context/SessionContext";
import { Alert, Button, ListDetailLayout, Tabs } from "../../../design-system";
import {
  contarPorSituacao,
  filtrarPratos,
  ordenarPratos,
  type FiltroDaLista,
  type OrdemDaLista
} from "../../../lib/fichaTecnica";
import { useNavigationGuard } from "../../../lib/navigationGuard";
import { hasPermission } from "../../../lib/permissions";
import { useRevealScroll } from "../../../lib/useRevealScroll";
import { Categorias } from "./Categorias";
import { DetalheDoPrato } from "./DetalheDoPrato";
import { FormularioDoPrato, type ModoDoFormulario } from "./FormularioDoPrato";
import { ListaDePratos } from "./ListaDePratos";
import "./fichas.css";

type Aba = "fichas" | "categorias";
/** `chave` muda a cada abertura: reabrir "Novo prato" precisa de um formulário zerado, não do anterior. */
type Editor = { modo: ModoDoFormulario; base: DishDetail | null; chave: number };

const FILTRO_INICIAL: FiltroDaLista = { busca: "", categoriaId: "", situacao: "todos", mostrarInativos: false };
const AVISO_DE_DESCARTE = "Há alterações não salvas nesta ficha. Descartar?";

const mensagemDe = (erro: unknown, padrao: string) => (erro instanceof Error && erro.message ? erro.message : padrao);

export function FichasTecnicas() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "dishes", "edit");
  const { notice, setNotice } = useNotice();

  const [aba, setAba] = useState<Aba>("fichas");
  const [pratos, setPratos] = useState<DishListItem[]>([]);
  const [categorias, setCategorias] = useState<DishCategory[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);

  const [filtro, setFiltro] = useState<FiltroDaLista>(FILTRO_INICIAL);
  const [ordem, setOrdem] = useState<OrdemDaLista>("nome");

  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DishDetail | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [alterado, setAlterado] = useState(false);

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
      const [lista, categoriasDoServidor] = await Promise.all([getDishes({ showInactive: true }), getDishCategories()]);
      if (meuPedido !== pedidoDeCarga.current) return;
      setPratos(lista);
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

  function abrirEditor(modo: ModoDoFormulario, base: DishDetail | null) {
    setEditor({ modo, base, chave: ++sequenciaDoEditor.current });
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
    setAba(proxima as Aba);
  }

  async function atualizar() {
    const aberto = selecionadoRef.current;
    await Promise.all([carregar(), aberto ? abrirDetalhe(aberto) : Promise.resolve()]);
  }

  async function aoSalvar(id: string, modo: ModoDoFormulario) {
    fecharEditor();
    definirSelecionado(id);
    // Se o filtro atual esconderia o prato recém-salvo, ele some da lista mas continua aberto.
    await Promise.all([carregar(), abrirDetalhe(id)]);
    notificar("success", modo === "editar" ? "Ficha atualizada." : modo === "copia" ? "Cópia salva como um prato novo." : "Prato criado.");
  }

  async function alternarAtivo() {
    if (!detalhe) return;
    const { id, name, isActive } = detalhe;
    if (isActive && !window.confirm(`Inativar “${name}”? Ele sai da lista, mas dá para reativar depois.`)) return;

    try {
      if (isActive) await deactivateDish(id);
      else await reactivateDish(id);
      // Quem clicou noutro prato enquanto isto rodava não pode ver a ficha do anterior de volta.
      await Promise.all([carregar(), selecionadoRef.current === id ? abrirDetalhe(id) : Promise.resolve()]);
      notificar("success", isActive ? `“${name}” inativado. Marque “Mostrar inativos” para vê-lo na lista.` : `“${name}” reativado.`);
    } catch (erro) {
      notificar("error", mensagemDe(erro, isActive ? "Não foi possível inativar o prato." : "Não foi possível reativar o prato."));
    }
  }

  const pratosDaLista = useMemo(() => ordenarPratos(filtrarPratos(pratos, filtro), ordem), [pratos, filtro, ordem]);
  // A barra de andamento é sempre dos ativos; os chips acompanham a lista (inclui inativos se ligado).
  const contagemDosAtivos = useMemo(() => contarPorSituacao(pratos), [pratos]);
  const contagemDosChips = useMemo(() => contarPorSituacao(pratos, filtro.mostrarInativos), [pratos, filtro.mostrarInativos]);

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
          onCancelar={cancelarEditor}
          onSalvo={(id, modo) => void aoSalvar(id, modo)}
          onAlterado={setAlterado}
          notificar={notificar}
        />
      );
    }

    if (selecionadoId && !detalheDoSelecionado) return <p className="ft-carregando" role="status">Carregando a ficha…</p>;

    if (detalheDoSelecionado) {
      return (
        <DetalheDoPrato
          prato={detalheDoSelecionado}
          canEdit={canEdit}
          onEditar={() => abrirEditor("editar", detalheDoSelecionado)}
          onCopiar={() => abrirEditor("copia", detalheDoSelecionado)}
          onAlternarAtivo={() => void alternarAtivo()}
          onFechar={voltar}
        />
      );
    }

    const semFicha = contagemDosAtivos["sem-ficha"];
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

      <Tabs
        value={aba}
        onChange={trocarAba}
        tabs={[
          { value: "fichas", label: "Fichas técnicas" },
          { value: "categorias", label: "Categorias de pratos" }
        ]}
      />

      {erroDeCarga && (
        <Alert tone="error" title="Não foi possível carregar">
          {erroDeCarga}{" "}
          <button type="button" className="ft-link" onClick={() => void carregar()}>Tentar de novo</button>
        </Alert>
      )}

      {aba === "categorias" ? (
        <Categorias categorias={categorias} canEdit={canEdit} onSalvo={() => void carregar()} notificar={notificar} />
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
              contagemDosAtivos={contagemDosAtivos}
              contagemDosChips={contagemDosChips}
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
            />
          }
          detail={<div ref={revelarRef} className="scroll-target ft-painel">{renderizarPainel()}</div>}
        />
      )}
    </div>
  );
}
