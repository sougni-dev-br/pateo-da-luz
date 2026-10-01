import { useEffect, useRef, useState } from "react";
import { createPayrollItemManual, type Employee, type LancamentoManualFolha } from "../../api/client";
import { Alert, Button, FormField, FormGrid, PanelEyebrow, Select, TextField, Textarea } from "../../design-system";
import { descreverExistente, recusaDaFolha, type RecusaFolha } from "../../lib/folha-duplicidade";
import { maskMoney, numeroBr } from "../../utils/format";

// Lançamento manual na Folha (salário, adiantamento, vale-transporte). As travas do
// backend respondem 409: DUPLICIDADE (já existe o mesmo pagamento) ou APOS_SAIDA (período
// depois do desligamento). Aqui a tela mostra o que já existe e só reenvia com a decisão
// explícita da pessoa — complemento ou "lançar mesmo assim" — e o motivo obrigatório.

const MOTIVO_MINIMO = 10;
const TIPOS = [
  { value: "SALARIO", label: "Salário" },
  { value: "ADIANTAMENTO", label: "Adiantamento" },
  { value: "VALE_TRANSPORTE", label: "Vale-transporte" },
];
const QUINZENAS = [
  { value: "1", label: "1ª quinzena" },
  { value: "2", label: "2ª quinzena" },
  { value: "", label: "Mês inteiro (bilhete mensal / ajuda de custo)" },
];

type Props = {
  employees: Employee[];
  year: number;
  month: number;
  onFechar: () => void;
  onLancado: (mensagem: string) => void;
};

type Form = { employeeId: string; type: LancamentoManualFolha["type"]; competencia: string; quinzena: string; amount: string; dueDate: string; notes: string };
type Decisao = { complemento?: boolean; motivoComplemento?: string; confirmaAposSaida?: boolean; motivoAposSaida?: string };

