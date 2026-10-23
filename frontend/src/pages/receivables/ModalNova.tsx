import { Plus } from "lucide-react";
import { useState } from "react";
import type { ReceivableSourceType } from "../../api/client";
import { Alert, Button, Money, Select, TextField } from "../../design-system";
import { maskMoney, numeroBr } from "../../utils/format";
import { Janela } from "../payables/Janela";
import { ORIGENS_MANUAIS } from "./regras";

export type ValoresDaNovaConta = {
  sourceType: ReceivableSourceType;
  description: string;
  customerName: string;
  expectedDate: string;
  grossAmount: number;
  fees: number;
  netAmount: number;
  notes: string;
};

type Props = {
  hoje: string;
  onFechar: () => void;
  onConfirmar: (valores: ValoresDaNovaConta) => Promise<void>;
};

/** Lançamento manual de uma conta a receber (evento, recebimento direto, outros). Repasses de plataforma não passam por aqui. */
export function ModalNova({ hoje, onFechar, onConfirmar }: Props) {
  const [origem, setOrigem] = useState<ReceivableSourceType>("EVENT");
  const [descricao, setDescricao] = useState("");
  const [cliente, setCliente] = useState("");
  const [previsto, setPrevisto] = useState(hoje);
  const [bruto, setBruto] = useState("");
  const [taxas, setTaxas] = useState("");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valorBruto = numeroBr(bruto);
  const valorTaxas = numeroBr(taxas);
  const liquido = Math.round((valorBruto - valorTaxas) * 100) / 100;
  const problema =
    !descricao.trim() ? "Descreva a conta."
      : !previsto ? "Informe a data prevista."
        : valorBruto <= 0 ? "Informe o valor."
          : valorTaxas < 0 || liquido <= 0 ? "As taxas não podem ser iguais ou maiores que o valor." : null;

  async function confirmar() {
    if (problema || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await onConfirmar({ sourceType: origem, description: descricao.trim(), customerName: cliente.trim(), expectedDate: previsto, grossAmount: valorBruto, fees: valorTaxas, netAmount: liquido, notes: obs.trim() });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível lançar a conta.");
      setEnviando(false);
    }
  }

  return (
    <Janela eyebrow="Nova conta a receber" titulo="Lançar recebimento previsto" onFechar={onFechar} ocupado={enviando} largura="media">
      {erro && <Alert tone="error" role="alert">{erro}</Alert>}
      <p className="pg-nota">Para eventos, empreitadas e valores que não vêm do iFood, 99 Food ou Keeta (esses chegam sozinhos).</p>

      <div className="form-grid rc-form">
        <Select label="Tipo *" value={origem} onChange={(e) => setOrigem(e.target.value as ReceivableSourceType)} options={ORIGENS_MANUAIS} />
        <TextField label="Data prevista *" type="date" value={previsto} onChange={(e) => setPrevisto(e.target.value)} />
        <TextField containerClassName="rc-campo-largo" label="Descrição *" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Evento de fim de ano — 1ª parcela" autoFocus />
        <TextField label="Cliente" value={cliente} maxLength={160} onChange={(e) => setCliente(e.target.value)} />
        <TextField label="Observação" value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)} />
        <TextField label="Valor (R$) *" inputMode="decimal" autoComplete="off" value={bruto} onChange={(e) => setBruto(maskMoney(e.target.value))} />
        <TextField label="Taxas / descontos (R$)" inputMode="decimal" autoComplete="off" value={taxas} onChange={(e) => setTaxas(maskMoney(e.target.value))} hint="Se houver, o líquido é o valor menos as taxas." />
      </div>

      <p className="pay-confirm-phrase" aria-live="polite">
        {problema ?? <>Você vai receber <strong><Money value={liquido} /></strong> em <strong>{previsto.split("-").reverse().join("/")}</strong>.</>}
      </p>

      <div className="modal-actions">
        <Button variant="secondary" onClick={onFechar} disabled={enviando}>Cancelar</Button>
        <Button leadingIcon={<Plus size={16} />} onClick={() => void confirmar()} disabled={Boolean(problema) || enviando} aria-busy={enviando}>
          {enviando ? "Lançando…" : "Lançar conta"}
        </Button>
      </div>
    </Janela>
  );
}
