// Passo 1: quem sai e quando. A data de saída é gravada no cadastro, como no
// "Registrar desligamento" de Funcionários (o mesmo endpoint).
import { useEffect, useState } from "react";
import { type DetalheRescisao, type ListaRescisoes, terminateEmployee } from "../../../api/client";
import { TIPOS_DESLIGAMENTO, lerMotivoDoDesligamento, motivoDoDesligamento } from "../../../components/pessoal/desligamento";
import { useSession } from "../../../context/SessionContext";
import { Alert, Button, FormField, FormGrid, Select, Textarea, TextField } from "../../../design-system";
import { hojeLocalIso } from "../../../lib/datas";
import { hasPermission } from "../../../lib/permissions";

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

type Props = {
  lista: ListaRescisoes | null;
  detalhe: DetalheRescisao | null;
  carregando: boolean;
  onEscolher: (employeeId: string) => void;
  onGravou: () => void;
  onContinuar: () => void;
};

/** Quem pode começar uma rescisão: desligados ainda sem rescisão e os ativos. */
function opcoesDePessoas(lista: ListaRescisoes) {
  const desligados = lista.pessoas
    .filter((p) => !p.rescisao)
    .map((p) => ({ value: p.employeeId, label: `${p.nome} — saída ${p.saida ? dataBr(p.saida) : "sem data"} (${p.semRegistro ? "sem registro" : "CLT"})` }));
  const ativos = lista.ativos.map((p) => ({ value: p.employeeId, label: `${p.nome} — ativo (${p.semRegistro ? "sem registro" : "CLT"})` }));
  return [...desligados, ...ativos];
}

export function PassoFuncionario({ lista, detalhe, carregando, onEscolher, onGravou, onContinuar }: Props) {
  const { user } = useSession();
  const podeGravar = hasPermission(user, "employees", "edit");
  const [escolhido, setEscolhido] = useState("");
  const [form, setForm] = useState({ data: "", tipo: "", observacao: "" });
  const [inicial, setInicial] = useState(form);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  const pessoa = detalhe?.pessoa ?? null;
  useEffect(() => {
    if (!pessoa) return;
    const motivo = lerMotivoDoDesligamento(pessoa.motivo);
    const lido = { data: pessoa.saida ?? hojeLocalIso(), tipo: motivo.tipo, observacao: motivo.observacao };
    setForm(lido);
    setInicial(lido);
  }, [pessoa?.employeeId, pessoa?.saida, pessoa?.motivo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pessoa) {
    if (carregando) return null;
    const opcoes = lista ? opcoesDePessoas(lista) : [];
    return (
      <section className="rr-corpo" aria-labelledby="rr-p1">
        <h3 id="rr-p1">1. Quem está saindo?</h3>
        <p className="rr-ajuda">Escolha a pessoa. Quem já tem rescisão lançada é aberto pela lista.</p>
        <FormGrid cols={2}>
          <FormField label="Funcionário" required>
            <Select value={escolhido} onChange={(e) => setEscolhido(e.target.value)} placeholder={lista ? "Selecione" : "Carregando…"} options={opcoes} />
          </FormField>
        </FormGrid>
        <div>
          <Button disabled={!escolhido} onClick={() => onEscolher(escolhido)}>Continuar</Button>
        </div>
      </section>
    );
  }

  const mudou = !pessoa.saida || form.data !== inicial.data || form.tipo !== inicial.tipo || form.observacao.trim() !== inicial.observacao.trim();
  const lancada = pessoa.rescisao != null;

  async function gravarEContinuar() {
    if (!pessoa) return;
    if (!mudou && pessoa.saida) { onContinuar(); return; }
    if (!form.data) { setErro("Informe a data de saída."); return; }
    if (!form.tipo) { setErro("Selecione o tipo de desligamento."); return; }
    setErro(null);
    setGravando(true);
    try {
      await terminateEmployee(pessoa.employeeId, form.data, motivoDoDesligamento(form.tipo, form.observacao));
      onGravou();
      onContinuar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui gravar a saída.");
    } finally {
      setGravando(false);
    }
  }

  return (
    <section className="rr-corpo" aria-labelledby="rr-p1">
      <h3 id="rr-p1">1. Funcionário e data de saída</h3>
      <p className="rr-ajuda">
        A data de saída fica no cadastro e deixa a pessoa inativa: escala, VT e gorjeta passam a contar até ela.
        {pessoa.saida ? ` Hoje está gravada ${dataBr(pessoa.saida)}.` : " Ainda não há data gravada."}
      </p>
      {lancada && mudou && (
        <Alert tone="warning">A rescisão já foi lançada. Mudar a data não refaz o que foi lançado: confira e ajuste no passo 4, com justificativa.</Alert>
      )}
      {!podeGravar && <Alert tone="info">Gravar a data de saída exige a permissão de editar Funcionários. Peça a quem tem, ou siga se a data já está certa.</Alert>}
      {erro && <Alert tone="error">{erro}</Alert>}
      <FormGrid cols={2}>
        <FormField label="Data de saída" required>
          <TextField type="date" value={form.data} disabled={!podeGravar} onChange={(e) => setForm({ ...form, data: e.target.value })} />
        </FormField>
        <FormField label="Tipo de desligamento" required>
          <Select value={form.tipo} disabled={!podeGravar} onChange={(e) => setForm({ ...form, tipo: e.target.value })} placeholder="Selecione o tipo"
            options={TIPOS_DESLIGAMENTO.map((t) => ({ value: t, label: t }))} />
        </FormField>
        <div className="ds-form-grid-span-all">
          <FormField label="Observação (opcional)">
            <Textarea rows={2} value={form.observacao} disabled={!podeGravar} onChange={(e) => setForm({ ...form, observacao: e.target.value })} placeholder="Detalhes, se houver…" />
          </FormField>
        </div>
      </FormGrid>
      <div>
        <Button onClick={() => void gravarEContinuar()} disabled={gravando || (!pessoa.saida && !podeGravar)}>
          {gravando ? "Gravando…" : mudou ? "Gravar saída e continuar" : "Continuar"}
        </Button>
      </div>
    </section>
  );
}
