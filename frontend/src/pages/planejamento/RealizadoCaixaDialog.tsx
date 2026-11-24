import { useEffect, useMemo, useState } from "react";
import { getPlanejamentoRealizadoDeCaixa, type PlanejamentoCaixaPremissas, type PlanejamentoGrupoDeGasto, type PlanejamentoLinhaDeGasto, type PlanejamentoRealizadoDeCaixa } from "../../api/client";
import { Dialog } from "../../components/ui/Dialog";
import { Alert, Button, Money, Table } from "../../design-system";
import { NOMES_DOS_MESES_CURTOS, percentualParaTexto, ROTULO_DA_FORMA, ROTULO_DO_GRUPO } from "./formato";
import { aplicarRealizadoDeCaixa } from "./realizado-caixa";

// Sugere as premissas de caixa a partir do que o ERP já mediu no ano-base. Prazo e taxa das maquininhas não existem no
// ERP e continuam à mão. Nada é gravado até a pessoa salvar o cenário.

const mensagemDe = (e: unknown) => (e instanceof Error && e.message ? e.message : "Não foi possível buscar o realizado de caixa.");
const pct = (f: number) => `${percentualParaTexto(f)}%`;

type Props = {
  aberto: boolean;
  anoBase: number;
  anoDoCenario: number;
  caixa: PlanejamentoCaixaPremissas;
  gastos: PlanejamentoLinhaDeGasto[];
  onFechar: () => void;
  onAplicar: (caixa: PlanejamentoCaixaPremissas, gastos: PlanejamentoLinhaDeGasto[]) => void;
};

