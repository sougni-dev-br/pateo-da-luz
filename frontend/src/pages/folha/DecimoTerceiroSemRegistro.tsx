import { Banknote } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Decimo13Linha, Decimo13Parcela, Decimo13Previa, gerarDecimoTerceiro, getDecimoTerceiro } from "../../api/client";
import { Alert, Button, Money, PanelEyebrow, Table } from "../../design-system";

const fmtData = (iso: string) => iso.split("-").reverse().join("/");
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nota = { fontSize: "0.78em", color: "var(--muted)" } as const;

// Uma parcela na tabela: o valor lançado (ou o que será lançado) e o que mudou desde então.
function CelulaParcela({ parcela, estimada }: { parcela: Decimo13Parcela; estimada?: boolean }) {
  if (parcela.devido == null) return <>—</>;
  const valor = parcela.lancado ?? parcela.devido;
  const mudou = parcela.lancado != null && !parcela.paga && Math.abs(parcela.lancado - parcela.devido) >= 0.01;
  return (
    <>
      <Money value={valor} />
      {parcela.paga ? <span style={nota}> (paga)</span> : parcela.lancado != null ? <span style={nota}> (lançada)</span> : estimada ? <span style={nota}> (estimada)</span> : null}
      {mudou && <div style={{ ...nota, color: "var(--gold-dark, #9a6410)" }}>passa a {reais(parcela.devido)} ao gerar de novo</div>}
    </>
  );
}

