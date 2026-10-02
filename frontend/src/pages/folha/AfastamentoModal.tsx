import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type Afastamento, type Employee, editarAfastamento, excluirAfastamento, getAfastamentos, lancarAfastamento,
} from "../../api/client";
import { Janela } from "../../components/pessoal/extras/Janela";
import "../../components/pessoal/extras/extras.css";
import { Alert, Button, FormField, FormGrid, IconButton, Select, Table, TextField, Textarea } from "../../design-system";

// Afastamento não remunerado (pedido da própria pessoa). Lançado aqui, como as férias, mas sem
// valor: não é despesa e não vai a Contas a Pagar. O intervalo vira dias "AF" na Escala; nesses
// dias a pessoa sai da escala e não recebe salário nem VT. Na gorjeta, segue a regra escolhida
// no fechamento (período ou pessoa).

export const MOTIVO_MINIMO_LETRAS = 5;
const letras = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const periodo = (a: { inicio: string; fim: string }) => `${diaMes(a.inicio)} a ${diaMes(a.fim)}`;

type Props = {
  employees: Employee[];
  year: number;
  month: number;
  onFechar: () => void;
  /** Algo foi lançado, editado ou excluído. */
  onAlterado: (mensagem: string) => void;
};

type Form = { employeeId: string; inicio: string; fim: string; motivo: string };
const VAZIO: Form = { employeeId: "", inicio: "", fim: "", motivo: "" };

function validar(f: Form): string | null {
  if (!f.employeeId || !f.inicio || !f.fim) return "Funcionário, início e fim do afastamento são obrigatórios.";
  if (f.fim < f.inicio) return "O fim do afastamento não pode ser antes do início.";
  if (letras(f.motivo) < MOTIVO_MINIMO_LETRAS) return `Informe o motivo do afastamento (pelo menos ${MOTIVO_MINIMO_LETRAS} letras).`;
  return null;
}

