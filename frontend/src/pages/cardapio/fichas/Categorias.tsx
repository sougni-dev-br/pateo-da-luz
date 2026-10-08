import { CornerDownRight, Pencil, Plus } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { saveDishCategory, type DishCategory, type DishListItem, type DishMenu } from "../../../api/client";
import { Button, EmptyState, FormField, FormGrid, IconButton, Select, StatusBadge, Switch, TextField } from "../../../design-system";
import { DESCRICAO_DO_CARDAPIO, ROTULO_DO_CARDAPIO, montarArvore, type FiltroDeCardapio } from "../../../lib/categoriasDasFichas";

type Props = {
  categorias: DishCategory[];
  pratos: DishListItem[];
  /** O cardápio escolhido no alto da tela: filtra a árvore e vira o padrão da categoria nova. */
  filtroDeCardapio: FiltroDeCardapio;
  canEdit: boolean;
  onSalvo: () => void;
  notificar: (tom: "success" | "error", mensagem: string) => void;
};

type Rascunho = { id: string; name: string; parentId: string; menu: DishMenu; sortOrder: string; notes: string };

const rascunhoVazio = (menu: DishMenu): Rascunho => ({ id: "", name: "", parentId: "", menu, sortOrder: "0", notes: "" });

export function Categorias({ categorias, pratos, filtroDeCardapio, canEdit, onSalvo, notificar }: Props) {
  const menuPadrao: DishMenu = filtroDeCardapio === "DELIVERY" ? "DELIVERY" : "CARDAPIO";
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoVazio(menuPadrao));
  const [erroDoNome, setErroDoNome] = useState<string | undefined>();
  const [salvando, setSalvando] = useState(false);
  const editando = rascunho.id !== "";

  const arvore = useMemo(() => montarArvore(categorias, pratos, filtroDeCardapio), [categorias, pratos, filtroDeCardapio]);
  // Quem pode ser "categoria principal" de outra: principal do mesmo cardápio e que não seja ela mesma
  // nem tenha subcategorias (virar subcategoria dessa daria três níveis).
  const possiveisPais = categorias
    .filter((categoria) => !categoria.parentId && categoria.menu === rascunho.menu && categoria.id !== rascunho.id && categoria.isActive)
    .filter(() => !(editando && categorias.some((filha) => filha.parentId === rascunho.id)));
  const pai = categorias.find((categoria) => categoria.id === rascunho.parentId);

  function alterar(campo: keyof Rascunho, valor: string) {
    setRascunho((anterior) => ({ ...anterior, [campo]: valor }));
    if (campo === "name") setErroDoNome(undefined);
  }

  function cancelarEdicao() {
    setRascunho(rascunhoVazio(menuPadrao));
    setErroDoNome(undefined);
  }

  function focarNome() {
    window.setTimeout(() => document.getElementById("ft-categoria-nome")?.focus(), 0);
  }

  async function salvar() {
    if (!rascunho.name.trim()) {
      setErroDoNome("Informe o nome da categoria.");
      focarNome();
      return;
    }

    setSalvando(true);
    try {
      const existente = categorias.find((categoria) => categoria.id === rascunho.id);
      await saveDishCategory({
        id: rascunho.id || undefined,
        name: rascunho.name.trim(),
        parentId: rascunho.parentId || null,
        menu: pai?.menu ?? rascunho.menu,
        sortOrder: Number(rascunho.sortOrder) || 0,
        notes: rascunho.notes.trim() || null,
        // Sem isto a edição reativava a categoria sem ninguém pedir.
        ...(existente ? { isActive: existente.isActive } : {})
      });
      notificar("success", editando ? "Categoria atualizada." : rascunho.parentId ? "Subcategoria criada." : "Categoria criada.");
      cancelarEdicao();
      onSalvo();
    } catch (erro) {
      notificar("error", erro instanceof Error ? erro.message : "Não foi possível salvar a categoria.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtiva(categoria: DishCategory) {
    try {
      await saveDishCategory({
        id: categoria.id,
        name: categoria.name,
        parentId: categoria.parentId,
        menu: categoria.menu,
        sortOrder: categoria.sortOrder,
        notes: categoria.notes,
        isActive: !categoria.isActive
      });
      notificar("success", categoria.isActive ? `“${categoria.name}” desativada. Os pratos dela continuam como estão.` : `“${categoria.name}” ativada.`);
      onSalvo();
    } catch (erro) {
      notificar("error", erro instanceof Error ? erro.message : "Não foi possível alterar a categoria.");
    }
  }

  function editar(categoria: DishCategory) {
    setRascunho({ id: categoria.id, name: categoria.name, parentId: categoria.parentId ?? "", menu: categoria.menu, sortOrder: String(categoria.sortOrder), notes: categoria.notes ?? "" });
    setErroDoNome(undefined);
    focarNome();
  }

  function novaSubcategoria(principal: DishCategory) {
    setRascunho({ ...rascunhoVazio(principal.menu), parentId: principal.id });
    setErroDoNome(undefined);
    focarNome();
  }

  function linha(categoria: DishCategory, pratosAtivos: number, filha: boolean) {
    return (
      <tr key={categoria.id} className={`${categoria.isActive ? "" : "ft-linha-inativa"}${filha ? " ft-linha-filha" : ""}`.trim() || undefined}>
        <th scope="row" data-rotulo="Categoria">{categoria.name}</th>
        <td data-rotulo="Cardápio">
          <span className={`ft-etiqueta-cardapio${categoria.menu === "DELIVERY" ? " ft-etiqueta-cardapio--delivery" : ""}`}>{ROTULO_DO_CARDAPIO[categoria.menu]}</span>
        </td>
        <td className="ft-num" data-rotulo="Pratos ativos">{pratosAtivos}</td>
        <td data-rotulo="Situação">
          {canEdit ? (
            <span className="ft-situacao">
              <Switch checked={categoria.isActive} onChange={() => void alternarAtiva(categoria)} label={`Categoria ${categoria.name} ativa`} />
              {categoria.isActive ? "Ativa" : "Inativa"}
            </span>
          ) : (
            <StatusBadge tone={categoria.isActive ? "success" : "neutral"}>{categoria.isActive ? "Ativa" : "Inativa"}</StatusBadge>
          )}
        </td>
        {canEdit && (
          <td className="ft-acoes-celula">
            {!filha && (
              <IconButton icon={<CornerDownRight size={16} aria-hidden />} label={`Nova subcategoria de ${categoria.name}`} size="sm" onClick={() => novaSubcategoria(categoria)} />
            )}
            <IconButton icon={<Pencil size={16} aria-hidden />} label={`Editar categoria ${categoria.name}`} size="sm" onClick={() => editar(categoria)} />
          </td>
        )}
      </tr>
    );
  }

  return (
    <div className="ft-categorias">
      {canEdit && (
        <form className="ft-bloco" noValidate onSubmit={(evento) => { evento.preventDefault(); void salvar(); }}>
          <h3 className="ft-secao-titulo">{editando ? "Editar categoria" : rascunho.parentId ? "Nova subcategoria" : "Nova categoria"}</h3>
          <FormGrid cols={3}>
            <FormField label="Nome" required error={erroDoNome}>
              <TextField id="ft-categoria-nome" required value={rascunho.name} onChange={(evento) => alterar("name", evento.target.value)} placeholder="Ex.: Massas" maxLength={60} />
            </FormField>
            <FormField label="Cardápio" hint={pai ? "A subcategoria segue o cardápio da principal." : undefined}>
              <Select
                value={pai?.menu ?? rascunho.menu}
                disabled={Boolean(pai)}
                onChange={(evento) => setRascunho((anterior) => ({ ...anterior, menu: evento.target.value as DishMenu, parentId: "" }))}
                options={(["CARDAPIO", "DELIVERY"] as const).map((valor) => ({ value: valor, label: `${ROTULO_DO_CARDAPIO[valor]} — ${DESCRICAO_DO_CARDAPIO[valor].toLowerCase()}` }))}
              />
            </FormField>
            <FormField label="Dentro de" hint="Deixe em branco para uma categoria principal. Só há dois níveis.">
              <Select
                value={rascunho.parentId}
                onChange={(evento) => alterar("parentId", evento.target.value)}
                placeholder="Nenhuma — é principal"
                options={possiveisPais.map((categoria) => ({ value: categoria.id, label: categoria.name }))}
              />
            </FormField>
            <FormField label="Ordem" hint="Menor aparece primeiro.">
              <TextField type="number" inputMode="numeric" value={rascunho.sortOrder} onChange={(evento) => alterar("sortOrder", evento.target.value)} />
            </FormField>
            <FormField label="Observações">
              <TextField value={rascunho.notes} onChange={(evento) => alterar("notes", evento.target.value)} maxLength={200} />
            </FormField>
          </FormGrid>
          <div className="ft-form-acoes ft-form-acoes--inicio">
            <Button type="submit" disabled={salvando} leadingIcon={editando ? undefined : <Plus size={16} aria-hidden />}>
              {salvando ? "Salvando…" : editando ? "Salvar alterações" : rascunho.parentId ? "Criar subcategoria" : "Criar categoria"}
            </Button>
            {(editando || rascunho.parentId || rascunho.name) && <Button variant="secondary" onClick={cancelarEdicao} disabled={salvando}>Cancelar</Button>}
          </div>
        </form>
      )}

      {arvore.length === 0 ? (
        <EmptyState
          title="Nenhuma categoria neste cardápio ainda."
          description="Categorias e subcategorias organizam os pratos na lista, nos filtros e no painel. Cada cardápio (salão e delivery) tem as suas."
        />
      ) : (
        <div className="ft-tabela-rolagem">
          <table className="ft-tabela ft-arvore">
            <thead>
              <tr>
                <th scope="col">Categoria</th>
                <th scope="col">Cardápio</th>
                <th scope="col" className="ft-num">Pratos ativos</th>
                <th scope="col">Situação</th>
                {canEdit && <th scope="col"><span className="ft-so-leitor">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {arvore.map((no) => (
                <Fragment key={no.categoria.id}>
                  {linha(no.categoria, no.pratosTotal, false)}
                  {no.filhas.map((filha) => linha(filha, no.pratosPorFilha[filha.id] ?? 0, true))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