// 13º de quem não tem registro (e do período sem registro de quem foi registrado depois), pela regra
// da contabilidade: média das variáveis pelos meses já apurados; a 2ª parcela é o 13º completo menos o
// que a 1ª pagou. O 13º do CLT vem do extrato da contabilidade, por isso não aparece aqui.
export function DecimoTerceiroSemRegistro({ year, onGerado }: { year: number; onGerado: () => void }) {
  const [previa, setPrevia] = useState<Decimo13Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [avisosDaGeracao, setAvisosDaGeracao] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Só a resposta da última consulta vale: trocar de ano rápido não deixa linhas do ano anterior na tela.
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    setErro(null);
    try {
      const r = await getDecimoTerceiro(year);
      if (meu === pedido.current) setPrevia(r);
    } catch (e) {
      if (meu !== pedido.current) return;
      setPrevia(null);
      setErro(e instanceof Error ? e.message : "Não foi possível calcular o 13º.");
    }
  }, [year]);
  useEffect(() => {
    setAviso(null);
    setAvisosDaGeracao([]);
    void carregar();
  }, [carregar]);

  const linhas: Decimo13Linha[] = previa?.linhas ?? [];
  const aGerar1 = linhas.filter((l) => l.calculo && l.p1.gerar).length;
  const aGerar2 = linhas.filter((l) => l.calculo && l.p2.gerar).length;
  const novembroFechado = previa?.novembroFechado ?? false;
  const total = linhas.reduce((acc, l) => acc + (l.calculo?.total ?? 0), 0);

  async function gerar(parcela: 1 | 2) {
    setBusy(true);
    setErro(null);
    setAviso(null);
    setAvisosDaGeracao([]);
    try {
      const r = await gerarDecimoTerceiro(year, parcela);
      const partes = [
        r.criadas + r.restauradas > 0 ? `${r.criadas + r.restauradas} lançada(s)` : null,
        r.atualizadas > 0 ? `${r.atualizadas} atualizada(s)` : null,
      ].filter(Boolean);
      setAviso(partes.length > 0
        ? `${parcela}ª parcela do 13º: ${partes.join(" e ")}. Vence em ${parcela === 1 ? "30/11" : "20/12"}; dê a baixa no Contas a Pagar.`
        : `Nada a lançar na ${parcela}ª parcela: tudo o que podia ser lançado já está lançado e atualizado.`);
      setAvisosDaGeracao(r.avisos);
      await carregar();
      onGerado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o 13º.");
    } finally {
      setBusy(false);
    }
  }

  if (!previa && !erro) return null;
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="section-heading">
        <div>
          <PanelEyebrow>13º salário {year} · sem registro</PanelEyebrow>
          <h2>{previa ? `${linhas.length} pessoa(s) · total ${reais(total)}` : "13º"}</h2>
          <p style={{ ...nota, margin: "4px 0 0" }}>
            Média das variáveis (gorjeta, hora extra, adicional noturno) pelos meses já apurados, como a contabilidade. A 2ª parcela é o 13º completo menos o que a 1ª pagou.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button leadingIcon={<Banknote size={14} />} onClick={() => void gerar(1)} disabled={busy || aGerar1 === 0}>
            {busy ? "Gerando..." : `Gerar 1ª parcela (${aGerar1})`}
          </Button>
          <Button
            variant="secondary" leadingIcon={<Banknote size={14} />} onClick={() => void gerar(2)} disabled={busy || aGerar2 === 0 || !novembroFechado}
            title={novembroFechado ? "Gera a 2ª parcela: o 13º completo menos o que a 1ª pagou" : "Disponível quando a gorjeta de novembro estiver fechada: a média precisa dela"}
          >
            {`Gerar 2ª parcela (${aGerar2})`}
          </Button>
        </div>
      </div>
      {erro && <Alert tone="error">{erro}</Alert>}
      {aviso && <Alert tone="success">{aviso}</Alert>}
      {previa && previa.avisos.length > 0 && <Alert tone="warning">{previa.avisos.map((a, i) => <div key={i}>{a}</div>)}</Alert>}
      {avisosDaGeracao.length > 0 && <Alert tone="warning">{avisosDaGeracao.map((a, i) => <div key={i}>{a}</div>)}</Alert>}
      {linhas.length > 0 && (
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
                <Table.Th>13º completo</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {linhas.map((l) => (
                <Table.Row key={l.employeeId}>
                  <Table.Td>
                    <strong>{l.nome}</strong>
                    {l.setor ? <div style={{ fontSize: "0.8em", color: "var(--muted)" }}>{l.setor}</div> : null}
                    {l.preRegistro && l.semRegistroAte && l.registroEm ? (
                      <div style={nota}>
                        só o período sem registro (até {fmtData(l.semRegistroAte)}); registrado em {fmtData(l.registroEm)}, o resto vem da contabilidade
                      </div>
                    ) : null}
                  </Table.Td>
                  {l.calculo ? (
                    <>
                      <Table.Td title={l.calculo.memoria}>{l.calculo.avos}/12 <span style={nota}>desde {fmtData(l.calculo.desde)}</span></Table.Td>
                      <Table.Td><Money value={l.calculo.salario} /></Table.Td>
                      <Table.Td title="Média mensal até outubro (1ª parcela) e até novembro (13º completo)">
                        <Money value={l.calculo.mediaFinal} />
                        {Math.abs(l.calculo.mediaFinal - l.calculo.mediaParcela1) >= 0.01 && <div style={nota}>até out.: {reais(l.calculo.mediaParcela1)}</div>}
                      </Table.Td>
                      <Table.Td><CelulaParcela parcela={l.p1} /></Table.Td>
                      <Table.Td>
                        <CelulaParcela parcela={l.p2} estimada={!novembroFechado} />
                        {l.p2.excesso > 0 && <div style={{ ...nota, color: "var(--danger)" }}>a 1ª pagou {reais(l.p2.excesso)} a mais que o 13º devido</div>}
                        {l.acerto != null && Math.abs(l.acerto) >= 0.01 && (
                          <div style={{ ...nota, color: "var(--danger)" }}>
                            {l.acerto > 0 ? `faltam ${reais(l.acerto)} pelo cálculo de hoje` : `pago a mais: ${reais(-l.acerto)}`}
                          </div>
                        )}
                      </Table.Td>
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
