import { RefreshCw, X } from "lucide-react";
import type React from "react";
import { DRECategoryOptions } from "../components/DRECategoryOptions";
import { useEffect, useRef, useState } from "react";
import {
  bulkPatchSmallExpenseTypes,
  Category,
  DRECategory,
  ExpenseTypeMaster,
  getCategories,
  getDRECategories,
  getExpenseTypes,
  getSectors,
  getSmallExpenseTypes,
  getSubcategories,
  getUnits,
  NATUREZA_GERENCIAL_LABELS,
  NaturezaGerencial,
  saveCategory,
  saveExpenseType,
  saveSector,
  saveSmallExpenseType,
  saveSubcategory,
  saveUnit,
  setCategoryStatus,
  setExpenseTypeStatus,
  setSectorStatus,
  setSmallExpenseTypeStatus,
  setSubcategoryStatus,
  setUnitStatus,
  SmallExpenseType,
  Subcategory,
  UnitMeasure,
  InventorySector
} from "../api/client";
import { Notice, NoticeTone, useNotice } from "../components/Notice";

type Mode = "sectors" | "categories" | "subcategories" | "units" | "expense-types" | "small-expense-types";
type Notify = (tone: NoticeTone, message: string) => void;

const modes: Array<{ id: Mode; label: string }> = [
  { id: "sectors", label: "Setores" },
  { id: "categories", label: "Categorias" },
  { id: "subcategories", label: "Subcategorias" },
  { id: "units", label: "Unidades" },
  { id: "expense-types", label: "Tipos de gasto" },
  { id: "small-expense-types", label: "Pequenos gastos" }
];

export function MasterData() {
  const [mode, setMode] = useState<Mode>("categories");
  const { notice, setNotice } = useNotice();
  const notify: Notify = (tone, message) => setNotice({ tone, message });

  return (
    <div className="stack">
      <Notice notice={notice} />

      <div className="tabs-row">
        {modes.map((item) => (
          <button
            className={mode === item.id ? "active" : ""}
            key={item.id}
            type="button"
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === "sectors" && <SectorsPanel notify={notify} />}
      {mode === "categories" && <CategoriesPanel notify={notify} />}
      {mode === "subcategories" && <SubcategoriesPanel notify={notify} />}
      {mode === "units" && <UnitsPanel notify={notify} />}
      {mode === "expense-types" && <ExpenseTypesPanel notify={notify} />}
      {mode === "small-expense-types" && <SmallExpenseTypesPanel notify={notify} />}
    </div>
  );
}

function SectorsPanel({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<InventorySector[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ id: "", name: "", description: "", countOrder: 0, notes: "", isActive: true });

  async function load() {
    setRows(await getSectors(search));
  }

  async function submit() {
    if (!form.name.trim()) return;
    const isUpdate = Boolean(form.id);
    try {
      await saveSector(form);
      setForm({ id: "", name: "", description: "", countOrder: 0, notes: "", isActive: true });
      await load();
      notify("success", isUpdate ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso.");
    } catch {
      notify("error", "Erro ao salvar.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <CrudPanel
      title="Setores de estoque"
      search={search}
      setSearch={setSearch}
      load={load}
      form={
        <div className="form-grid">
          <Text label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Text label="Descricao" value={form.description} onChange={(description) => setForm({ ...form, description })} />
          <label>Ordem de contagem<input type="number" value={form.countOrder} onChange={(event) => setForm({ ...form, countOrder: Number(event.target.value) })} /></label>
          <Text label="Observacoes" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          <Active checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} />
          <button className="primary-button" type="button" onClick={submit}>{form.id ? "Salvar" : "Cadastrar"}</button>
        </div>
      }
      table={
        <Table headers={["Status", "Ordem", "Nome", "Normalizado", "Descricao", "Observacoes", "Acoes"]}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.isActive ? "Ativo" : "Inativo"}</td>
              <td>{row.countOrder}</td>
              <td>{row.name}</td>
              <td>{row.normalizedName}</td>
              <td>{row.description ?? "-"}</td>
              <td>{row.notes ?? "-"}</td>
              <td className="actions-cell">
                <button type="button" onClick={() => setForm({ id: row.id, name: row.name, description: row.description ?? "", countOrder: row.countOrder, notes: row.notes ?? "", isActive: row.isActive })}>Editar</button>
                <button type="button" onClick={async () => { try { await setSectorStatus(row.id, !row.isActive); await load(); notify("success", row.isActive ? "Cadastro inativado com sucesso." : "Cadastro reativado com sucesso."); } catch { notify("error", "Erro ao salvar."); } }}>{row.isActive ? "Inativar" : "Reativar"}</button>
              </td>
            </tr>
          ))}
        </Table>
      }
    />
  );
}

