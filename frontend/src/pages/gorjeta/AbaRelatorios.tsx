import { Download, Plus, Trash2 } from "lucide-react";
import { useContext, useEffect, useMemo, useState } from "react";
import {
  type TipComputation, type TipEvolucao, type TipFuncaoHistorico, type TipMudanca, type TipMudancaTipo, type TipReservaMovimento,
  addTipReserveAdjustment, deleteTipReserveAdjustment, distributeTipReserve, getTipChanges, getTipEvolution, getTipFunctionHistory, getTipReserve,
} from "../../api/client";
import { Button, Money, StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { BarraFiltro, chaveCompetencia, opcoesCompetencia, opcoesDe, useFiltro } from "./filtro";
import { type ItemDistribuicao, problemaDoItem, resumirDistribuicao, valorDoItem } from "./reservaDistribuicao";
import "./gorjeta.css";
import { ApelidosContext, NomePessoa, nomeComApelido, resolverApelido, textoPessoa } from "./NomePessoa";
import { MONTHS, baixarCsv, hojeLocal, inputStyle, mesLocal, money, mutedStyle, numInputStyle, panelStyle, pts } from "./gorjetaUtils";
import { TIPO_MUDANCA, fmtDia } from "./HistoricoLinhaDoTempo";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";
import { RelatorioFechamentos } from "./RelatorioFechamentos";
import { RelatorioVales } from "./RelatorioVales";
import { useConfirmacao } from "./Confirmacao";

type Visao = "fechamentos" | "vales" | "mudancas" | "evolucao" | "reserva" | "funcoes";

type Props = {
  comp: TipComputation | null;
  canEdit: boolean;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
  onChanged: () => void;
};

const hoje = hojeLocal;
const inicioDoAno = () => `${new Date().getFullYear()}-01-01`;
const mesAtual = () => mesLocal();
const mesesAtras = (n: number) => mesLocal(n);
// Exportação sempre leva a tabela inteira; o aviso só aparece com filtro ligado.
const avisoExportacao = <span style={{ ...mutedStyle, fontSize: 12 }}>O Excel (CSV) leva todas as linhas, sem o filtro.</span>;
const SIM_NAO = [{ valor: "Sim", rotulo: "Sim" }, { valor: "Não", rotulo: "Não" }];

export function AbaRelatorios({ comp, canEdit, onNotice, onChanged }: Props) {
  const [visao, setVisao] = useState<Visao>("fechamentos");
  const erro = (e: unknown) => onNotice("error", (e as Error).message);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="barra-lista">
        <div className="barra-lista-segmento" role="group" aria-label="Relatório" style={{ marginLeft: 0 }}>
          {([["fechamentos", "Fechamentos"], ["vales", "Vales por período"], ["mudancas", "Mudanças de função e pontos"], ["evolucao", "Evolução mês a mês"], ["reserva", "Fundo de reserva"], ["funcoes", "Histórico das funções"]] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={visao === v} onClick={() => setVisao(v)}>{l}</button>
          ))}
        </div>
      </div>
      {visao === "fechamentos" && <RelatorioFechamentos onErro={erro} />}
      {visao === "vales" && <RelatorioVales onErro={erro} />}
      {visao === "mudancas" && <RelatorioMudancas onErro={erro} />}
      {visao === "evolucao" && <RelatorioEvolucao onErro={erro} />}
      {visao === "reserva" && <FundoReserva comp={comp} canEdit={canEdit} onNotice={onNotice} onChanged={onChanged} />}
      {visao === "funcoes" && <HistoricoFuncoes onErro={erro} />}
    </div>
  );
}

// ─── Mudanças de função e pontos ────────────────────────────────────────────
const COLUNAS_MUD: ColunaOpcional[] = [
  { chave: "data", rotulo: "Vigência" }, { chave: "tipo", rotulo: "Tipo" }, { chave: "funcao", rotulo: "Função" }, { chave: "antes", rotulo: "Pontos antes" },
  { chave: "depois", rotulo: "Pontos depois" }, { chave: "dif", rotulo: "Diferença" }, { chave: "motivo", rotulo: "Motivo" },
];
const EXT_MUD: Extratores<TipMudanca> = {
  data: (m) => m.validFrom, nome: (m) => m.employeeName, tipo: (m) => TIPO_MUDANCA[m.tipo].rotulo,
  funcao: (m) => m.funcaoDepois, antes: (m) => m.baseAntes, depois: (m) => m.baseDepois, dif: (m) => m.diferenca, motivo: (m) => m.motivo,
};
const TEXTO_MUD = new Set(["nome", "tipo", "funcao", "motivo"]);

