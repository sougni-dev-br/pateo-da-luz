import { RefreshCw } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  Category,
  ExpenseTypeMaster,
  getCategories,
  getExpenseTypes,
  getSectors,
  getSmallExpenseTypes,
  getSubcategories,
  getUnits,
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
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ id: "", name: "", group: "", notes: "", isActive: true });
  async function load() { setRows(await getSmallExpenseTypes(search)); }
  async function submit() {
    if (!form.name.trim()) return;
    const isUpdate = Boolean(form.id);
    try {
      await saveSmallExpenseType(form);
      setForm({ id: "", name: "", group: "", notes: "", isActive: true });
      await load();
      notify("success", isUpdate ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso.");
    } catch {
      notify("error", "Erro ao salvar.");
    }
  }
  useEffect(() => { load(); }, []);
  return (
    <CrudPanel title="Tipos de pequenos gastos" search={search} setSearch={setSearch} load={load}
      form={<div className="form-grid"><Text label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} /><Text label="Grupo" value={form.group} onChange={(group) => setForm({ ...form, group })} /><Text label="Observacoes" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} /><Active checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} /><button className="primary-button" type="button" onClick={submit}>{form.id ? "Salvar" : "Cadastrar"}</button></div>}
      table={<Table headers={["Status", "Nome", "Normalizado", "Grupo", "Observacoes", "Acoes"]}>{rows.map((row) => <tr key={row.id}><td>{row.isActive ? "Ativo" : "Inativo"}</td><td>{row.name}</td><td>{row.normalizedName}</td><td>{row.group ?? "-"}</td><td>{row.notes ?? "-"}</td><td className="actions-cell"><button type="button" onClick={() => setForm({ id: row.id, name: row.name, group: row.group ?? "", notes: row.notes ?? "", isActive: row.isActive })}>Editar</button><button type="button" onClick={async () => { try { await setSmallExpenseTypeStatus(row.id, !row.isActive); await load(); notify("success", row.isActive ? "Cadastro inativado com sucesso." : "Cadastro reativado com sucesso."); } catch { notify("error", "Erro ao salvar."); } }}>{row.isActive ? "Inativar" : "Reativar"}</button></td></tr>)}</Table>}
    />
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