export function LancamentoManualModal({ employees, year, month, onFechar, onLancado }: Props) {
  const [form, setForm] = useState<Form>({
    employeeId: "", type: "SALARIO", competencia: `${year}-${String(month).padStart(2, "0")}`, quinzena: "1", amount: "", dueDate: "", notes: "",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // A recusa da vez e as decisões já tomadas (complemento pode vir antes do "depois da saída").
  const [recusa, setRecusa] = useState<RecusaFolha | null>(null);
  const [decisao, setDecisao] = useState<Decisao>({});
  const [motivo, setMotivo] = useState("");

  // Mudou o que se está lançando: a recusa e as decisões tomadas sobre ela não valem mais.
  function alterar<K extends keyof Form>(campo: K, valor: Form[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setRecusa(null);
    setDecisao({});
    setMotivo("");
    setErro(null);
  }

  async function enviar(extra: Decisao = decisao) {
    const [ano, mes] = form.competencia.split("-").map(Number);
    const valor = numeroBr(form.amount);
    if (!form.employeeId || !ano || !mes) { setErro("Funcionário e competência são obrigatórios."); return; }
    if (!(valor > 0)) { setErro("Informe o valor (maior que zero)."); return; }
    setErro(null);
    setOcupado(true);
    try {
      const r = await createPayrollItemManual({
        employeeId: form.employeeId, type: form.type, competenceYear: ano, competenceMonth: mes,
        quinzena: form.type === "VALE_TRANSPORTE" ? (form.quinzena ? (Number(form.quinzena) as 1 | 2) : null) : null,
        amount: valor, dueDate: form.dueDate || undefined, notes: form.notes || undefined, ...extra,
      });
      onLancado(`Lançado: ${r.periodLabel} de ${String(mes).padStart(2, "0")}/${ano} — já está em Contas a Pagar.`);
    } catch (err) {
      const travada = recusaDaFolha(err, "DUPLICIDADE") ?? recusaDaFolha(err, "APOS_SAIDA");
      if (travada) {
        setDecisao(extra);
        setRecusa(travada);
        setMotivo("");
      } else {
        setErro(err instanceof Error ? err.message : "Erro ao lançar.");
      }
    } finally {
      setOcupado(false);
    }
  }

  // A recusa aparece no pé do formulário, fora da vista: rola até ela e põe o cursor no motivo.
  const blocoRecusa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!recusa || !blocoRecusa.current) return;
    blocoRecusa.current.scrollIntoView?.({ behavior: "smooth", block: "start" });
    blocoRecusa.current.querySelector("textarea")?.focus({ preventScroll: true });
  }, [recusa]);

  const motivoOk = motivo.trim().length >= MOTIVO_MINIMO;
  const confirmar = () => void enviar(recusa?.code === "DUPLICIDADE"
    ? { ...decisao, complemento: true, motivoComplemento: motivo.trim() }
    : { ...decisao, confirmaAposSaida: true, motivoAposSaida: motivo.trim() });

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="lancamento-manual-titulo">
      <section className="panel modal-panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Folha · lançamento à mão</PanelEyebrow>
            <h2 id="lancamento-manual-titulo">Lançar pagamento</h2>
          </div>
          <Button variant="secondary" onClick={onFechar} disabled={ocupado}>Fechar</Button>
        </div>

        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
          Um pagamento por pessoa, tipo e mês (no VT, por quinzena). Se já existir, o sistema mostra o que há e pede o motivo para lançar um complemento.
        </p>

        {erro && <div style={{ marginBottom: 12 }}><Alert tone="error">{erro}</Alert></div>}

        <FormGrid cols={2}>
          <div className="ds-form-grid-span-all">
            <FormField label="Funcionário" required>
              <Select
                value={form.employeeId}
                onChange={(e) => alterar("employeeId", e.target.value)}
                placeholder="Selecione o funcionário"
                options={employees.map((emp) => ({ value: emp.id, label: `${emp.firstName} ${emp.lastName}${emp.sector ? ` — ${emp.sector}` : ""}` }))}
              />
            </FormField>
          </div>
          <FormField label="Tipo" required>
            <Select value={form.type} onChange={(e) => alterar("type", e.target.value as Form["type"])} options={TIPOS} />
          </FormField>
          <FormField label="Competência" required>
            <TextField type="month" value={form.competencia} onChange={(e) => alterar("competencia", e.target.value)} />
          </FormField>
          {form.type === "VALE_TRANSPORTE" && (
            <FormField label="Período do vale" required>
              <Select value={form.quinzena} onChange={(e) => alterar("quinzena", e.target.value)} options={QUINZENAS} />
            </FormField>
          )}
          <FormField label="Valor" required>
            <TextField value={form.amount} onChange={(e) => alterar("amount", maskMoney(e.target.value))} placeholder="0,00" inputMode="numeric" />
          </FormField>
          <FormField label="Vencimento" hint="em branco = o mesmo do Gerar folha">
            <TextField type="date" value={form.dueDate} onChange={(e) => alterar("dueDate", e.target.value)} />
          </FormField>
          <div className="ds-form-grid-span-all">
            <FormField label="Observações">
              <Textarea rows={2} value={form.notes} onChange={(e) => alterar("notes", e.target.value)} />
            </FormField>
          </div>
        </FormGrid>

        {recusa && (
          <div ref={blocoRecusa} style={{ marginTop: 14 }} role="alert">
            <Alert tone="warning">{recusa.message}</Alert>
            {recusa.existentes && recusa.existentes.length > 0 && (
              <ul style={{ margin: "10px 0", paddingLeft: 18, fontSize: 13 }} aria-label="O que já está lançado">
                {recusa.existentes.map((e) => <li key={e.id ?? e.rotulo ?? ""}>{descreverExistente(e)}</li>)}
              </ul>
            )}
            <FormField
              label={recusa.code === "DUPLICIDADE" ? "É um complemento — motivo" : "Lançar mesmo assim — motivo"}
              hint={`obrigatório, pelo menos ${MOTIVO_MINIMO} letras; fica na auditoria`}
              required
            >
              <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </FormField>
          </div>
        )}

        <div className="form-actions">
          <Button variant="secondary" onClick={onFechar} disabled={ocupado}>Cancelar</Button>
          {recusa ? (
            <Button onClick={confirmar} disabled={ocupado || !motivoOk}>
              {ocupado ? "Lançando..." : recusa.code === "DUPLICIDADE" ? "Lançar como complemento" : "Lançar mesmo assim"}
            </Button>
          ) : (
            <Button onClick={() => void enviar()} disabled={ocupado}>{ocupado ? "Lançando..." : "Lançar"}</Button>
          )}
        </div>
      </section>
    </div>
  );
}