export function AfastamentoModal({ employees, year, month, onFechar, onAlterado }: Props) {
  const [form, setForm] = useState<Form>(VAZIO);
  const [editando, setEditando] = useState<Afastamento | null>(null);
  const [lista, setLista] = useState<Afastamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ mensagem: string; avisos: string[] } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      setLista((await getAfastamentos(year, month)).afastamentos);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar os afastamentos.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { void carregar(); }, [year, month]);

  function alterar<K extends keyof Form>(campo: K, valor: Form[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setErro(null);
  }

  function editar(a: Afastamento) {
    setEditando(a);
    setForm({ employeeId: a.employeeId, inicio: a.inicio, fim: a.fim, motivo: a.motivo ?? "" });
    setErro(null);
    setResultado(null);
  }

  function cancelarEdicao() {
    setEditando(null);
    setForm(VAZIO);
    setErro(null);
  }

  async function gravar() {
    const dados = { ...form, motivo: form.motivo.trim() };
    const recusa = validar(dados);
    if (recusa) { setErro(recusa); return; }
    setOcupado(true);
    setErro(null);
    try {
      const r = editando
        ? await editarAfastamento({ ...dados, inicioAtual: editando.inicio, fimAtual: editando.fim })
        : await lancarAfastamento(dados);
      const trocadas = r.substituidas > 0 ? ` ${r.substituidas} marcação(ões) da escala substituída(s).` : "";
      const mensagem = `Afastamento ${editando ? "alterado" : "lançado"}: ${r.dias} dia(s), ${periodo(r)}.${trocadas}`;
      setResultado({ mensagem, avisos: r.avisos });
      setEditando(null);
      setForm(VAZIO);
      onAlterado(mensagem);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao gravar o afastamento.");
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(a: Afastamento) {
    if (!window.confirm(`Excluir o afastamento de ${a.employeeName} (${periodo(a)}, ${a.dias} dia(s))? Os dias voltam a ficar sem marca na escala.`)) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await excluirAfastamento({ employeeId: a.employeeId, inicio: a.inicio, fim: a.fim });
      const mensagem = `Afastamento de ${a.employeeName} excluído (${r.dias} dia(s)).`;
      setResultado({ mensagem, avisos: r.avisos });
      if (editando && editando.employeeId === a.employeeId && editando.inicio === a.inicio) cancelarEdicao();
      onAlterado(mensagem);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao excluir o afastamento.");
    } finally {
      setOcupado(false);
    }
  }

  const preenchido = Boolean(form.employeeId || form.inicio || form.fim || form.motivo.trim());

  return (
    <Janela eyebrow="Folha · afastamento sem remuneração" titulo={editando ? "Editar afastamento" : "Lançar afastamento"}
      onFechar={onFechar} ocupado={ocupado} confirmarDescarte={preenchido}>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
        Pedido da própria pessoa. Os dias saem da escala (marca AF) e não pagam salário nem VT. Na gorjeta, segue a regra
        "descontar afastamento" do fechamento. Não gera lançamento em Contas a Pagar.
      </p>

      {erro && <div style={{ marginBottom: 12 }}><Alert tone="error">{erro}</Alert></div>}
      {resultado && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone={resultado.avisos.length ? "warning" : "success"}>
            <div>{resultado.mensagem}</div>
            {resultado.avisos.map((a) => <div key={a}>{a}</div>)}
          </Alert>
        </div>
      )}

      <FormGrid cols={2}>
        <div className="ds-form-grid-span-all">
          <FormField label="Funcionário" required>
            <Select
              value={form.employeeId}
              onChange={(e) => alterar("employeeId", e.target.value)}
              disabled={editando != null}
              placeholder="Selecione o funcionário"
              options={employees.map((emp) => ({ value: emp.id, label: `${emp.firstName} ${emp.lastName}${emp.sector ? ` — ${emp.sector}` : ""}` }))}
            />
          </FormField>
        </div>
        <FormField label="De" required>
          <TextField type="date" value={form.inicio} onChange={(e) => alterar("inicio", e.target.value)} />
        </FormField>
        <FormField label="Até" required>
          <TextField type="date" value={form.fim} onChange={(e) => alterar("fim", e.target.value)} />
        </FormField>
        <div className="ds-form-grid-span-all">
          <FormField label="Motivo" required hint={`obrigatório, pelo menos ${MOTIVO_MINIMO_LETRAS} letras; fica na auditoria`}>
            <Textarea rows={2} value={form.motivo} onChange={(e) => alterar("motivo", e.target.value)} />
          </FormField>
        </div>
      </FormGrid>

      <div className="form-actions">
        {editando
          ? <Button variant="secondary" onClick={cancelarEdicao} disabled={ocupado}>Cancelar edição</Button>
          : <Button variant="secondary" onClick={onFechar} disabled={ocupado}>Fechar</Button>}
        <Button onClick={() => void gravar()} disabled={ocupado}>
          {ocupado ? "Gravando..." : editando ? "Salvar alterações" : "Lançar afastamento"}
        </Button>
      </div>

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Afastamentos que tocam {String(month).padStart(2, "0")}/{year}</h3>
      {carregando ? (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Carregando...</p>
      ) : lista.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Nenhum afastamento neste mês.</p>
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th>Funcionário</Table.Th>
              <Table.Th>Período</Table.Th>
              <Table.Th align="center">Dias</Table.Th>
              <Table.Th>Motivo</Table.Th>
              <Table.Th> </Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {lista.map((a) => (
              <Table.Row key={`${a.employeeId}|${a.inicio}`}>
                <Table.Td>{a.employeeName}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{periodo(a)}</Table.Td>
                <Table.Td align="center">{a.dias}</Table.Td>
                <Table.Td style={{ color: a.motivo ? undefined : "var(--muted)" }}>{a.motivo ?? "sem motivo (marcado na escala)"}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  <IconButton label={`Editar afastamento de ${a.employeeName}`} icon={<Pencil size={14} />} size="sm" onClick={() => editar(a)} disabled={ocupado} />
                  <IconButton label={`Excluir afastamento de ${a.employeeName}`} icon={<Trash2 size={14} />} size="sm" onClick={() => void excluir(a)} disabled={ocupado} />
                </Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Janela>
  );
}
