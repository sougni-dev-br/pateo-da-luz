import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { saveDishCategory, type DishCategory } from "../../../api/client";
import { Button, EmptyState, FormField, FormGrid, IconButton, StatusBadge, Switch, TextField } from "../../../design-system";

type Props = {
  categorias: DishCategory[];
  canEdit: boolean;
  onSalvo: () => void;
  notificar: (tom: "success" | "error", mensagem: string) => void;
};

type Rascunho = { id: string; name: string; sortOrder: string; notes: string };

const RASCUNHO_VAZIO: Rascunho = { id: "", name: "", sortOrder: "0", notes: "" };

export function Categorias({ categorias, canEdit, onSalvo, notificar }: Props) {
  const [rascunho, setRascunho] = useState<Rascunho>(RASCUNHO_VAZIO);
  const [erroDoNome, setErroDoNome] = useState<string | undefined>();
  const [salvando, setSalvando] = useState(false);
  const editando = rascunho.id !== "";

  function alterar(campo: keyof Rascunho, valor: string) {
    setRascunho((anterior) => ({ ...anterior, [campo]: valor }));
    if (campo === "name") setErroDoNome(undefined);
  }

  function cancelarEdicao() {
    setRascunho(RASCUNHO_VAZIO);
    setErroDoNome(undefined);
  }

  async function salvar() {
    if (!rascunho.name.trim()) {
      setErroDoNome("Informe o nome da categoria.");
      document.getElementById("ft-categoria-nome")?.focus();
      return;
    }

    setSalvando(true);
    try {
      const existente = categorias.find((categoria) => categoria.id === rascunho.id);
      await saveDishCategory({
        id: rascunho.id || undefined,
        name: rascunho.name.trim(),
        sortOrder: Number(rascunho.sortOrder) || 0,
        notes: rascunho.notes.trim() || null,
        // Sem isto a edição reativava a categoria sem ninguém pedir.
        ...(existente ? { isActive: existente.isActive } : {})
      });
      notificar("success", editando ? "Categoria atualizada." : "Categoria criada.");
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

  return (
    <div className="ft-categorias">
      {canEdit && (
        <form className="ft-bloco" noValidate onSubmit={(evento) => { evento.preventDefault(); void salvar(); }}>
          <h3 className="ft-secao-titulo">{editando ? "Editar categoria" : "Nova categoria"}</h3>
          <FormGrid cols={3}>
            <FormField label="Nome" required error={erroDoNome}>
              <TextField id="ft-categoria-nome" required value={rascunho.name} onChange={(evento) => alterar("name", evento.target.value)} placeholder="Ex.: Prato principal" maxLength={60} />
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
              {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Criar categoria"}
            </Button>
            {editando && <Button variant="secondary" onClick={cancelarEdicao} disabled={salvando}>Cancelar edição</Button>}
          </div>
        </form>
      )}

      {categorias.length === 0 ? (
        <EmptyState title="Nenhuma categoria ainda." description="Categorias agrupam os pratos na lista e nos filtros." />
      ) : (
        <div className="ft-tabela-rolagem">
          <table className="ft-tabela">
            <thead>
              <tr>
                <th scope="col">Categoria</th>
                <th scope="col" className="ft-num">Ordem</th>
                <th scope="col" className="ft-num">Pratos ativos</th>
                <th scope="col">Situação</th>
                <th scope="col">Observações</th>
                {canEdit && <th scope="col"><span className="ft-so-leitor">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {categorias.map((categoria) => (
                <tr key={categoria.id} className={categoria.isActive ? undefined : "ft-linha-inativa"}>
                  <th scope="row" data-rotulo="Categoria">{categoria.name}</th>
                  <td className="ft-num" data-rotulo="Ordem">{categoria.sortOrder}</td>
                  <td className="ft-num" data-rotulo="Pratos ativos">{categoria.dishesCount ?? "—"}</td>
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
                  <td data-rotulo="Observações" className="ft-muted">{categoria.notes ?? "—"}</td>
                  {canEdit && (
                    <td className="ft-acoes-celula">
                      <IconButton
                        icon={<Pencil size={16} aria-hidden />}
                        label={`Editar categoria ${categoria.name}`}
                        size="sm"
                        onClick={() => {
                          setRascunho({ id: categoria.id, name: categoria.name, sortOrder: String(categoria.sortOrder), notes: categoria.notes ?? "" });
                          setErroDoNome(undefined);
                          window.setTimeout(() => document.getElementById("ft-categoria-nome")?.focus(), 0);
                        }}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