function CategoriesPanel({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ id: "", name: "", mainGroup: "", notes: "", isActive: true });

  async function load() {
    setRows(await getCategories(search));
  }

  async function submit() {
    if (!form.name.trim()) return;
    const isUpdate = Boolean(form.id);
    try {
      await saveCategory(form);
      setForm({ id: "", name: "", mainGroup: "", notes: "", isActive: true });
      await load();
      notify("success", isUpdate ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso.");
    } catch {
      notify("error", "Erro ao salvar.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <CrudPanel
      title="Categorias"
      search={search}
      setSearch={setSearch}
      load={load}
      form={
        <div className="form-grid">
          <Text label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Text label="Grupo principal" value={form.mainGroup} onChange={(mainGroup) => setForm({ ...form, mainGroup })} />
          <Text label="Observacoes" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          <Active checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} />
          <button className="primary-button" type="button" onClick={submit}>{form.id ? "Salvar" : "Cadastrar"}</button>
        </div>
      }
      table={
        <Table headers={["Status", "Nome", "Grupo", "Observacoes", "Acoes"]}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.isActive ? "Ativo" : "Inativo"}</td>
              <td>{row.name}</td>
              <td>{row.mainGroup ?? "-"}</td>
              <td>{row.notes ?? "-"}</td>
              <td className="actions-cell">
                <button type="button" onClick={() => setForm({ id: row.id, name: row.name, mainGroup: row.mainGroup ?? "", notes: row.notes ?? "", isActive: row.isActive })}>Editar</button>
                <button type="button" onClick={async () => { try { await setCategoryStatus(row.id, !row.isActive); await load(); notify("success", row.isActive ? "Cadastro inativado com sucesso." : "Cadastro reativado com sucesso."); } catch { notify("error", "Erro ao salvar."); } }}>{row.isActive ? "Inativar" : "Reativar"}</button>
              </td>
            </tr>
          ))}
        </Table>
      }
    />
  );
}

function SubcategoriesPanel({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<Subcategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ id: "", name: "", categoryId: "", notes: "", isActive: true });

  async function load() {
    const [subcategories, categoryRows] = await Promise.all([getSubcategories(search), getCategories()]);
    setRows(subcategories);
    setCategories(categoryRows);
    if (!form.categoryId && categoryRows[0]) setForm((current) => ({ ...current, categoryId: categoryRows[0].id }));
  }

  async function submit() {
    if (!form.name.trim() || !form.categoryId) return;
    const isUpdate = Boolean(form.id);
    try {
      await saveSubcategory(form);
      setForm({ id: "", name: "", categoryId: categories[0]?.id ?? "", notes: "", isActive: true });
      await load();
      notify("success", isUpdate ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso.");
    } catch {
      notify("error", "Erro ao salvar.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <CrudPanel
      title="Subcategorias"
      search={search}
      setSearch={setSearch}
      load={load}
      form={
        <div className="form-grid">
          <Text label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <label>Categoria<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <Text label="Observacoes" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          <Active checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} />
          <button className="primary-button" type="button" onClick={submit}>{form.id ? "Salvar" : "Cadastrar"}</button>
        </div>
      }
      table={
        <Table headers={["Status", "Nome", "Categoria", "Observacoes", "Acoes"]}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.isActive ? "Ativo" : "Inativo"}</td>
              <td>{row.name}</td>
              <td>{row.category?.name ?? "-"}</td>
              <td>{row.notes ?? "-"}</td>
              <td className="actions-cell">
                <button type="button" onClick={() => setForm({ id: row.id, name: row.name, categoryId: row.categoryId, notes: row.notes ?? "", isActive: row.isActive })}>Editar</button>
                <button type="button" onClick={async () => { try { await setSubcategoryStatus(row.id, !row.isActive); await load(); notify("success", row.isActive ? "Cadastro inativado com sucesso." : "Cadastro reativado com sucesso."); } catch { notify("error", "Erro ao salvar."); } }}>{row.isActive ? "Inativar" : "Reativar"}</button>
              </td>
            </tr>
          ))}
        </Table>
      }
    />
  );
}

