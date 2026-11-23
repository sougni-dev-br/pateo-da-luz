import { useEffect, useMemo, useState } from "react";
import { getPlanejamentoRealizado, type PlanejamentoGrupoDeGasto, type PlanejamentoLinhaDeGasto, type PlanejamentoRealizado } from "../../api/client";
import { Dialog } from "../../components/ui/Dialog";
import { Alert, Button, Money, Select, Table } from "../../design-system";
import { NOMES_DOS_MESES_CURTOS, ROTULO_DO_GRUPO } from "./formato";
import { aplicarRealizado, temSugestao, type ModoDoPreenchimento } from "./realizado";

// Sugere os gastos do cenário a partir do que o DRE já apurou no ano-base (só meses encerrados). A pessoa escolhe
// os grupos e a forma (média dos meses ou mesmo mês do ano-base); nada é gravado até ela salvar o cenário.

const OPCOES_DE_MODO: { value: ModoDoPreenchimento; label: string }[] = [
  { value: "MEDIA", label: "Média dos meses fechados" },
  { value: "MESMO_MES", label: "Mesmo mês do ano-base" }
];

const nomesDosMeses = (meses: readonly number[]) => meses.map((m) => NOMES_DOS_MESES_CURTOS[m - 1]).join(", ");
const mensagemDe = (e: unknown) => (e instanceof Error && e.message ? e.message : "Não foi possível buscar o realizado.");

type Props = {
  aberto: boolean;
  anoBase: number;
  gastos: PlanejamentoLinhaDeGasto[];
  onFechar: () => void;
  onAplicar: (proximos: PlanejamentoLinhaDeGasto[]) => void;
};

