import { Banknote } from "lucide-react";
import { useEffect, useState } from "react";
import { Decimo13Linha, gerarDecimoTerceiro, getDecimoTerceiro } from "../../api/client";
import { Alert, Button, Money, PanelEyebrow, Table } from "../../design-system";

const fmtData = (iso: string) => iso.split("-").reverse().join("/");

// 13º de quem não tem registro (e do período sem registro de quem foi registrado depois): mesma regra do CLT (avos, média das variáveis, 50% até 30/11
// e o restante até 20/12). O CLT vem do extrato da contabilidade, por isso não aparece aqui.
export function DecimoTerceiroSemRegistro({ year, onGerado }: { year: number; onGerado: () => void }) {
  const [linhas, setLinhas] = useState<Decimo13Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function carregar() {
    setErro(null);
    try {
      setLinhas((await getDecimoTerceiro(year)).linhas);
    } catch (e) {
      setLinhas(null);
      setErro(e instanceof Error ? e.message : "Não foi possível calcular o 13º.");
    }
  }
  useEffect(() => { void carregar(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const aGerar = (linhas ?? []).reduce((n, l) => n + (l.calculo ? (l.parcela1Existe ? 0 : 1) + (l.parcela2Existe ? 0 : 1) : 0), 0);
  const total = (linhas ?? []).reduce((acc, l) => acc + (l.calculo?.total ?? 0), 0);

  async function gerar() {
    setBusy(true);
    setErro(null);
    try {
      const r = await gerarDecimoTerceiro(year);
      setAviso(`${r.criadas} parcela(s) de 13º lançada(s). Vencem em 30/11 e 20/12; dê a baixa no Contas a Pagar.`);
      await carregar();
      onGerado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o 13º.");
    } finally {
      setBusy(false);
    }
  }

  if (!linhas && !erro) return null;
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="section-heading">
        <div>
          <PanelEyebrow>13º salário {year} · sem registro</PanelEyebrow>
          <h2>{linhas ? `${linhas.length} pessoa(s) · total ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : "13º"}</h2>
        </div>
        <Button leadingIcon={<Banknote size={14} />} onClick={gerar} disabled={busy || aGerar === 0}>
          {busy ? "Gerando..." : `Gerar 13º (${aGerar} parcelas)`}
        </Button>
      </div>
      {erro && <Alert tone="error">{erro}</Alert>}
      {aviso && <Alert tone="success">{aviso}</Alert>}
      {linhas && linhas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th minWidth={160}>Funcionário</Table.Th>
                <Table.Th>Avos</Table.Th>
                <Table.Th>Salário</Table.Th>
                <Table.Th>Média variáveis</Table.Th>
                <Table.Th>1ª parcela (30/11)</Table.Th>
                <Table.Th>2ª parcela (20/12)</Table.Th>
                <Table.Th>Total</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {linhas.map((l) => (
                <Table.Row key={l.employeeId}>
                  <Table.Td>
                    <strong>{l.nome}</strong>
                    {l.setor ? <div style={{ fontSize: "0.8em", color: "var(--muted)" }}>{l.setor}</div> : null}
                    {l.preRegistro && l.semRegistroAte && l.registroEm ? (
                      <div style={{ fontSize: "0.78em", color: "var(--muted)" }}>
                        só o período sem registro (até {fmtData(l.semRegistroAte)}); registrado em {fmtData(l.registroEm)}, o resto vem da contabilidade
                      </div>
                    ) : null}
                  </Table.Td>
                  {l.calculo ? (
                    <>
                      <Table.Td title={l.calculo.memoria}>{l.calculo.avos}/12 <span style={{ fontSize: "0.78em", color: "var(--muted)" }}>desde {fmtData(l.calculo.desde)}</span></Table.Td>
                      <Table.Td><Money value={l.calculo.salario} /></Table.Td>
                      <Table.Td><Money value={l.calculo.mediaVariaveis} /></Table.Td>
                      <Table.Td><Money value={l.calculo.parcela1} />{l.parcela1Existe ? <span style={{ fontSize: "0.78em", color: "var(--muted)" }}> (já lançada)</span> : null}</Table.Td>
                      <Table.Td><Money value={l.calculo.parcela2} />{l.parcela2Existe ? <span style={{ fontSize: "0.78em", color: "var(--muted)" }}> (já lançada)</span> : null}</Table.Td>
                      <Table.Td style={{ fontWeight: 500 }}><Money value={l.calculo.total} /></Table.Td>
                    </>
                  ) : (
                    <Table.Td colSpan={6} style={{ color: "var(--muted)" }}>{l.motivoSemCalculo}</Table.Td>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
    </section>
  );
}