function UnitsPanel({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<UnitMeasure[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ id: "", code: "", name: "", type: "", notes: "", isActive: true });
  async function load() { setRows(await getUnits(search)); }
  async function submit() {
    if (!form.code.trim() || !form.name.trim()) return;
    const isUpdate = Boolean(form.id);
    try {
      await saveUnit(form);
      setForm({ id: "", code: "", name: "", type: "", notes: "", isActive: true });
      await load();
      notify("success", isUpdate ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso.");
    } catch {
      notify("error", "Erro ao salvar.");
    }
  }
  useEffect(() => { load(); }, []);
  return (
    <CrudPanel title="Unidades de medida" search={search} setSearch={setSearch} load={load}
      form={<div className="form-grid"><Text label="Sigla" value={form.code} onChange={(code) => setForm({ ...form, code })} /><Text label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} /><Text label="Tipo" value={form.type} onChange={(type) => setForm({ ...form, type })} /><Text label="Observacoes" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} /><Active checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} /><button className="primary-button" type="button" onClick={submit}>{form.id ? "Salvar" : "Cadastrar"}</button></div>}
      table={<Table headers={["Status", "Sigla", "Nome", "Tipo", "Observacoes", "Acoes"]}>{rows.map((row) => <tr key={row.id}><td>{row.isActive ? "Ativo" : "Inativo"}</td><td>{row.code}</td><td>{row.name}</td><td>{row.type ?? "-"}</td><td>{row.notes ?? "-"}</td><td className="actions-cell"><button type="button" onClick={() => setForm({ id: row.id, code: row.code, name: row.name, type: row.type ?? "", notes: row.notes ?? "", isActive: row.isActive })}>Editar</button><button type="button" onClick={async () => { try { await setUnitStatus(row.id, !row.isActive); await load(); notify("success", row.isActive ? "Cadastro inativado com sucesso." : "Cadastro reativado com sucesso."); } catch { notify("error", "Erro ao salvar."); } }}>{row.isActive ? "Inativar" : "Reativar"}</button></td></tr>)}</Table>}
    />
  );
}

function ExpenseTypesPanel({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<ExpenseTypeMaster[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ id: "", name: "", group: "", notes: "", isActive: true });
  async function load() { setRows(await getExpenseTypes(search)); }
  async function submit() {
    if (!form.name.trim()) return;
    const isUpdate = Boolean(form.id);
    try {
      await saveExpenseType(form);
      setForm({ id: "", name: "", group: "", notes: "", isActive: true });
      await load();
      notify("success", isUpdate ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso.");
    } catch {
      notify("error", "Erro ao salvar.");
    }
  }
  useEffect(() => { load(); }, []);
  return (
    <CrudPanel title="Tipos de gasto" search={search} setSearch={setSearch} load={load}
      form={<div className="form-grid"><Text label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} /><Text label="Grupo" value={form.group} onChange={(group) => setForm({ ...form, group })} /><Text label="Observacoes" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} /><Active checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} /><button className="primary-button" type="button" onClick={submit}>{form.id ? "Salvar" : "Cadastrar"}</button></div>}
      table={<Table headers={["Status", "Nome", "Normalizado", "Grupo", "Observacoes", "Acoes"]}>{rows.map((row) => <tr key={row.id}><td>{row.isActive ? "Ativo" : "Inativo"}</td><td>{row.name}</td><td>{row.normalizedName}</td><td>{row.group ?? "-"}</td><td>{row.notes ?? "-"}</td><td className="actions-cell"><button type="button" onClick={() => setForm({ id: row.id, name: row.name, group: row.group ?? "", notes: row.notes ?? "", isActive: row.isActive })}>Editar</button><button type="button" onClick={async () => { try { await setExpenseTypeStatus(row.id, !row.isActive); await load(); notify("success", row.isActive ? "Cadastro inativado com sucesso." : "Cadastro reativado com sucesso."); } catch { notify("error", "Erro ao salvar."); } }}>{row.isActive ? "Inativar" : "Reativar"}</button></td></tr>)}</Table>}
    />
  );
}

