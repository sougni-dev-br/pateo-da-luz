// Folha salarial líquidos: a lista que vai para o pagamento no banco.
// CLT pelo líquido do extrato (ou pela regra do salário combinado); sem registro
// pelo total da apuração (salário ÷ 30 × dias + gorjeta − vales).
// O salário combinado se cadastra em Funcionários; aqui só aparece o efeito.
import { AlertTriangle, FileText, RefreshCw } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import {
  type SincronizacaoSalariosCombinados, type TipFolhaLiquidos, type TipLinhaFolha, getTipFolhaLiquidos, sincronizarSalariosCombinados,
} from "../../api/client";
import { Button, StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { exportarFolhaLiquidos } from "./exportarPdf";
import { BarraFiltro, opcoesDe, useFiltro } from "./filtro";
import { money, mutedStyle, panelStyle } from "./gorjetaUtils";
import { ApelidosContext, NomePessoa, textoPessoa } from "./NomePessoa";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

type Props = {
  year: number;
  month: number;
  canEdit: boolean;
  /** OK dado à contabilidade: a folha está pronta para pagar. */
  liberada: boolean;
  /** Muda quando extratos ou etapas mudam: recarrega a folha. */
  versao: string;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
};

const ORIGEM: Record<TipLinhaFolha["origem"], string> = {
  EXTRATO: "Extrato", SALARIO_COMBINADO: "Salário combinado", SEM_REGISTRO: "Sem registro",
};

const EXT: Extratores<TipLinhaFolha> = {
  nome: (l) => l.nome, origem: (l) => ORIGEM[l.origem], composicao: (l) => l.composicao, pix: (l) => l.pix, valor: (l) => l.valor,
};
const TEXTO = new Set(["nome", "origem", "composicao", "pix"]);
const COLUNAS: ColunaOpcional[] = [
  { chave: "origem", rotulo: "Origem" }, { chave: "composicao", rotulo: "Composição" }, { chave: "pix", rotulo: "PIX" }, { chave: "valor", rotulo: "Valor" },
];

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O que a atualização dos salários combinados mudou no Contas a Pagar. */
function ResultadoSincronizacao({ r }: { r: SincronizacaoSalariosCombinados }) {
  return (
    <div role="status" style={{ ...mutedStyle, display: "grid", gap: 4, padding: "8px 12px", borderLeft: "3px solid var(--info, #2563eb)" }}>
      <strong style={{ color: "var(--text, inherit)" }}>
        {r.alterados.length === 0
          ? "Contas a Pagar já estava com os salários combinados certos."
          : `${plural(r.alterados.length, "salário atualizado", "salários atualizados")} no Contas a Pagar (${r.competencia}).`}
      </strong>
      {r.alterados.map((a) => (
        <span key={a.payrollItemId}>
          {a.nome}: {money(a.antes)} → {money(a.depois)}{a.pendenteGorjeta ? " (gorjeta ainda não apurada)" : ""}
        </span>
      ))}
      {r.pagosIgnorados > 0 && <span>{plural(r.pagosIgnorados, "já pago, não alterado", "já pagos, não alterados")}.</span>}
      {r.avisos.map((a) => <span key={a} style={{ color: "var(--warning, #b45309)" }}>{a}</span>)}
    </div>
  );
}

export function FolhaLiquidos({ year, month, canEdit, liberada, versao, onNotice }: Props) {
  const [folha, setFolha] = useState<TipFolhaLiquidos | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [sincronizacao, setSincronizacao] = useState<SincronizacaoSalariosCombinados | null>(null);
  const ord = useOrdenacao("folha-liquidos");
  const col = useColunas("folha-liquidos");
  const filtro = useFiltro("folha-liquidos");
  // A folha só traz o nome: o apelido vem do cadastro, pelo funcionário.
  const apelidos = useContext(ApelidosContext);

  async function carregar() {
    try { setFolha(await getTipFolhaLiquidos(year, month)); } catch (e) { onNotice("error", (e as Error).message); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); setSincronizacao(null); }, [year, month, versao]);

  async function atualizarSalarios() {
    setSincronizando(true);
    try {
      setSincronizacao(await sincronizarSalariosCombinados(year, month));
    } catch (e) {
      onNotice("error", (e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  if (!folha) return <div style={panelStyle}><span style={mutedStyle}>Carregando a folha…</span></div>;
  // Contexto da página primeiro; o salário combinado já vem com o apelido.
  const apelidoDe = (l: TipLinhaFolha) => (l.employeeId
    ? apelidos.get(l.employeeId) ?? folha.salariosCombinados.find((s) => s.employeeId === l.employeeId)?.apelido ?? null
    : null);
  const filtradas = filtro.aplicar(folha.linhas,
    (l) => [textoPessoa(l.nome, apelidoDe(l)), l.grupo, l.pix ?? "", l.composicao].join(" "),
    { grupo: (l) => l.grupo, origem: (l) => ORIGEM[l.origem] });
  const ordenadas = aplicarOrdem(filtradas, ord.ordem, EXT);
  // Agrupado por empresa/grupo; a ordem escolhida vale dentro de cada grupo.
  const grupos = [...new Set(folha.linhas.map((l) => l.grupo))];
  const v = col.visivel;
  const antesDoValor = 1 + ["origem", "composicao", "pix"].filter(v).length;
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, TEXTO.has(c) ? "asc" : "desc") });
  const totalFiltro = filtradas.reduce((a, l) => a + l.valor, 0);

  return (
    <div style={panelStyle}>
      <div className="cabecalho-painel">
        <div className="cabecalho-painel-texto">
          <strong>Folha salarial líquidos {!liberada && <StatusBadge tone="warning">Prévia — falta o OK à contabilidade</StatusBadge>}</strong>
          <span>{folha.linhas.length} pessoas · total {money(folha.total)} · CLT pelo extrato, sem registro pela apuração</span>
        </div>
        <div className="cabecalho-painel-acoes">
          <SeletorColunas colunas={COLUNAS} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
          {canEdit && folha.salariosCombinados.length > 0 && (
            <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} />} disabled={sincronizando}
              title="Recalcula o salário ainda não pago de quem tem salário combinado: (combinado − adiantamento) + gorjeta"
              onClick={() => void atualizarSalarios()}>
              {sincronizando ? "Atualizando…" : "Atualizar salários combinados no Contas a Pagar"}
            </Button>
          )}
          <Button variant="secondary" size="sm" leadingIcon={<FileText size={14} />} disabled={folha.linhas.length === 0}
            title={filtro.ativo ? "O PDF sai com a folha inteira, sem o filtro" : undefined}
            onClick={() => void exportarFolhaLiquidos(folha, liberada).catch((e) => onNotice("error", "Erro ao gerar o PDF: " + (e as Error).message))}>
            PDF da folha
          </Button>
        </div>
      </div>
      {sincronizacao && <ResultadoSincronizacao r={sincronizacao} />}
      {folha.extratos.length === 0 && <span style={mutedStyle}>Sem extrato carregado: a lista só tem os sem registro.</span>}
      {folha.linhas.some((l) => l.origem === "SALARIO_COMBINADO") && (
        <span style={mutedStyle}>Salário combinado: definido na ficha do funcionário (Funcionários → seção Trabalho).</span>
      )}
      <BarraFiltro filtro={filtro} total={folha.linhas.length} visiveis={filtradas.length} placeholder="Filtrar por nome, apelido, empresa, PIX…"
        listas={[
          { chave: "grupo", rotulo: "Empresa/grupo", opcoes: opcoesDe(folha.linhas, (l) => l.grupo) },
          { chave: "origem", rotulo: "Origem", opcoes: opcoesDe(folha.linhas, (l) => ORIGEM[l.origem]) },
        ]} />
      {filtro.ativo && (
        <span style={{ ...mutedStyle, fontSize: 12 }}>Filtro só na tela: o PDF sai com a folha inteira ({folha.linhas.length} pessoas, {money(folha.total)}).</span>
      )}
      {filtradas.length === 0 && folha.linhas.length > 0 && <span style={mutedStyle}>Ninguém bate com o filtro.</span>}
      <Table className="tabela-gorjeta">
        <Table.Head>
          <Table.Row>
            <ThOrdenavel {...th("nome")} align="left" minWidth={220}>Funcionário</ThOrdenavel>
            {v("origem") && <ThOrdenavel {...th("origem")}>Origem</ThOrdenavel>}
            {v("composicao") && <ThOrdenavel {...th("composicao")} minWidth={220}>Composição</ThOrdenavel>}
            {v("pix") && <ThOrdenavel {...th("pix")}>PIX</ThOrdenavel>}
            {v("valor") && <ThOrdenavel {...th("valor")}>Valor</ThOrdenavel>}
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {grupos.map((g) => {
            const doGrupo = ordenadas.filter((l) => l.grupo === g);
            if (doGrupo.length === 0) return null;
            return [
              <Table.Row key={`g-${g}`} className="linha-grupo">
                <Table.Td colSpan={v("valor") ? antesDoValor : antesDoValor + 1} style={{ textAlign: "left", fontWeight: 700 }}>{g}</Table.Td>
                {v("valor") && <Table.Td style={{ fontWeight: 700 }}>{money(doGrupo.reduce((a, l) => a + l.valor, 0))}</Table.Td>}
              </Table.Row>,
              ...doGrupo.map((l) => (
                <Table.Row key={`${g}-${l.employeeId ?? l.nome}`}>
                  <Table.Td style={{ textAlign: "left" }}>
                    <NomePessoa nome={l.nome} employeeId={l.employeeId} apelido={apelidoDe(l)} />
                    {l.aviso && (
                      <div style={{ ...mutedStyle, color: "var(--warning, #b45309)", display: "flex", gap: 4, alignItems: "center" }}>
                        <AlertTriangle size={12} aria-hidden /> {l.aviso}
                      </div>
                    )}
                  </Table.Td>
                  {v("origem") && <Table.Td><StatusBadge tone={l.origem === "SALARIO_COMBINADO" ? "info" : "neutral"}>{ORIGEM[l.origem]}</StatusBadge></Table.Td>}
                  {v("composicao") && <Table.Td style={mutedStyle}>{l.composicao}</Table.Td>}
                  {v("pix") && <Table.Td style={mutedStyle}>{l.pix ?? <span style={{ color: "var(--warning, #b45309)" }}>sem PIX</span>}</Table.Td>}
                  {v("valor") && <Table.Td style={{ fontWeight: 700 }}>{money(l.valor)}</Table.Td>}
                </Table.Row>
              )),
            ];
          })}
          <Table.Row>
            <Table.Td colSpan={v("valor") ? antesDoValor : antesDoValor + 1} style={{ textAlign: "left", fontWeight: 700 }}>
              {filtro.ativo ? `Total do filtro (${filtradas.length} de ${folha.linhas.length})` : "Total a pagar"}
            </Table.Td>
            {v("valor") && <Table.Td style={{ fontWeight: 800 }}>{money(filtro.ativo ? totalFiltro : folha.total)}</Table.Td>}
          </Table.Row>
        </Table.Body>
      </Table>
    </div>
  );
}