export function RealizadoCaixaDialog({ aberto, anoBase, anoDoCenario, caixa, gastos, onFechar, onAplicar }: Props) {
  const [dados, setDados] = useState<PlanejamentoRealizadoDeCaixa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [semMix, setSemMix] = useState(false);
  const [semCompras, setSemCompras] = useState(false);
  const [semHerdado, setSemHerdado] = useState(false);
  const [desmarcados, setDesmarcados] = useState<Set<PlanejamentoGrupoDeGasto>>(new Set());

  useEffect(() => {
    if (!aberto) return undefined;
    let cancelado = false;
    setCarregando(true);
    setDados(null);
    setErro(null);
    setSemMix(false);
    setSemCompras(false);
    setSemHerdado(false);
    setDesmarcados(new Set());
    getPlanejamentoRealizadoDeCaixa(anoBase, anoDoCenario)
      .then((r) => { if (!cancelado) setDados(r); })
      .catch((e: unknown) => { if (!cancelado) { setDados(null); setErro(mensagemDe(e)); } })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [aberto, anoBase, anoDoCenario]);

  const gruposComLinha = useMemo(() => new Set(gastos.map((g) => g.grupo)), [gastos]);
  const medidasUteis = (dados?.pagoNoMes ?? []).filter((m) => m.pagoNoMes !== null && gruposComLinha.has(m.grupo));
  const escolhidos = new Set(medidasUteis.filter((m) => !desmarcados.has(m.grupo)).map((m) => m.grupo));
  const herdadoTemValor = dados !== null && [...dados.herdado.entradas, ...dados.herdado.saidas].some((v) => v > 0);
  const nada = dados !== null && !dados.mix && dados.comprasPrazoDias === null && medidasUteis.length === 0 && !herdadoTemValor;

  function alternar(grupo: PlanejamentoGrupoDeGasto) {
    setDesmarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(grupo)) novo.delete(grupo);
      else novo.add(grupo);
      return novo;
    });
  }

  function aplicar() {
    if (!dados) return;
    const r = aplicarRealizadoDeCaixa(caixa, gastos, dados, { mix: !semMix && dados.mix !== null, compras: !semCompras, pagoNoMes: escolhidos, herdado: !semHerdado && herdadoTemValor });
    onAplicar(r.caixa, r.gastos);
    onFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title={`Preencher o caixa com o realizado de ${anoBase}`} description="O que o ERP mediu no ano-base. Prazo e taxa das maquininhas não existem no ERP e continuam à mão. Nada é gravado até você salvar o cenário." size="xl">
      <div className="plan-realizado">
        {erro && <Alert tone="error">{erro}</Alert>}
        {dados?.avisos.map((a) => <Alert key={a} tone="warning">{a}</Alert>)}
        {nada && <Alert tone="warning">{`O ERP ainda não tem dado de ${anoBase} para sugerir nenhuma premissa de caixa.`}</Alert>}

        {dados && !nada && (
          <div className="plan-quadro plan-quadro-estreito">
            <Table aria-label="Realizado de caixa do ano-base">
              <Table.Head>
                <Table.Row>
                  <Table.Th scope="col">Usar</Table.Th>
                  <Table.Th>Premissa</Table.Th>
                  <Table.Th align="right">Realizado</Table.Th>
                  <Table.Th align="right">Hoje no cenário</Table.Th>
                  <Table.Th>Observação</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                <Table.Row>
                  <Table.Td><input type="checkbox" aria-label="Usar o mix de pagamento" checked={!semMix && dados.mix !== null} disabled={dados.mix === null} onChange={(e) => setSemMix(!e.target.checked)} /></Table.Td>
                  <Table.Th scope="row">Mix de pagamento</Table.Th>
                  <Table.Td align="right">{dados.mix ? caixa.formas.map((f) => `${ROTULO_DA_FORMA[f.forma]} ${pct(dados.mix?.formas[f.forma] ?? 0)}`).join(" · ") : "—"}</Table.Td>
                  <Table.Td align="right">{caixa.formas.map((f) => `${ROTULO_DA_FORMA[f.forma]} ${pct(f.mix)}`).join(" · ")}</Table.Td>
                  <Table.Td>{dados.mix ? <>Sobre <Money value={dados.mix.base} decimals={0} /> de vendas do Salão nos meses fechados.</> : "Sem vendas por forma de pagamento no ano-base."}</Table.Td>
                </Table.Row>
                <Table.Row>
                  <Table.Td><input type="checkbox" aria-label="Usar o prazo das compras" checked={!semCompras && dados.comprasPrazoDias !== null} disabled={dados.comprasPrazoDias === null} onChange={(e) => setSemCompras(!e.target.checked)} /></Table.Td>
                  <Table.Th scope="row">Prazo de pagamento das compras</Table.Th>
                  <Table.Td align="right">{dados.comprasPrazoDias === null ? "—" : `${dados.comprasPrazoDias} dias`}</Table.Td>
                  <Table.Td align="right">{caixa.comprasPrazoDias} dias</Table.Td>
                  <Table.Td>{`Média, ponderada pelo valor, entre a compra e o pagamento (compras de insumos${dados.comprasCobertura === null ? "" : `; cobre ${Math.round(dados.comprasCobertura * 100)}% do valor das compras`}).`}</Table.Td>
                </Table.Row>
                <Table.Row>
                  <Table.Td><input type="checkbox" aria-label="Usar os valores herdados" checked={!semHerdado && herdadoTemValor} disabled={!herdadoTemValor} onChange={(e) => setSemHerdado(!e.target.checked)} /></Table.Td>
                  <Table.Th scope="row">A receber / a pagar de jan a mar</Table.Th>
                  <Table.Td align="right">{herdadoTemValor ? `Receber ${dados.herdado.entradas.map((v) => Math.round(v).toLocaleString("pt-BR")).join(" / ")} · Pagar ${dados.herdado.saidas.map((v) => Math.round(v).toLocaleString("pt-BR")).join(" / ")}` : "—"}</Table.Td>
                  <Table.Td align="right">{`Receber ${caixa.herdado.entradas.map((v) => Math.round(v).toLocaleString("pt-BR")).join(" / ")} · Pagar ${caixa.herdado.saidas.map((v) => Math.round(v).toLocaleString("pt-BR")).join(" / ")}`}</Table.Td>
                  <Table.Td>{`${NOMES_DOS_MESES_CURTOS.slice(0, 3).join("/")} de ${anoDoCenario}: só o que JÁ está lançado (contas a pagar, folha e tributos em aberto, e recebíveis de eventos e outros, sem repasses de delivery). Nov e dez de ${anoBase} ainda não lançados ficam de fora.`}</Table.Td>
                </Table.Row>
                {medidasUteis.map((m) => {
                  const atual = gastos.find((g) => g.grupo === m.grupo)?.pagoNoMes;
                  return (
                    <Table.Row key={m.grupo}>
                      <Table.Td><input type="checkbox" aria-label={`Usar o % pago no mês de ${ROTULO_DO_GRUPO[m.grupo]}`} checked={escolhidos.has(m.grupo)} onChange={() => alternar(m.grupo)} /></Table.Td>
                      <Table.Th scope="row">{ROTULO_DO_GRUPO[m.grupo]}: pago no mês</Table.Th>
                      <Table.Td align="right">{m.pagoNoMes === null ? "—" : pct(m.pagoNoMes)}</Table.Td>
                      <Table.Td align="right">{atual === undefined ? "—" : pct(atual)}</Table.Td>
                      <Table.Td>{`Mês seguinte ${pct(m.mesSeguinte ?? 0)}${(m.depois ?? 0) > 0 ? `, depois ${pct(m.depois ?? 0)} (o modelo manda esse resto para o mês seguinte)` : ""}. Base: `}<Money value={m.base} decimals={0} /></Table.Td>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </div>
        )}

        <p className="plan-sub">O % pago no mês vale para todas as linhas do grupo. Grupos sem linha no cenário ou sem pagamento no período não aparecem. Os meses usados são só os já fechados e com pagamento concluído.</p>

        <div className="plan-dialogo-acoes">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="button" disabled={carregando || !dados || nada} onClick={aplicar}>{carregando ? "Buscando…" : "Aplicar ao cenário"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