function RelatorioMudancas({ onErro }: { onErro: (e: unknown) => void }) {
  const [de, setDe] = useState(inicioDoAno());
  const [ate, setAte] = useState(hoje());
  const [tipo, setTipo] = useState<"todas" | TipMudancaTipo>("todas");
  const [incluirInicial, setIncluirInicial] = useState(false);
  const [dados, setDados] = useState<TipMudanca[]>([]);
  const ord = useOrdenacao("rel-mudancas");
  const col = useColunas("rel-mudancas");
  const v = col.visivel;
  const filtro = useFiltro("relatorio-mudancas");
  const apelidos = useContext(ApelidosContext);
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, TEXTO_MUD.has(c) ? "asc" : "desc") });

  useEffect(() => {
    getTipChanges(de || undefined, ate || undefined).then(setDados).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate]);

  const visiveis = dados.filter((m) => (incluirInicial || m.tipo !== "INICIAL") && (tipo === "todas" || m.tipo === tipo));
  const textoMud = (m: TipMudanca) =>
    [textoPessoa(m.employeeName, resolverApelido(apelidos, m.employeeId, m.apelido)), m.funcaoAntes ?? "", m.funcaoDepois ?? "", m.motivo ?? ""].join(" ");
  const camposMud = { funcao: (m: TipMudanca) => m.funcaoDepois, participa: (m: TipMudanca) => (m.participa ? "Sim" : "Não") };
  const filtradas = filtro.aplicar(visiveis, textoMud, camposMud);
  const listasFiltro = [
    { chave: "funcao", rotulo: "Função", opcoes: opcoesDe(visiveis, (m) => m.funcaoDepois) },
    { chave: "participa", rotulo: "Participa", opcoes: SIM_NAO },
  ];
  const linhas = aplicarOrdem(filtradas, ord.ordem, EXT_MUD);
  // As contagens seguem o filtro de texto/lista (não o seletor de tipo, que é o que elas detalham).
  const baseContagem = filtro.ativo ? filtro.aplicar(dados, textoMud, camposMud) : dados;
  const conta = (t: TipMudancaTipo) => baseContagem.filter((m) => m.tipo === t).length;

  function exportar() {
    baixarCsv(`gorjeta-mudancas-${de}-a-${ate}.csv`, [
      ["Vigência", "Funcionário", "Tipo", "Função antes", "Função depois", "Pontos antes", "Pontos depois", "Diferença", "Motivo"],
      ...aplicarOrdem(visiveis, ord.ordem, EXT_MUD).map((m) => [fmtDia(m.validFrom), m.employeeName, TIPO_MUDANCA[m.tipo].rotulo, m.funcaoAntes, m.funcaoDepois, m.baseAntes, m.baseDepois, m.diferenca, m.motivo]),
    ]);
  }

  return (
    <div style={panelStyle}>
      <div className="barra-lista">
        <label className="barra-lista-campo">De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={{ ...inputStyle, width: "auto" }} /></label>
        <label className="barra-lista-campo">até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={{ ...inputStyle, width: "auto" }} /></label>
        <label className="barra-lista-campo">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="todas">Todas</option>
            {(["PROMOCAO", "REDUCAO", "TROCA_DE_FUNCAO", "ENTRADA", "SAIDA"] as const).map((t) => <option key={t} value={t}>{TIPO_MUDANCA[t].rotulo}</option>)}
          </select>
        </label>
        <label className="barra-lista-campo">
          <input type="checkbox" checked={incluirInicial} onChange={(e) => setIncluirInicial(e.target.checked)} /> Mostrar situação inicial
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <SeletorColunas colunas={COLUNAS_MUD} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
          <Button variant="secondary" leadingIcon={<Download size={14} />} onClick={exportar} disabled={visiveis.length === 0}>Excel (CSV)</Button>
        </div>
      </div>
      <BarraFiltro filtro={filtro} listas={listasFiltro} total={visiveis.length} visiveis={filtradas.length}
        placeholder="Filtrar por nome, apelido, função, motivo…" />
      {filtro.ativo && avisoExportacao}
      <div className="grupo-cabecalho" style={{ position: "static" }}>
        {filtro.ativo && <span className="grupo-chip">Total do filtro ({filtradas.length} de {visiveis.length})</span>}
        <span className="grupo-chip" style={{ color: "var(--success)" }}>{conta("PROMOCAO")} promoções</span>
        <span className="grupo-chip" style={{ color: "var(--danger)" }}>{conta("REDUCAO")} reduções</span>
        <span className="grupo-chip">{conta("TROCA_DE_FUNCAO")} trocas de função</span>
        <span className="grupo-chip">{conta("ENTRADA")} entradas · {conta("SAIDA")} saídas</span>
      </div>
      {linhas.length === 0 ? <span style={mutedStyle}>{visiveis.length > 0 ? "Nenhuma mudança bate com o filtro." : "Nenhuma mudança no período escolhido."}</span> : (
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...th("nome")} align="left" minWidth={200}>Funcionário</ThOrdenavel>
              {v("data") && <ThOrdenavel {...th("data")}>Vigência</ThOrdenavel>}
              {v("tipo") && <ThOrdenavel {...th("tipo")}>Tipo</ThOrdenavel>}
              {v("funcao") && <ThOrdenavel {...th("funcao")}>Função</ThOrdenavel>}
              {v("antes") && <ThOrdenavel {...th("antes")}>Pontos antes</ThOrdenavel>}
              {v("depois") && <ThOrdenavel {...th("depois")}>Pontos depois</ThOrdenavel>}
              {v("dif") && <ThOrdenavel {...th("dif")}>Diferença</ThOrdenavel>}
              {v("motivo") && <ThOrdenavel {...th("motivo")}>Motivo</ThOrdenavel>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {linhas.map((m) => (
              <Table.Row key={m.id}>
                <Table.Td style={{ textAlign: "left" }}><NomePessoa nome={m.employeeName} employeeId={m.employeeId} apelido={m.apelido} /></Table.Td>
                {v("data") && <Table.Td>{fmtDia(m.validFrom)}</Table.Td>}
                {v("tipo") && <Table.Td><StatusBadge tone={TIPO_MUDANCA[m.tipo].tom}>{TIPO_MUDANCA[m.tipo].rotulo}</StatusBadge></Table.Td>}
                {v("funcao") && (
                  <Table.Td>
                    {m.funcaoAntes && m.funcaoAntes !== m.funcaoDepois && <span style={mutedStyle}>{m.funcaoAntes} → </span>}
                    {m.funcaoDepois ?? "—"}
                  </Table.Td>
                )}
                {v("antes") && <Table.Td>{pts(m.baseAntes)}</Table.Td>}
                {v("depois") && <Table.Td style={{ fontWeight: 700 }}>{pts(m.baseDepois)}</Table.Td>}
                {v("dif") && (
                  <Table.Td style={{ fontWeight: 700, color: (m.diferenca ?? 0) > 0 ? "var(--success)" : (m.diferenca ?? 0) < 0 ? "var(--danger)" : undefined }}>
                    {m.diferenca ? `${m.diferenca > 0 ? "+" : "−"}${pts(Math.abs(m.diferenca))}` : "—"}
                  </Table.Td>
                )}
                {v("motivo") && <Table.Td style={{ ...mutedStyle, textAlign: "left" }}>{m.motivo ?? "—"}</Table.Td>}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}

// ─── Evolução mês a mês ─────────────────────────────────────────────────────
type Medida = "pontos" | "gorjeta" | "funcao";

function RelatorioEvolucao({ onErro }: { onErro: (e: unknown) => void }) {
  const [de, setDe] = useState(mesesAtras(11));
  const [ate, setAte] = useState(mesAtual());
  const [medida, setMedida] = useState<Medida>("pontos");
  const [dados, setDados] = useState<TipEvolucao | null>(null);
  const ord = useOrdenacao("relatorio-evolucao");
  const col = useColunas("relatorio-evolucao");
  const filtro = useFiltro("relatorio-evolucao");
  const apelidos = useContext(ApelidosContext);

  useEffect(() => {
    getTipEvolution(de, ate).then(setDados).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate]);

  const chaves = useMemo(() => (dados?.competencias ?? []).map((c) => `${c.ano}-${String(c.mes).padStart(2, "0")}`), [dados]);

  // Pontos: finais do mês fechado, ou base enquanto está em apuração.
  const valor = (c: TipEvolucao["linhas"][number]["meses"][string]) => {
    if (!c) return null;
    if (medida === "gorjeta") return c.gorjeta;
    if (medida === "pontos") return c.pontos ?? c.base;
    return null;
  };

  type LinhaEvo = TipEvolucao["linhas"][number];
  const rotuloMes = (k: string) => `${MONTHS[Number(k.slice(5)) - 1].slice(0, 3)}/${k.slice(2, 4)}`;
  const colunasMeses: ColunaOpcional[] = chaves.map((k) => ({ chave: k, rotulo: rotuloMes(k) }));
  const mesesVisiveis = chaves.filter(col.visivel);
  // Cada mês ordena pelo que está na tela (pontos, R$ ou função).
  const extratores: Extratores<LinhaEvo> = {
    nome: (l) => l.employeeName,
    ...Object.fromEntries(chaves.map((k) => [k, (l: LinhaEvo) => (medida === "funcao" ? l.meses[k]?.funcao ?? null : valor(l.meses[k]))])),
  };
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, c === "nome" || medida === "funcao" ? "asc" : "desc") });
  const todas = dados?.linhas ?? [];
  const ultimaFuncao = (l: LinhaEvo) => [...chaves].reverse().map((k) => l.meses[k]?.funcao).find(Boolean) ?? null;
  const listasFiltro = [{ chave: "funcao", rotulo: "Última função", opcoes: opcoesDe(todas, ultimaFuncao) }];
  const filtradas = filtro.aplicar(todas,
    (l) => [textoPessoa(l.employeeName, resolverApelido(apelidos, l.employeeId, l.apelido)), ...chaves.map((k) => l.meses[k]?.funcao ?? "")].join(" "),
    { funcao: ultimaFuncao });
  const linhas = aplicarOrdem(filtradas, ord.ordem, extratores);

  function exportar() {
    if (!dados) return;
    baixarCsv(`gorjeta-evolucao-${medida}-${de}-a-${ate}.csv`, [
      ["Funcionário", ...chaves.map((k) => `${MONTHS[Number(k.slice(5)) - 1].slice(0, 3)}/${k.slice(0, 4)}`)],
      ...dados.linhas.map((l) => [l.employeeName, ...chaves.map((k) => (medida === "funcao" ? l.meses[k]?.funcao ?? null : valor(l.meses[k])))]),
    ]);
  }

  return (
    <div style={panelStyle}>
      <div className="barra-lista">
        <label className="barra-lista-campo">De <input type="month" value={de} onChange={(e) => setDe(e.target.value)} style={{ ...inputStyle, width: "auto" }} /></label>
        <label className="barra-lista-campo">até <input type="month" value={ate} onChange={(e) => setAte(e.target.value)} style={{ ...inputStyle, width: "auto" }} /></label>
        <div className="barra-lista-segmento" role="group" aria-label="Medida">
          {([["pontos", "Pontos"], ["gorjeta", "Gorjeta R$"], ["funcao", "Função"]] as const).map(([m, l]) => (
            <button key={m} type="button" aria-pressed={medida === m} onClick={() => setMedida(m)}>{l}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <SeletorColunas colunas={colunasMeses} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
          <Button variant="secondary" leadingIcon={<Download size={14} />} onClick={exportar} disabled={!dados?.linhas.length}>Excel (CSV)</Button>
        </div>
      </div>
      <span style={mutedStyle}>
        Retrato de cada competência. Verde = subiu em relação ao mês anterior; vermelho = caiu. Mês em apuração mostra os pontos-base (itálico) e ainda não tem valor.
      </span>
      {todas.length > 0 && (
        <BarraFiltro filtro={filtro} listas={listasFiltro} total={todas.length} visiveis={filtradas.length}
          placeholder="Filtrar por nome, apelido, função…" />
      )}
      {filtro.ativo && avisoExportacao}
      {!dados || dados.linhas.length === 0 ? <span style={mutedStyle}>Nenhuma competência no intervalo.</span> : linhas.length === 0 ? <span style={mutedStyle}>Ninguém bate com o filtro.</span> : (
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...th("nome")} align="left" minWidth={200}>Funcionário</ThOrdenavel>
              {dados.competencias.map((c, i) => {
                const k = chaves[i];
                if (!col.visivel(k)) return null;
                return (
                  <ThOrdenavel key={k} {...th(k)} title={c.status === "OPEN" ? "Em apuração" : `Ponto: ${money(c.pointValue)}`}>
                    {`${rotuloMes(k)}${c.status === "OPEN" ? " •" : ""}`}
                  </ThOrdenavel>
                );
              })}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {linhas.map((l) => (
              <Table.Row key={l.employeeId}>
                <Table.Td style={{ textAlign: "left" }}><NomePessoa nome={l.employeeName} employeeId={l.employeeId} apelido={l.apelido} /></Table.Td>
                {chaves.map((k, i) => {
                  if (!col.visivel(k)) return null;
                  const c = l.meses[k];
                  if (medida === "funcao") {
                    const antes = i > 0 ? l.meses[chaves[i - 1]]?.funcao : undefined;
                    return <Table.Td key={k} style={{ fontSize: 12, fontWeight: antes && c?.funcao && antes !== c.funcao ? 700 : 400 }}>{c?.funcao ?? "—"}</Table.Td>;
                  }
                  const atual = valor(c);
                  const anterior = i > 0 ? valor(l.meses[chaves[i - 1]]) : null;
                  const cor = atual != null && anterior != null && atual !== anterior ? (atual > anterior ? "var(--success)" : "var(--danger)") : undefined;
                  const emApuracao = c && c.pontos == null && medida === "pontos";
                  return (
                    <Table.Td key={k} style={{ color: cor, fontWeight: cor ? 700 : 400, fontStyle: emApuracao ? "italic" : undefined, fontVariantNumeric: "tabular-nums" }}>
                      {atual == null ? "—" : medida === "gorjeta" ? money(atual) : pts(atual)}
                    </Table.Td>
                  );
                })}
              </Table.Row>
            ))}
            {medida === "gorjeta" && (
              <Table.Row>
                <Table.Td style={{ fontWeight: 700, background: "var(--paper-soft)", textAlign: "left" }}>
                  {filtro.ativo ? `Total do filtro (${filtradas.length} de ${todas.length})` : "Total"}
                </Table.Td>
                {mesesVisiveis.map((k) => (
                  <Table.Td key={k} style={{ fontWeight: 700, background: "var(--paper-soft)" }}>
                    {money(filtradas.reduce((a, l) => a + (l.meses[k]?.gorjeta ?? 0), 0))}
                  </Table.Td>
                ))}
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}

// ─── Fundo de reserva ───────────────────────────────────────────────────────
const TIPO_MOV: Record<TipReservaMovimento["type"], string> = {
  FECHAMENTO_RESERVA: "Reserva do mês", FECHAMENTO_SALDO: "Saldo do mês", DISTRIBUICAO: "Distribuição", AJUSTE: "Ajuste",
};
const COLUNAS_MOV: ColunaOpcional[] = [
  { chave: "tipo", rotulo: "Tipo" }, { chave: "competencia", rotulo: "Competência" }, { chave: "descricao", rotulo: "Descrição" }, { chave: "valor", rotulo: "Valor" }, { chave: "saldo", rotulo: "Saldo" },
];
// Competência vem "MM/AAAA": ordena pelo tempo (AAAAMM), não pelo texto.
const EXT_MOV: Extratores<TipReservaMovimento> = {
  data: (m) => m.date, tipo: (m) => TIPO_MOV[m.type], competencia: (m) => chaveCompetencia(m.competencia), nome: (m) => m.employeeName,
  descricao: (m) => m.notes, valor: (m) => m.amount, saldo: (m) => m.saldo,
};
const TEXTO_MOV = new Set(["tipo", "nome", "descricao"]);

function FundoReserva({ comp, canEdit, onNotice, onChanged }: Props) {
  const { confirmar, caixa } = useConfirmacao();
  const [dados, setDados] = useState<{ saldo: number; movimentos: TipReservaMovimento[] } | null>(null);
  const [ajuste, setAjuste] = useState({ valor: "", descricao: "", data: hoje() });
  const [itens, setItens] = useState<ItemDistribuicao[]>([{ employeeId: "", valor: "", descricao: "" }]);
  // Gravando: segura os botões para um clique duplo não lançar duas vezes.
  const [ocupado, setOcupado] = useState(false);
  const erro = (e: unknown) => onNotice("error", (e as Error).message);
  const apelidos = useContext(ApelidosContext);
  const ord = useOrdenacao("relatorio-reserva");
  const col = useColunas("relatorio-reserva");
  const v = col.visivel;
  const filtro = useFiltro("relatorio-reserva");
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, TEXTO_MOV.has(c) ? "asc" : "desc") });

  const carregar = () => getTipReserve().then(setDados).catch(erro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, []);

  const podeDistribuir = canEdit && comp?.periodId != null && comp.status === "OPEN";
  // Só as linhas que serão enviadas entram no total; as outras aparecem marcadas.
  const { validos, total: totalDistribuir, foraDaConta } = resumirDistribuicao(itens);
  const pessoas = (comp?.participants ?? []).filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO")
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR"));
  const movimentos = dados?.movimentos ?? [];
  const listasFiltro = [
    { chave: "tipo", rotulo: "Tipo", opcoes: opcoesDe(movimentos, (m) => TIPO_MOV[m.type]) },
    { chave: "competencia", rotulo: "Competência", opcoes: opcoesCompetencia(movimentos, (m) => m.competencia) },
  ];
  const movFiltrados = filtro.aplicar(movimentos,
    (m) => [TIPO_MOV[m.type], m.competencia ?? "",
      m.employeeName ? textoPessoa(m.employeeName, resolverApelido(apelidos, m.employeeId, m.apelido)) : "", m.notes ?? ""].join(" "),
    { tipo: (m) => TIPO_MOV[m.type], competencia: (m) => m.competencia });
  const movLinhas = aplicarOrdem(movFiltrados, ord.ordem, EXT_MOV);

  async function lancarAjuste() {
    if (ocupado) return;
    const valor = Number(ajuste.valor.replace(",", "."));
    if (!valor) return onNotice("warning", "Informe o valor do ajuste (negativo para retirar).");
    setOcupado(true);
    try {
      await addTipReserveAdjustment({ amount: valor, notes: ajuste.descricao, date: ajuste.data });
      setAjuste({ valor: "", descricao: "", data: hoje() });
      await carregar();
      onNotice("success", "Ajuste lançado no fundo.");
    } catch (e) { erro(e); } finally { setOcupado(false); }
  }

  async function apagarAjuste(id: string) {
    if (ocupado) return;
    if (!(await confirmar({ titulo: "Apagar este ajuste do fundo?", texto: "O saldo do fundo volta ao que era antes do ajuste. A auditoria guarda o que foi apagado.", confirmar: "Apagar ajuste", perigo: true }))) return;
    setOcupado(true);
    try { await deleteTipReserveAdjustment(id); await carregar(); } catch (e) { erro(e); } finally { setOcupado(false); }
  }

  async function distribuir() {
    if (!comp?.periodId || ocupado) return;
    // O que se confirma é exatamente o que se envia: as mesmas linhas e o mesmo total.
    const enviar = validos.map((i) => ({ employeeId: i.employeeId, amount: valorDoItem(i.valor), notes: i.descricao.trim() || undefined }));
    if (enviar.length === 0) return onNotice("warning", "Escolha ao menos um funcionário e um valor.");
    const fora = foraDaConta > 0 ? ` ${foraDaConta} linha(s) com problema ficam de fora.` : "";
    if (!(await confirmar({
      titulo: `Distribuir ${money(totalDistribuir)} do fundo?`,
      texto: `Vira crédito na gorjeta de ${MONTHS[comp.month - 1]}/${comp.year} de ${enviar.length} pessoa(s) e sai do saldo do fundo.${fora}`,
      confirmar: "Distribuir",
    }))) return;
    setOcupado(true);
    try {
      await distributeTipReserve(comp.periodId, enviar);
      setItens([{ employeeId: "", valor: "", descricao: "" }]);
      await carregar();
      onChanged();
      onNotice("success", "Reserva distribuída: os créditos aparecem na aba Vales de cada pessoa.");
    } catch (e) { erro(e); } finally { setOcupado(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {caixa}
      <div style={{ ...panelStyle, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 24 }}>
        <div>
          <div style={mutedStyle}>Saldo do fundo de reserva</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: (dados?.saldo ?? 0) < 0 ? "var(--danger)" : "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
            {money(dados?.saldo ?? 0)}
          </div>
        </div>
        {comp?.periodId && (
          <div style={mutedStyle}>
            {MONTHS[comp.month - 1]}/{comp.year}: reserva de {pts(comp.reservaPontos)} pts = <strong>{money(comp.reservaTotal)}</strong>
            {comp.saldo > 0 && <> + saldo de <strong>{money(comp.saldo)}</strong></>}
            {comp.status === "CLOSED" ? " (já no fundo)" : " — entra no fundo ao fechar"}
          </div>
        )}
      </div>

      {canEdit && (
        <div style={panelStyle}>
          <strong>Lançar ajuste <span style={{ ...mutedStyle, fontWeight: 400 }}>— saldo inicial, correção ou retirada (valor negativo)</span></strong>
          <div className="barra-lista">
            <input type="date" value={ajuste.data} onChange={(e) => setAjuste({ ...ajuste, data: e.target.value })} style={{ ...inputStyle, width: "auto" }} aria-label="Data do ajuste" />
            <input type="number" step="0.01" inputMode="decimal" value={ajuste.valor} placeholder="Valor R$" onChange={(e) => setAjuste({ ...ajuste, valor: e.target.value })} style={{ ...numInputStyle, width: 130 }} aria-label="Valor do ajuste" />
            <input value={ajuste.descricao} placeholder="Descrição (ex.: saldo guardado até set/2026)" onChange={(e) => setAjuste({ ...ajuste, descricao: e.target.value })}
              style={{ ...inputStyle, flex: "1 1 260px", width: "auto" }} aria-label="Descrição do ajuste" />
            <Button onClick={() => void lancarAjuste()} leadingIcon={<Plus size={14} />} disabled={ocupado || !ajuste.valor || !ajuste.descricao.trim()}>{ocupado ? "Gravando…" : "Lançar"}</Button>
          </div>
        </div>
      )}

      <div style={panelStyle}>
        <strong>Distribuir a reserva <span style={{ ...mutedStyle, fontWeight: 400 }}>— vira crédito na gorjeta de {comp ? `${MONTHS[comp.month - 1]}/${comp.year}` : "um período aberto"}</span></strong>
        {!podeDistribuir ? (
          <span style={mutedStyle}>Abra (ou reabra) a competência na Apuração para distribuir; o período fechado não recebe créditos.</span>
        ) : (
          <>
            {itens.map((it, idx) => {
              // A linha única ainda em branco não é problema: é o formulário esperando.
              const problema = itens.length === 1 && !it.employeeId && !it.valor.trim() ? null : problemaDoItem(it);
              const nomeLinha = pessoas.find((p) => p.employeeId === it.employeeId)?.employeeName;
              return (
                <div key={idx} className="barra-lista">
                  <select value={it.employeeId} onChange={(e) => setItens(itens.map((x, j) => (j === idx ? { ...x, employeeId: e.target.value } : x)))}
                    style={{ ...inputStyle, width: 260 }} aria-label={`Funcionário da linha ${idx + 1}`} aria-invalid={problema ? true : undefined} disabled={ocupado}>
                    <option value="">Funcionário…</option>
                    {pessoas.map((p) => <option key={p.employeeId} value={p.employeeId}>{nomeComApelido(p.employeeName, p.apelido)}</option>)}
                  </select>
                  <input type="number" step="0.01" inputMode="decimal" min="0" value={it.valor} placeholder="Valor R$" disabled={ocupado}
                    onChange={(e) => setItens(itens.map((x, j) => (j === idx ? { ...x, valor: e.target.value } : x)))} style={{ ...numInputStyle, width: 120 }}
                    aria-label={nomeLinha ? `Valor para ${nomeLinha}` : `Valor da linha ${idx + 1}`} aria-invalid={problema ? true : undefined} />
                  <input value={it.descricao} placeholder="Descrição (opcional)" disabled={ocupado}
                    onChange={(e) => setItens(itens.map((x, j) => (j === idx ? { ...x, descricao: e.target.value } : x)))} style={{ ...inputStyle, flex: "1 1 200px", width: "auto" }}
                    aria-label={nomeLinha ? `Descrição para ${nomeLinha}` : `Descrição da linha ${idx + 1}`} />
                  {itens.length > 1 && (
                    <button type="button" onClick={() => setItens(itens.filter((_, j) => j !== idx))} aria-label={`Remover linha ${idx + 1}`} disabled={ocupado}
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><Trash2 size={15} /></button>
                  )}
                  {problema && <StatusBadge tone="warning" title="Esta linha não entra no total nem é enviada">{problema}</StatusBadge>}
                </div>
              );
            })}
            <div className="barra-lista">
              <Button variant="secondary" leadingIcon={<Plus size={14} />} disabled={ocupado} onClick={() => setItens([...itens, { employeeId: "", valor: "", descricao: "" }])}>Mais uma pessoa</Button>
              <span style={{ marginLeft: "auto" }}>
                Total: <strong>{money(totalDistribuir)}</strong> de {money(dados?.saldo ?? 0)}
                {validos.length > 0 && foraDaConta > 0 && (
                  <span style={{ ...mutedStyle, display: "block", fontSize: 12 }}>{validos.length} pessoa(s); {foraDaConta} linha(s) marcada(s) ficam de fora</span>
                )}
              </span>
              <Button onClick={() => void distribuir()} disabled={ocupado || totalDistribuir <= 0 || totalDistribuir > (dados?.saldo ?? 0) + 0.005}>
                {ocupado ? "Gravando…" : "Distribuir"}
              </Button>
            </div>
          </>
        )}
      </div>

      <div style={panelStyle}>
        <div className="barra-lista">
          <strong>Extrato</strong>
          {movimentos.length > 0 && (
            <div style={{ marginLeft: "auto" }}>
              <SeletorColunas colunas={COLUNAS_MOV} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
            </div>
          )}
        </div>
        {movimentos.length > 0 && (
          <BarraFiltro filtro={filtro} listas={listasFiltro} total={movimentos.length} visiveis={movFiltrados.length}
            placeholder="Filtrar por funcionário, apelido, descrição, competência…" />
        )}
        {filtro.ativo && movFiltrados.length > 0 && (
          <span style={mutedStyle}>
            Total do filtro ({movFiltrados.length} de {movimentos.length}): <strong>{money(movFiltrados.reduce((a, m) => a + m.amount, 0))}</strong>.
            A coluna Saldo continua sendo o saldo do fundo após cada lançamento.
          </span>
        )}
        {!dados || movimentos.length === 0 ? <span style={mutedStyle}>Sem lançamentos ainda. A reserva entra no fundo ao fechar cada período.</span>
          : movLinhas.length === 0 ? <span style={mutedStyle}>Nenhum lançamento bate com o filtro.</span> : (
          <Table className="tabela-gorjeta">
            <Table.Head>
              <Table.Row>
                <ThOrdenavel {...th("data")}>Data</ThOrdenavel>
                {v("tipo") && <ThOrdenavel {...th("tipo")}>Tipo</ThOrdenavel>}
                {v("competencia") && <ThOrdenavel {...th("competencia")}>Competência</ThOrdenavel>}
                <ThOrdenavel {...th("nome")} align="left">Funcionário</ThOrdenavel>
                {v("descricao") && <ThOrdenavel {...th("descricao")}>Descrição</ThOrdenavel>}
                {v("valor") && <ThOrdenavel {...th("valor")}>Valor</ThOrdenavel>}
                {v("saldo") && <ThOrdenavel {...th("saldo")}>Saldo</ThOrdenavel>}
                <Table.Th aria-label="Ações"> </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {movLinhas.map((m) => (
                <Table.Row key={m.id}>
                  <Table.Td>{fmtDia(m.date)}</Table.Td>
                  {v("tipo") && <Table.Td><StatusBadge tone={m.amount < 0 ? "warning" : "success"}>{TIPO_MOV[m.type]}</StatusBadge></Table.Td>}
                  {v("competencia") && <Table.Td>{m.competencia ?? "—"}</Table.Td>}
                  <Table.Td style={{ textAlign: "left" }}>{m.employeeName ? <NomePessoa nome={m.employeeName} employeeId={m.employeeId} apelido={m.apelido} /> : "—"}</Table.Td>
                  {v("descricao") && <Table.Td style={{ ...mutedStyle, textAlign: "left" }}>{m.notes ?? "—"}</Table.Td>}
                  {v("valor") && <Table.Td style={{ fontWeight: 700, color: m.amount < 0 ? "var(--danger)" : "var(--success)" }}><Money value={m.amount} /></Table.Td>}
                  {v("saldo") && <Table.Td><Money value={m.saldo} /></Table.Td>}
                  <Table.Td>
                    {m.removivel && canEdit && (
                      <button type="button" onClick={() => void apagarAjuste(m.id)} aria-label="Apagar ajuste" disabled={ocupado}
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><Trash2 size={14} /></button>
                    )}
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </div>
  );
}

// ─── Alterações na tabela de funções ────────────────────────────────────────
const COLUNAS_HIST: ColunaOpcional[] = [
  { chave: "data", rotulo: "Data" }, { chave: "antes", rotulo: "Pontos antes" }, { chave: "depois", rotulo: "Pontos depois" }, { chave: "faixa", rotulo: "Faixa" },
];
const EXT_HIST: Extratores<TipFuncaoHistorico> = {
  nome: (h) => h.name, data: (h) => h.createdAt, antes: (h) => h.pointsBefore, depois: (h) => h.pointsAfter, faixa: (h) => h.minPoints ?? h.maxPoints,
};
const mudouDe = (h: TipFuncaoHistorico) =>
  h.pointsBefore == null ? "Nova" : h.pointsAfter > h.pointsBefore ? "Subiu" : h.pointsAfter < h.pointsBefore ? "Desceu" : "Pontos iguais";

function HistoricoFuncoes({ onErro }: { onErro: (e: unknown) => void }) {
  const [dados, setDados] = useState<TipFuncaoHistorico[]>([]);
  const ord = useOrdenacao("relatorio-funcoes-historico");
  const col = useColunas("relatorio-funcoes-historico");
  const v = col.visivel;
  const filtro = useFiltro("relatorio-funcoes-historico");
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, c === "nome" ? "asc" : "desc") });
  useEffect(() => {
    getTipFunctionHistory().then(setDados).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const listasFiltro = [
    { chave: "funcao", rotulo: "Função", opcoes: opcoesDe(dados, (h) => h.name) },
    { chave: "mudanca", rotulo: "Mudança", opcoes: ["Nova", "Subiu", "Desceu", "Pontos iguais"].map((x) => ({ valor: x, rotulo: x })) },
  ];
  const filtrados = filtro.aplicar(dados, (h) => h.name, { funcao: (h) => h.name, mudanca: mudouDe });
  const linhas = aplicarOrdem(filtrados, ord.ordem, EXT_HIST);
  return (
    <div style={panelStyle}>
      <div className="barra-lista">
        <span style={{ ...mutedStyle, flex: "1 1 320px" }}>Cada vez que os pontos, o nome ou a faixa de uma função mudam. Quem estava na função ganha a linha correspondente no próprio histórico.</span>
        {dados.length > 0 && <SeletorColunas colunas={COLUNAS_HIST} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />}
      </div>
      {dados.length > 0 && (
        <BarraFiltro filtro={filtro} listas={listasFiltro} total={dados.length} visiveis={filtrados.length} placeholder="Filtrar por função…" />
      )}
      {dados.length === 0 ? <span style={mutedStyle}>Nenhuma alteração registrada na tabela de funções.</span>
        : linhas.length === 0 ? <span style={mutedStyle}>Nenhuma alteração bate com o filtro.</span> : (
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...th("nome")} align="left">Função</ThOrdenavel>
              {v("data") && <ThOrdenavel {...th("data")}>Data</ThOrdenavel>}
              {v("antes") && <ThOrdenavel {...th("antes")}>Pontos antes</ThOrdenavel>}
              {v("depois") && <ThOrdenavel {...th("depois")}>Pontos depois</ThOrdenavel>}
              {v("faixa") && <ThOrdenavel {...th("faixa")}>Faixa</ThOrdenavel>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {linhas.map((h) => (
              <Table.Row key={h.id}>
                <Table.Td style={{ fontWeight: 500, textAlign: "left" }}>{h.name}</Table.Td>
                {v("data") && <Table.Td>{new Date(h.createdAt).toLocaleDateString("pt-BR")}</Table.Td>}
                {v("antes") && <Table.Td>{h.pointsBefore == null ? "nova" : pts(h.pointsBefore)}</Table.Td>}
                {v("depois") && (
                  <Table.Td style={{ fontWeight: 700, color: h.pointsBefore != null && h.pointsAfter !== h.pointsBefore ? (h.pointsAfter > h.pointsBefore ? "var(--success)" : "var(--danger)") : undefined }}>
                    {pts(h.pointsAfter)}
                  </Table.Td>
                )}
                {v("faixa") && <Table.Td>{h.minPoints != null || h.maxPoints != null ? `${pts(h.minPoints)} a ${pts(h.maxPoints)}` : "—"}</Table.Td>}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}