function SmallExpenseTypesPanel({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<SmallExpenseType[]>([]);
  const [dreCategories, setDreCategories] = useState<DRECategory[]>([]);
  const [search, setSearch] = useState("");
  const [filterNatureza, setFilterNatureza] = useState<NaturezaGerencial | "">("");
  const [filterSemCategoria, setFilterSemCategoria] = useState(false);
  const [filterSemNatureza, setFilterSemNatureza] = useState(false);

  // edits: rowId → campos editáveis inline
  const [edits, setEdits] = useState<Record<string, { naturezaGerencial: string; suggestedDreCategoryId: string }>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [savedFlash, setSavedFlash] = useState<Set<string>>(new Set());
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // seleção em lote
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNatureza, setBulkNatureza] = useState<NaturezaGerencial | "">("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  async function load() {
    const [types, cats] = await Promise.all([
      getSmallExpenseTypes(search || undefined),
      dreCategories.length === 0 ? getDRECategories(true) : Promise.resolve(dreCategories),
    ]);
    setRows(types);
    if (dreCategories.length === 0) setDreCategories(cats);
    setEdits((prev) => {
      const next: typeof prev = {};
      for (const t of types) {
        next[t.id] = prev[t.id] ?? {
          naturezaGerencial: t.naturezaGerencial ?? "",
          suggestedDreCategoryId: t.suggestedDreCategoryId ?? "",
        };
      }
      return next;
    });
  }

  function flashRow(id: string) {
    if (flashTimers.current[id]) clearTimeout(flashTimers.current[id]);
    setSavedFlash((prev) => new Set([...prev, id]));
    flashTimers.current[id] = setTimeout(() => {
      setSavedFlash((prev) => { const n = new Set(prev); n.delete(id); return n; });
      delete flashTimers.current[id];
    }, 1500);
  }

  async function saveLine(row: SmallExpenseType) {
    const edit = edits[row.id];
    if (!edit) return;
    setSaving((prev) => new Set([...prev, row.id]));
    try {
      const updated = await saveSmallExpenseType({
        id: row.id,
        name: row.name,
        group: row.group ?? "",
        notes: row.notes ?? "",
        isActive: row.isActive,
        suggestedDreCategoryId: edit.suggestedDreCategoryId || null,
        naturezaGerencial: (edit.naturezaGerencial || null) as NaturezaGerencial | null,
      });
      setRows((prev) => prev.map((r) => r.id === row.id ? updated : r));
      setEdits((prev) => ({
        ...prev,
        [row.id]: {
          naturezaGerencial: updated.naturezaGerencial ?? "",
          suggestedDreCategoryId: updated.suggestedDreCategoryId ?? "",
        },
      }));
      flashRow(row.id);
    } catch {
      notify("error", "Erro ao salvar.");
    } finally {
      setSaving((prev) => { const n = new Set(prev); n.delete(row.id); return n; });
    }
  }

  async function applyBulk() {
    if (!bulkNatureza && !bulkCategoryId) return;
    setBulkSaving(true);
    try {
      const result = await bulkPatchSmallExpenseTypes({
        ids: [...selected],
        naturezaGerencial: bulkNatureza || null,
        suggestedDreCategoryId: bulkCategoryId || null,
      });
      setShowBulkConfirm(false);
      setSelected(new Set());
      setBulkNatureza("");
      setBulkCategoryId("");
      notify("success", `${result.updated} tipo(s) atualizados.`);
      await load();
    } catch {
      notify("error", "Erro ao aplicar em lote.");
    } finally {
      setBulkSaving(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // filtros locais (pós-load)
  const filtered = rows.filter((row) => {
    const nat = row.naturezaGerencial ?? "";
    const cat = row.suggestedDreCategoryId ?? "";
    if (filterNatureza && nat !== filterNatureza) return false;
    if (filterSemCategoria && cat) return false;
    if (filterSemNatureza && nat) return false;
    return true;
  });

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  return (
    <div className="stack">
      {/* Filtros */}
      <section className="panel">
        <div className="section-heading">
          <div><p>Tabela mestre</p><h2>Tipos de pequenos gastos</h2></div>
          <button className="icon-button" type="button" onClick={load} aria-label="Atualizar"><RefreshCw size={18} /></button>
        </div>
        <div className="filters-row">
          <label>
            Busca
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Nome do tipo..."
            />
          </label>
          <label>
            Natureza
            <select value={filterNatureza} onChange={(e) => setFilterNatureza(e.target.value as NaturezaGerencial | "")}>
              <option value="">— Todas —</option>
              {(Object.entries(NATUREZA_GERENCIAL_LABELS) as [NaturezaGerencial, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={filterSemCategoria} onChange={(e) => setFilterSemCategoria(e.target.checked)} />
            Sem Categoria DRE
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={filterSemNatureza} onChange={(e) => setFilterSemNatureza(e.target.checked)} />
            Sem Natureza
          </label>
          <button className="primary-button" type="button" onClick={load}>Filtrar</button>
        </div>
      </section>

      {/* Barra de ações em lote */}
      {selected.size > 0 && (
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-surface-raised, #1e293b)",
          border: "1px solid var(--color-border, #334155)",
          borderRadius: "8px", padding: "0.75rem 1rem",
          display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap",
        }}>
          <strong style={{ whiteSpace: "nowrap" }}>{selected.size} selecionado(s)</strong>
          <select
            value={bulkNatureza}
            onChange={(e) => setBulkNatureza(e.target.value as NaturezaGerencial | "")}
            style={{ minWidth: "200px" }}
          >
            <option value="">— Natureza (manter) —</option>
            {(Object.entries(NATUREZA_GERENCIAL_LABELS) as [NaturezaGerencial, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
            style={{ minWidth: "220px" }}
          >
            <option value="">— Categoria DRE (manter) —</option>
            <DRECategoryOptions categories={dreCategories} />
          </select>
          <button
            className="primary-button"
            type="button"
            disabled={!bulkNatureza && !bulkCategoryId}
            onClick={() => setShowBulkConfirm(true)}
          >
            Aplicar em lote
          </button>
          <button
            type="button"
            style={{ marginLeft: "auto" }}
            onClick={() => { setSelected(new Set()); setBulkNatureza(""); setBulkCategoryId(""); }}
            title="Cancelar seleção"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Modal de confirmação em lote */}
      {showBulkConfirm && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => !bulkSaving && setShowBulkConfirm(false)}
        >
          <div
            style={{
              background: "var(--color-surface, #0f172a)",
              border: "1px solid var(--color-border, #334155)",
              borderRadius: "12px", padding: "1.5rem", maxWidth: "420px", width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Confirmar aplicação em lote</h3>
            <p>Aplicar para <strong>{selected.size}</strong> tipo(s) selecionado(s)?</p>
            {bulkNatureza && (
              <p style={{ margin: "0.25rem 0" }}>
                Natureza: <strong>{NATUREZA_GERENCIAL_LABELS[bulkNatureza]}</strong>
              </p>
            )}
            {bulkCategoryId && (
              <p style={{ margin: "0.25rem 0" }}>
                Categoria DRE: <strong>{dreCategories.find((c) => c.id === bulkCategoryId)?.name}</strong>
              </p>
            )}
            <div className="actions-cell" style={{ marginTop: "1.25rem" }}>
              <button className="primary-button" type="button" onClick={applyBulk} disabled={bulkSaving}>
                {bulkSaving ? "Salvando..." : "Confirmar"}
              </button>
              <button type="button" onClick={() => setShowBulkConfirm(false)} disabled={bulkSaving}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabela com edição inline */}
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "2rem" }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    title="Selecionar todos visíveis"
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(filtered.map((r) => r.id)));
                      else setSelected(new Set());
                    }}
                  />
                </th>
                <th>Nome</th>
                <th>Natureza gerencial</th>
                <th>Categoria DRE padrão</th>
                <th style={{ width: "3rem" }}>Ativo</th>
                <th style={{ width: "5rem" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const edit = edits[row.id] ?? { naturezaGerencial: "", suggestedDreCategoryId: "" };
                const isSaving = saving.has(row.id);
                const isSaved = savedFlash.has(row.id);
                const isDirty =
                  edit.naturezaGerencial !== (row.naturezaGerencial ?? "") ||
                  edit.suggestedDreCategoryId !== (row.suggestedDreCategoryId ?? "");

                return (
                  <tr
                    key={row.id}
                    style={isSaved ? { backgroundColor: "var(--color-success-muted, rgba(34,197,94,0.12))", transition: "background-color 0.3s" } : { transition: "background-color 0.6s" }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(row.id); else next.delete(row.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td style={{ fontWeight: 500 }}>{row.name}</td>
                    <td>
                      <select
                        value={edit.naturezaGerencial}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [row.id]: { ...edit, naturezaGerencial: e.target.value } }))}
                        style={{ width: "100%" }}
                      >
                        <option value="">— Não definida —</option>
                        {(Object.entries(NATUREZA_GERENCIAL_LABELS) as [NaturezaGerencial, string][]).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={edit.suggestedDreCategoryId}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [row.id]: { ...edit, suggestedDreCategoryId: e.target.value } }))}
                        style={{ width: "100%" }}
                      >
                        <option value="">— Nenhuma —</option>
                        <DRECategoryOptions categories={dreCategories} />
                      </select>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={row.isActive}
                        title={row.isActive ? "Ativo — clique para inativar" : "Inativo — clique para reativar"}
                        onChange={async () => {
                          try {
                            await setSmallExpenseTypeStatus(row.id, !row.isActive);
                            setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, isActive: !r.isActive } : r));
                            notify("success", row.isActive ? "Inativado." : "Reativado.");
                          } catch {
                            notify("error", "Erro ao alterar status.");
                          }
                        }}
                      />
                    </td>
                    <td className="actions-cell">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={isSaving || !isDirty}
                        onClick={() => saveLine(row)}
                        title={!isDirty ? "Sem alterações" : "Salvar"}
                      >
                        {isSaving ? "…" : "Salvar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "1.5rem" }}>Nenhum tipo encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CrudPanel({ title, search, setSearch, load, form, table }: { title: string; search: string; setSearch: (value: string) => void; load: () => void; form: React.ReactNode; table: React.ReactNode }) {
  return <div className="stack"><section className="panel"><div className="section-heading"><div><p>Tabela mestre</p><h2>{title}</h2></div></div>{form}</section><section className="panel"><div className="section-heading"><div><p>Lista</p><h2>{title}</h2></div><button className="icon-button" type="button" onClick={load} aria-label="Atualizar"><RefreshCw size={18} /></button></div><div className="filters-row"><label>Busca<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="primary-button" type="button" onClick={load}>Filtrar</button></div><div className="table-wrap">{table}</div></section></div>;
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table>;
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label>{label}<input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Active({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="checkbox-label"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />Ativo</label>;
}
