import { useState } from "react";
import { createExtraPessoa, updateExtraPessoa, type ExtraPessoaFora, type ExtraPixTipo } from "../../../api/client";
import { Alert, Button, FormField, FormGrid, Select, Switch, TextField, Textarea } from "../../../design-system";
import { Janela } from "./Janela";
import { PIX_ROTULO } from "./extrasRotulos";

type Props = {
  pessoa: ExtraPessoaFora | null;
  podeVerDados: boolean;
  nomeInicial?: string;
  onFechar: () => void;
  onSalvo: (id: string, nome: string) => void;
};

export function PessoaForaModal({ pessoa, podeVerDados, nomeInicial = "", onFechar, onSalvo }: Props) {
  const [form, setForm] = useState({
    fullName: pessoa?.nome ?? nomeInicial,
    displayName: pessoa?.apelido ?? "",
    phone: pessoa?.telefone ?? "",
    cpf: pessoa?.cpf ?? "",
    pixKeyType: (pessoa?.pixKeyType ?? "") as ExtraPixTipo | "",
    pixKey: pessoa?.pixKey ?? "",
    referredBy: pessoa?.indicadoPor ?? "",
    notes: pessoa?.observacao ?? "",
    isActive: pessoa?.ativo ?? true,
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const muda = (campo: keyof typeof form) => (valor: string | boolean) => setForm((f) => ({ ...f, [campo]: valor }));

  async function salvar() {
    if (form.fullName.trim().length < 3) return setErro("Informe o nome completo.");
    if (form.pixKey.trim() && !form.pixKeyType) return setErro("Informe o tipo da chave PIX.");
    setErro(null);
    setSalvando(true);
    const payload = {
      fullName: form.fullName,
      displayName: form.displayName || null,
      phone: form.phone || null,
      cpf: form.cpf || null,
      pixKeyType: form.pixKeyType || null,
      pixKey: form.pixKey || null,
      referredBy: form.referredBy || null,
      notes: form.notes || null,
      isActive: form.isActive,
    };
    try {
      const id = pessoa ? (await updateExtraPessoa(pessoa.id, payload), pessoa.id) : (await createExtraPessoa(payload)).id;
      onSalvo(id, form.fullName.trim());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Janela eyebrow="Extras · pessoa de fora" titulo={pessoa ? "Editar cadastro" : "Nova pessoa de fora"} onFechar={onFechar} ocupado={salvando}>
        <p className="extras-sub" style={{ marginTop: 0 }}>
          Só para quem não é da casa. Funcionário (CLT ou sem registro) já vem do cadastro de Funcionários.
        </p>

        <FormGrid cols={2}>
          <FormField label="Nome completo" required>
            <TextField value={form.fullName} onChange={(e) => muda("fullName")(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Como é chamado">
            <TextField value={form.displayName} onChange={(e) => muda("displayName")(e.target.value)} placeholder="Apelido (opcional)" />
          </FormField>
          <FormField label="Telefone">
            <TextField value={form.phone} onChange={(e) => muda("phone")(e.target.value)} inputMode="tel" placeholder="(11) 90000-0000" />
          </FormField>
          <FormField label="Indicado por">
            <TextField value={form.referredBy} onChange={(e) => muda("referredBy")(e.target.value)} placeholder="Quem indicou" />
          </FormField>
          {podeVerDados ? (
            <>
              <FormField label="CPF" hint="Opcional, mas vai no recibo de pagamento.">
                <TextField value={form.cpf} onChange={(e) => muda("cpf")(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" />
              </FormField>
              <FormField label="Chave PIX">
                <div style={{ display: "flex", gap: 8 }}>
                  <Select
                    value={form.pixKeyType}
                    onChange={(e) => muda("pixKeyType")(e.target.value)}
                    placeholder="Tipo"
                    options={Object.entries(PIX_ROTULO).map(([value, label]) => ({ value, label }))}
                    aria-label="Tipo da chave PIX"
                    containerClassName="extras-pix-tipo"
                  />
                  <TextField value={form.pixKey} onChange={(e) => muda("pixKey")(e.target.value)} aria-label="Chave PIX" style={{ flex: 1 }} />
                </div>
              </FormField>
            </>
          ) : null}
        </FormGrid>
        {!podeVerDados && (
          <p className="extras-sub">CPF e PIX ficam visíveis só para quem pode ver dados de Funcionários ou administra Extras.</p>
        )}
        <FormField label="Observação">
          <Textarea value={form.notes} onChange={(e) => muda("notes")(e.target.value)} rows={2} />
        </FormField>
        {pessoa && (
          <div style={{ marginTop: 10 }}>
            <Switch checked={form.isActive} onChange={(v: boolean) => muda("isActive")(v)} label="Ativo (aparece na hora de lançar diária)" />
          </div>
        )}

        {erro && <div style={{ marginTop: 12 }}><Alert tone="error">{erro}</Alert></div>}
        <div className="extras-acoes">
          <Button variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
        </div>
    </Janela>
  );
}