export function RealizadoDialog({ aberto, anoBase, gastos, onFechar, onAplicar }: Props) {
  const [dados, setDados] = useState<PlanejamentoRealizado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ignorarSemLancamento, setIgnorarSemLancamento] = useState(true);
  const [modo, setModo] = useState<ModoDoPreenchimento>("MEDIA");
  const [aviso, setAviso] = useState<string | null>(null);
  const [desmarcados, setDesmarcados] = useState<Set<PlanejamentoGrupoDeGasto>>(new Set());

  useEffect(() => {
    if (!aberto) return undefined;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    setAviso(null);
    getPlanejamentoRealizado(anoBase, ignorarSemLancamento)
      .then((r) => {
        if (cancelado) return;
        setDados(r);
      })
      .catch((e: unknown) => { if (!cancelado) { setDados(null); setErro(mensagemDe(e)); } })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [aberto, anoBase, ignorarSemLancamento]);

  // Começa de novo a cada abertura (e a cada ano-base): nada do uso anterior fica preso.
  useEffect(() => {
    if (aberto) setDesmarcados(new Set());
  }, [aberto, anoBase]);

  // Vem marcado tudo o que tem sugestão; só o que a pessoa desmarcou fica de fora, mesmo se a consulta mudar.
  const escolhidos = useMemo(() => (dados?.grupos ?? []).filter((g) => temSugestao(g) && !desmarcados.has(g.grupo)), [dados, desmarcados]);

  function alternar(grupo: PlanejamentoGrupoDeGasto) {
    setDesmarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(grupo)) novo.delete(grupo);
      else novo.add(grupo);
      return novo;
    });
  }

  function aplicar() {
    const { gastos: proximos, gruposAplicados } = aplicarRealizado(gastos, escolhidos, modo);
    onAplicar(proximos);
    const naoAplicados = escolhidos.filter((g) => !gruposAplicados.includes(g.grupo));
    if (naoAplicados.length === 0) {
      onFechar();
      return;
    }
    // Linha em % das vendas sem receita no DRE para calcular o percentual: não dá para preencher, e a pessoa precisa saber.
    setAviso(`Aplicado a ${gruposAplicados.length} ${gruposAplicados.length === 1 ? "grupo" : "grupos"}. Não aplicado: ${naoAplicados.map((g) => ROTULO_DO_GRUPO[g.grupo]).join(", ")} (a linha é em % das vendas e o DRE não tem receita nesses meses para calcular o percentual).`);
  }

  const semMesFechado = dados !== null && dados.mesesEncerrados.length === 0;

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title={`Preencher com o realizado de ${anoBase}`} description="Valores do DRE Gerencial, só de meses encerrados. Nada é gravado até você salvar o cenário." size="xl">
      <div className="plan-realizado">
        {erro && <Alert tone="error">{erro}</Alert>}
        {aviso && <Alert tone="warning">{aviso}</Alert>}
        {semMesFechado && <Alert tone="warning">{`Nenhum mês de ${anoBase} está encerrado ainda: não há realizado para sugerir.`}</Alert>}

        <div className="plan-barra">
          <Select aria-label="Forma de preencher" value={modo} onChange={(e) => setModo(e.target.value as ModoDoPreenchimento)} options={OPCOES_DE_MODO} containerClassName="plan-filtro plan-filtro-largo" />
          <label className="plan-check">
            <input type="checkbox" checked={ignorarSemLancamento} onChange={(e) => setIgnorarSemLancamento(e.target.checked)} />
            Ignorar meses sem lançamento na média
          </label>
        </div>

        {dados && !semMesFechado && (
          <div className="plan-quadro plan-quadro-estreito">
            <Table aria-label="Realizado por grupo de gasto">
              <Table.Head>
                <Table.Row>
                  <Table.Th scope="col">Usar</Table.Th>
                  <Table.Th>Grupo</Table.Th>
                  <Table.Th align="right">Média por mês</Table.Th>
                  <Table.Th align="right" title="Gasto do grupo ÷ receita bruta do DRE, para linhas em % das vendas">% da receita</Table.Th>
                  <Table.Th>Observação</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {dados.grupos.map((g) => (
                  <Table.Row key={g.grupo}>
                    <Table.Td>
                      <input type="checkbox" aria-label={`Usar ${ROTULO_DO_GRUPO[g.grupo]}`} checked={temSugestao(g) && !desmarcados.has(g.grupo)} disabled={!temSugestao(g)} onChange={() => alternar(g.grupo)} />
                    </Table.Td>
                    <Table.Th scope="row">{ROTULO_DO_GRUPO[g.grupo]}</Table.Th>
                    <Table.Td align="right">{g.media === null ? "—" : <Money value={g.media} decimals={0} />}</Table.Td>
                    <Table.Td align="right">{g.percentualDaReceita === null ? "—" : `${(g.percentualDaReceita * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</Table.Td>
                    <Table.Td>
                      {!g.origemNoDre ? "Sem origem no DRE: digite à mão."
                        : g.mesesSemLancamento.length > 0 ? `Sem lançamento em ${nomesDosMeses(g.mesesSemLancamento)}${ignorarSemLancamento ? " (fora da média)" : " (puxa a média para baixo)"}.`
                        : g.media !== null && g.media < 0 ? "Soma negativa no período (estornos?): digite à mão."
                        : g.media === null ? "Nenhum mês com lançamento."
                        : `${g.mesesConsiderados.length} ${g.mesesConsiderados.length === 1 ? "mês" : "meses"} na média.`}
                    </Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}

        <p className="plan-sub">O DRE é da empresa toda; a projeção é só do Salão. O gasto entra como custo da casa contra a venda do Salão, como na planilha; o % da receita usa a receita de todos os canais, então fica menor do que seria sobre o Salão sozinho. Só a primeira linha de cada grupo é preenchida; se o grupo não tem linha, ela é criada.</p>

        <div className="plan-dialogo-acoes">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="button" disabled={carregando || escolhidos.length === 0} onClick={aplicar}>{carregando ? "Buscando…" : `Aplicar a ${escolhidos.length} ${escolhidos.length === 1 ? "grupo" : "grupos"}`}</Button>
        </div>
      </div>
    </Dialog>
  );
}
