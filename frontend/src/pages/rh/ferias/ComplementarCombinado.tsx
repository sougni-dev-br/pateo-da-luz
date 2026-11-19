import { Check, CircleDollarSign, FileText, Plus, RefreshCw, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type MesDaGorjetaFerias, type PreviaFeriasCombinado, complementarFeriasCombinado } from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button, Card, FormSection, KpiCard, Money, StatusBadge, Table, TextField, type StatusTone } from "../../../design-system";
import { gerarPdfComplementoFerias } from "./pdfComplementoFerias";
import "./complementarCombinado.css";

type Props = {
  payrollItemId: string;
  nome: string;
  onClose: () => void;
  /** Chamado ao fechar quando o complemento foi gravado, para a tela recarregar. */
  onAplicou: () => void;
};

const ROTULO_ORIGEM: Record<MesDaGorjetaFerias["origem"], string> = { APURACAO: "apuração", INFORMADA: "informada à mão", AUSENTE: "sem apuração" };
const TOM_ORIGEM: Record<MesDaGorjetaFerias["origem"], StatusTone> = { APURACAO: "success", INFORMADA: "info", AUSENTE: "warning" };
const mesBr = (chave: string) => `${chave.slice(5, 7)}/${chave.slice(0, 4)}`;
// Aceita "1.234,56" e "1234.56"; vazio ou inválido = não informado.
function lerValor(texto: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Prévia e confirmação do complemento do salário combinado no título de férias. Nada é gravado antes de confirmar. */
export function ComplementarCombinado({ payrollItemId, nome, onClose, onAplicou }: Props) {
  const [previa, setPrevia] = useState<PreviaFeriasCombinado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const [aplicado, setAplicado] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [digitado, setDigitado] = useState<Record<string, string>>({});
  // Valores digitados com que a prévia exibida foi calculada ("{}" = nenhum).
  const [calculadoCom, setCalculadoCom] = useState("{}");

  const informadas = useCallback((): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [chave, texto] of Object.entries(digitado)) {
      const v = lerValor(texto);
      if (v != null) out[chave] = v;
    }
    return out;
  }, [digitado]);

  const calcular = useCallback(async (gorjetas: Record<string, number>) => {
    setCalculando(true);
    setErro(null);
    setMotivo(null);
    try {
      const r = await complementarFeriasCombinado(payrollItemId, false, gorjetas);
      setPrevia(r.previa);
      setCalculadoCom(JSON.stringify(gorjetas));
      setMotivo(r.motivo ?? null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui calcular o complemento.");
    } finally {
      setCalculando(false);
    }
  }, [payrollItemId]);

  useEffect(() => { void calcular({}); }, [calcular]);

  async function confirmar() {
    setAplicando(true);
    setErro(null);
    try {
      const r = await complementarFeriasCombinado(payrollItemId, true, informadas());
      setPrevia(r.previa);
      if (r.aplicado) setAplicado(true);
      else setMotivo(r.motivo ?? "Nada foi gravado.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui gravar o complemento.");
    } finally {
      setAplicando(false);
    }
  }

  // Demonstrativo para acompanhar o título na hora de pagar. Sai "gravado" só depois de confirmar; antes é prévia.
  async function gerarPdf() {
    if (!previa) return;
    setGerandoPdf(true);
    setErro(null);
    try {
      await gerarPdfComplementoFerias(previa, aplicado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui gerar o PDF.");
    } finally {
      setGerandoPdf(false);
    }
  }

  const ocupado = calculando || aplicando;
  // Valores digitados que a prévia na tela ainda não considerou: confirmar agora gravaria um número que ninguém viu.
  const desatualizado = JSON.stringify(informadas()) !== calculadoCom;
  const podeConfirmar = !!previa && !aplicado && !ocupado && !desatualizado && (previa.complemento > 0 || previa.valorDepois !== previa.valorAntes);
  const sair = () => { if (aplicado) onAplicou(); onClose(); };
  const meses = previa?.meses ?? [];
  const contagem = (o: MesDaGorjetaFerias["origem"]) => meses.filter((m) => m.origem === o).length;
  const remuneracaoMensal = previa && previa.combinado != null ? previa.combinado + previa.mediaGorjeta : null;

  return (
    <Dialog
      open
      onOpenChange={(aberto) => { if (!aberto && !ocupado) sair(); }}
      size="lg"
      title={`Complementar pelo combinado — ${nome}`}
      description="Nas férias a pessoa leva para casa o mesmo que trabalhando, mais 1/3; a empresa absorve o IR e o INSS do recibo. Nada é gravado antes de você confirmar."
    >
      <div className="fe-comb-corpo">
        {calculando && !previa && <p className="fe-comb-nota" role="status">Calculando a prévia…</p>}
        {erro && <Alert tone="error">{erro}</Alert>}
        {aplicado && <Alert tone="success">Complemento gravado no título de férias.</Alert>}
        {motivo && !aplicado && <Alert tone="warning">{motivo}</Alert>}

        {previa && (
          <>
            <div className="fe-comb-kpis" aria-busy={calculando}>
              <KpiCard label="Título hoje" moneyValue={previa.valorAntes} icon={<Wallet size={18} />} sub="Já lançado em Contas a Pagar" />
              <KpiCard label="Complemento" moneyValue={previa.complemento} tone="info" icon={<Plus size={18} />} sub="Diferença a somar ao título" />
              <KpiCard label="Novo valor do título" moneyValue={previa.valorDepois} tone="success" icon={<CircleDollarSign size={18} />} sub="O que a pessoa recebe nas férias" />
            </div>

            <FormSection title="Como chegamos nesse valor" eyebrow="Conta">
              <Table noScroll className="fe-comb-conta">
                <Table.Body>
                  <Table.Row>
                    <Table.Td>Salário combinado vigente</Table.Td>
                    <Table.Td align="right">{previa.combinado == null ? "Sem combinado vigente" : <Money value={previa.combinado} />}</Table.Td>
                  </Table.Row>
                  <Table.Row>
                    <Table.Td>Média da gorjeta <small>({previa.mesesContados} {previa.mesesContados === 1 ? "mês contado" : "meses contados"} de 12)</small></Table.Td>
                    <Table.Td align="right"><Money value={previa.mediaGorjeta} /></Table.Td>
                  </Table.Row>
                  {remuneracaoMensal != null && (
                    <Table.Row className="fe-comb-soma">
                      <Table.Td>Remuneração mensal</Table.Td>
                      <Table.Td align="right"><Money value={remuneracaoMensal} /></Table.Td>
                    </Table.Row>
                  )}
                  <Table.Row className="fe-comb-soma">
                    <Table.Td>Remuneração devida nas férias <small>(já com o 1/3)</small></Table.Td>
                    <Table.Td align="right"><Money value={previa.remuneracao} /></Table.Td>
                  </Table.Row>
                  <Table.Row>
                    <Table.Td>Líquido do recibo da contabilidade <small>(já descontados IR e INSS)</small></Table.Td>
                    <Table.Td align="right">− <Money value={previa.liquidoRecibo} /></Table.Td>
                  </Table.Row>
                  <Table.Row className="fe-comb-soma fe-comb-total">
                    <Table.Td>Complemento a pagar</Table.Td>
                    <Table.Td align="right"><Money value={previa.complemento} /></Table.Td>
                  </Table.Row>
                </Table.Body>
              </Table>
              {previa.formula && <p className="fe-comb-nota"><b>Fórmula:</b> {previa.formula}</p>}
            </FormSection>

            {previa.avisos.map((a) => <Alert key={a} tone="warning">{a}</Alert>)}

            {meses.length > 0 && (
              <FormSection
                title="Gorjeta dos 12 meses da média"
                eyebrow="Meses"
                description={`${contagem("APURACAO")} com apuração · ${contagem("INFORMADA")} informada${contagem("INFORMADA") === 1 ? "" : "s"} à mão · ${contagem("AUSENTE")} sem valor. Nos meses sem apuração você pode digitar a gorjeta; mês com apuração usa sempre a apuração.`}
                actions={!aplicado && (
                  <Button variant={desatualizado ? "primary" : "secondary"} size="sm" leadingIcon={<RefreshCw size={14} />} disabled={ocupado} onClick={() => void calcular(informadas())}>Recalcular prévia</Button>
                )}
              >
                {desatualizado && !aplicado && <Alert tone="warning">Você mudou valores: recalcule a prévia para ver o novo complemento antes de confirmar.</Alert>}
                <ul className="fe-comb-meses">
                  {meses.map((m) => {
                    const editavel = m.origem !== "APURACAO" && !aplicado;
                    return (
                      <li key={m.chave}>
                        <Card className="fe-comb-mes">
                          <div className="fe-comb-mes-topo">
                            <strong>{mesBr(m.chave)}</strong>
                            <StatusBadge tone={TOM_ORIGEM[m.origem]}>{ROTULO_ORIGEM[m.origem]}</StatusBadge>
                          </div>
                          {editavel ? (
                            <TextField type="text" inputMode="decimal" placeholder="0,00" aria-label={`Gorjeta de ${mesBr(m.chave)}`} disabled={ocupado}
                              value={digitado[m.chave] ?? (m.origem === "INFORMADA" && m.valor != null ? String(m.valor) : "")}
                              onChange={(e) => setDigitado((d) => ({ ...d, [m.chave]: e.target.value }))} />
                          ) : (
                            <span className="fe-comb-mes-valor">{m.valor == null ? "—" : <Money value={m.valor} />}</span>
                          )}
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </FormSection>
            )}
          </>
        )}

        <div className="fe-comb-acoes">
          <Button variant="secondary" disabled={aplicando} onClick={sair}>{aplicado ? "Concluir" : "Cancelar"}</Button>
          <Button variant="secondary" leadingIcon={<FileText size={16} />} disabled={!previa || ocupado || gerandoPdf || desatualizado} onClick={() => void gerarPdf()}>
            {gerandoPdf ? "Gerando PDF…" : "Gerar PDF"}
          </Button>
          {!aplicado && (
            <Button leadingIcon={<Check size={16} />} aria-disabled={!podeConfirmar} onClick={() => { if (podeConfirmar) void confirmar(); }}>
              {aplicando ? "Gravando…" : "Confirmar e somar ao título"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
