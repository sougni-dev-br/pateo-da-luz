// Registro permanente dos fechamentos: cada fechamento grava um retrato
// completo (parâmetros, cada pessoa, totais, fundo) com um código próprio e um
// SHA-256 do conteúdo. O banco não deixa apagar nem alterar; reabrir fica anotado.
import { ArrowLeft, Download, ShieldAlert, ShieldCheck } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { type TipFechamentoDetalhe, type TipFechamentoResumo, getTipClosing, getTipClosings } from "../../api/client";
import { Button, StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { BarraFiltro, opcoesDe, useFiltro } from "./filtro";
import { MONTHS, baixarCsv, fmtDate, money, mutedStyle, panelStyle, pts } from "./gorjetaUtils";
import { ApelidosContext, NomePessoa, resolverApelido, textoPessoa } from "./NomePessoa";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const competencia = (ano: number, mes: number) => `${MONTHS[mes - 1]}/${ano}`;
const num = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));
const texto = (v: unknown) => (v == null || v === "" ? null : String(v));
// Exportação sempre leva a tabela inteira; o aviso só aparece com filtro ligado.
const avisoExportacao = <span style={{ ...mutedStyle, fontSize: 12 }}>O Excel (CSV) leva todas as linhas, sem o filtro.</span>;
const totalTd = { fontWeight: 700, background: "var(--paper-soft)" } as const;

function SeloIntegridade({ integro }: { integro: boolean }) {
  return integro
    ? <StatusBadge tone="success"><ShieldCheck size={12} /> Íntegro</StatusBadge>
    : <StatusBadge tone="danger"><ShieldAlert size={12} /> Conteúdo divergente</StatusBadge>;
}

export function RelatorioFechamentos({ onErro }: { onErro: (e: unknown) => void }) {
  const [ano, setAno] = useState<number | "todos">(new Date().getFullYear());
  const [lista, setLista] = useState<TipFechamentoResumo[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    setLista(null);
    getTipClosings(ano === "todos" ? undefined : ano).then(setLista).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano]);

  if (aberto) return <DetalheFechamento id={aberto} onVoltar={() => setAberto(null)} onErro={onErro} />;
  return <ListaFechamentos ano={ano} setAno={setAno} lista={lista} onAbrir={setAberto} />;
}

// ─── Lista ──────────────────────────────────────────────────────────────────
const EXT_LISTA: Extratores<TipFechamentoResumo> = {
  code: (f) => f.code, comp: (f) => f.competenceYear * 100 + f.competenceMonth, fechado: (f) => f.closedAt,
  pessoas: (f) => f.pessoas, liquido: (f) => f.liquido, ponto: (f) => f.valorPonto,
  distribuido: (f) => f.distribuido, saldo: (f) => f.saldo, situacao: (f) => situacaoDe(f),
};
const TEXTO_LISTA = new Set(["code", "situacao"]);
const situacaoDe = (f: TipFechamentoResumo) => (f.reopenedAt ? "Reaberto" : "Vigente");
const COLUNAS_LISTA: ColunaOpcional[] = [
  { chave: "comp", rotulo: "Competência" }, { chave: "fechado", rotulo: "Fechado em / por" }, { chave: "pessoas", rotulo: "Pessoas" },
  { chave: "liquido", rotulo: "Líquido" }, { chave: "ponto", rotulo: "Valor do ponto" }, { chave: "distribuido", rotulo: "Distribuído" },
  { chave: "saldo", rotulo: "Saldo ao fundo" }, { chave: "situacao", rotulo: "Situação" },
];

type ListaProps = {
  ano: number | "todos";
  setAno: (a: number | "todos") => void;
  lista: TipFechamentoResumo[] | null;
  onAbrir: (id: string) => void;
};

function ListaFechamentos({ ano, setAno, lista, onAbrir }: ListaProps) {
  const ord = useOrdenacao("fechamentos-lista");
  const col = useColunas("fechamentos-lista");
  const v = col.visivel;
  const filtro = useFiltro("fechamentos-lista");
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, TEXTO_LISTA.has(c) ? "asc" : "desc") });
  const anoAtual = new Date().getFullYear();
  const todas = lista ?? [];
  const listasFiltro = [
    { chave: "situacao", rotulo: "Situação", opcoes: [{ valor: "Vigente", rotulo: "Vigente" }, { valor: "Reaberto", rotulo: "Reaberto" }] },
    { chave: "versao", rotulo: "Versão", opcoes: opcoesDe(todas, (f) => `v${f.version}`) },
    { chave: "integridade", rotulo: "Integridade", opcoes: [{ valor: "Íntegro", rotulo: "Íntegro" }, { valor: "Divergente", rotulo: "Conteúdo divergente" }] },
  ];
  const filtradas = filtro.aplicar(todas,
    (f) => [f.code, competencia(f.competenceYear, f.competenceMonth), f.closedByName, f.reopenedByName ?? "", f.reopenReason ?? ""].join(" "),
    { situacao: situacaoDe, versao: (f) => `v${f.version}`, integridade: (f) => (f.integro ? "Íntegro" : "Divergente") });
  const linhas = aplicarOrdem(filtradas, ord.ordem, EXT_LISTA);
  const divergentes = todas.filter((f) => !f.integro).length;

  function exportar() {
    baixarCsv(`gorjeta-fechamentos-${ano}.csv`, [
      ["Registro", "Competência", "Fechado em", "Fechado por", "Pessoas", "Líquido", "Valor do ponto", "Distribuído", "Saldo ao fundo", "Reaberto em", "Reaberto por", "Motivo da reabertura", "Íntegro"],
      ...aplicarOrdem(todas, ord.ordem, EXT_LISTA).map((f) => [
        f.code, competencia(f.competenceYear, f.competenceMonth), dataHora(f.closedAt), f.closedByName, f.pessoas,
        f.liquido, f.valorPonto, f.distribuido, f.saldo, f.reopenedAt ? dataHora(f.reopenedAt) : null, f.reopenedByName, f.reopenReason, f.integro ? "sim" : "NÃO",
      ]),
    ]);
  }

  return (
    <div style={panelStyle}>
      <div className="cabecalho-painel">
        <div className="cabecalho-painel-texto">
          <strong>Fechamentos registrados</strong>
          <span>Cada fechamento fica gravado para sempre. Reabrir não apaga: anota o motivo e o próximo fechamento vira a versão seguinte.</span>
        </div>
        <div className="cabecalho-painel-acoes">
        <label className="barra-lista-campo">
          Ano
          <select value={ano} onChange={(e) => setAno(e.target.value === "todos" ? "todos" : Number(e.target.value))}>
            {[anoAtual, anoAtual - 1, anoAtual - 2].map((a) => <option key={a} value={a}>{a}</option>)}
            <option value="todos">Todos</option>
          </select>
        </label>
          <SeletorColunas colunas={COLUNAS_LISTA} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
          <Button variant="secondary" size="sm" leadingIcon={<Download size={14} />} onClick={exportar} disabled={todas.length === 0}>Excel (CSV)</Button>
        </div>
      </div>
      {todas.length > 0 && (
        <BarraFiltro filtro={filtro} listas={listasFiltro} total={todas.length} visiveis={filtradas.length}
          placeholder="Filtrar por registro, competência, quem fechou…" />
      )}
      {filtro.ativo && avisoExportacao}
      {divergentes > 0 && (
        <div className="fechamento-alerta" role="alert">
          <ShieldAlert size={16} /> {divergentes} registro(s) com conteúdo diferente do que foi gravado no fechamento. Avise o responsável pelo sistema.
        </div>
      )}
      {lista === null ? <span style={mutedStyle}>Carregando…</span> : todas.length > 0 && linhas.length === 0 ? (
        <span style={mutedStyle}>Nenhum fechamento bate com o filtro.</span>
      ) : linhas.length === 0 ? (
        <div className="estado-vazio">
          <strong>Nenhum fechamento registrado {ano === "todos" ? "" : `em ${ano}`}.</strong>
          <span>Quando um período é fechado na aba Apuração, o retrato completo aparece aqui com o código GOR-AAAA-NNNN/vN.</span>
        </div>
      ) : (
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...th("code")} align="left" minWidth={170}>Registro</ThOrdenavel>
              {v("comp") && <ThOrdenavel {...th("comp")}>Competência</ThOrdenavel>}
              {v("fechado") && <ThOrdenavel {...th("fechado")}>Fechado em / por</ThOrdenavel>}
              {v("pessoas") && <ThOrdenavel {...th("pessoas")}>Pessoas</ThOrdenavel>}
              {v("liquido") && <ThOrdenavel {...th("liquido")}>Líquido</ThOrdenavel>}
              {v("ponto") && <ThOrdenavel {...th("ponto")}>Valor do ponto</ThOrdenavel>}
              {v("distribuido") && <ThOrdenavel {...th("distribuido")}>Distribuído</ThOrdenavel>}
              {v("saldo") && <ThOrdenavel {...th("saldo")}>Saldo ao fundo</ThOrdenavel>}
              {v("situacao") && <ThOrdenavel {...th("situacao")}>Situação</ThOrdenavel>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {linhas.map((f) => (
              <Table.Row key={f.id} className="linha-clicavel" onClick={() => onAbrir(f.id)} title="Abrir o retrato completo">
                <Table.Td style={{ textAlign: "left" }}><span className="codigo-apuracao">{f.code}</span></Table.Td>
                {v("comp") && <Table.Td>{competencia(f.competenceYear, f.competenceMonth)}</Table.Td>}
                {v("fechado") && (
                  <Table.Td>
                    <div style={{ whiteSpace: "nowrap" }}>{dataHora(f.closedAt)}</div>
                    <div style={mutedStyle}>{f.closedByName}</div>
                  </Table.Td>
                )}
                {v("pessoas") && <Table.Td>{f.pessoas}</Table.Td>}
                {v("liquido") && <Table.Td>{money(f.liquido)}</Table.Td>}
                {v("ponto") && <Table.Td>{money(f.valorPonto)}</Table.Td>}
                {v("distribuido") && <Table.Td style={{ fontWeight: 700 }}>{money(f.distribuido)}</Table.Td>}
                {v("saldo") && <Table.Td>{money(f.saldo)}</Table.Td>}
                {v("situacao") && <Table.Td>
                  <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    {f.reopenedAt
                      ? <StatusBadge tone="warning" title={f.reopenReason ?? undefined}>Reaberto {fmtDate(f.reopenedAt)}</StatusBadge>
                      : <StatusBadge tone="info">Vigente</StatusBadge>}
                    {!f.integro && <SeloIntegridade integro={false} />}
                  </div>
                </Table.Td>}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}

// ─── Detalhe (o retrato gravado) ────────────────────────────────────────────
type Pessoa = Record<string, unknown>;

const COLUNAS_PESSOA: ColunaOpcional[] = [
  { chave: "funcao", rotulo: "Função e empresa" }, { chave: "base", rotulo: "Pontos base ± ajuste" },
  { chave: "presenca", rotulo: "Presença" }, { chave: "pontos", rotulo: "Pontos" }, { chave: "gorjeta", rotulo: "Gorjeta" },
  { chave: "vales", rotulo: "Vales" }, { chave: "liquido", rotulo: "Líquido" },
  { chave: "salario", rotulo: "Salário (sem registro)" }, { chave: "total", rotulo: "Total a pagar" },
];
// Retratos antigos podem não ter tipoCalculo: aí a pessoa conta como "No mês".
const SITUACAO_PESSOA: Record<string, string> = {
  MES: "No mês", RESCISAO: "Desligado no período", RESCISAO_QUITADA: "Desligado no período", FORA_DO_PERIODO: "Fora do período",
};
// undefined = o retrato não tem o campo (fechamento antigo): aí vale o apelido do cadastro.
const apelidoDoRetrato = (p: Pessoa) => ("apelido" in p ? texto(p.apelido) : undefined);
const situacaoPessoa = (p: Pessoa) => SITUACAO_PESSOA[texto(p.tipoCalculo) ?? "MES"] ?? "No mês";
const soma = (l: Pessoa[], f: (p: Pessoa) => number | null) => l.reduce((a, p) => a + (f(p) ?? 0), 0);
const EXT_PESSOA: Extratores<Pessoa> = {
  nome: (p) => texto(p.nome), funcao: (p) => texto(p.funcao),
  base: (p) => num(p.pontosBase), presenca: (p) => num(p.fatorPresenca),
  pontos: (p) => num(p.pontos), gorjeta: (p) => num(p.gorjeta), vales: (p) => (num(p.descontos) ?? 0) - (num(p.creditos) ?? 0),
  liquido: (p) => num(p.liquido), salario: (p) => num(p.salarioProporcional), total: (p) => num(p.totalAPagar),
};
const TEXTO_PESSOA = new Set(["nome", "funcao"]);

function DetalheFechamento({ id, onVoltar, onErro }: { id: string; onVoltar: () => void; onErro: (e: unknown) => void }) {
  const [d, setD] = useState<TipFechamentoDetalhe | null>(null);
  const ord = useOrdenacao("fechamento-detalhe");
  const col = useColunas("fechamento-detalhe");
  const v = col.visivel;
  const filtro = useFiltro("fechamento-detalhe");
  const apelidos = useContext(ApelidosContext);
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, TEXTO_PESSOA.has(c) ? "asc" : "desc") });

  useEffect(() => {
    getTipClosing(id).then(setD).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!d) return <div style={panelStyle}><span style={mutedStyle}>Carregando o registro…</span></div>;

  const p = d.params;
  const t = d.totals;
  const lancamentos = (Array.isArray(d.reserve.lancamentos) ? d.reserve.lancamentos : []) as Array<{ type: string; amount: number; notes: string | null }>;
  const todas = d.participants;
  const listasFiltro = [
    { chave: "vinculo", rotulo: "Vínculo", opcoes: [{ valor: "CLT", rotulo: "CLT" }, { valor: "Sem registro", rotulo: "Sem registro" }] },
    { chave: "empresa", rotulo: "Empresa", opcoes: opcoesDe(todas, (x) => texto(x.empresa)) },
    { chave: "funcao", rotulo: "Função", opcoes: opcoesDe(todas, (x) => texto(x.funcao)) },
    { chave: "situacao", rotulo: "Situação", opcoes: opcoesDe(todas, situacaoPessoa) },
  ];
  const filtradas = filtro.aplicar(todas,
    (x) => [textoPessoa(texto(x.nome) ?? "", resolverApelido(apelidos, texto(x.employeeId), apelidoDoRetrato(x))), texto(x.funcao) ?? "", texto(x.empresa) ?? ""].join(" "),
    {
      vinculo: (x) => (x.semRegistro === true ? "Sem registro" : "CLT"), empresa: (x) => texto(x.empresa),
      funcao: (x) => texto(x.funcao), situacao: situacaoPessoa,
    });
  const pessoas = aplicarOrdem(filtradas, ord.ordem, EXT_PESSOA);
  const ajusteServico = num(p.ajusteServico) ?? 0;
  const resc = (t.rescisoes ?? {}) as { valor?: unknown; pontos?: unknown };
  const rescisoes = { valor: num(resc.valor) ?? 0, pontos: num(resc.pontos) ?? 0 };
  const temSalario = d.participants.some((x) => (num(x.salarioProporcional) ?? 0) > 0);

  function exportar() {
    if (!d) return;
    baixarCsv(`gorjeta-${d.code.replace("/", "-")}.csv`, [
      ["Registro", d.code], ["Competência", competencia(d.competenceYear, d.competenceMonth)],
      ["Fechado em", dataHora(d.closedAt)], ["Fechado por", d.closedByName], ["SHA-256", d.payloadHash], [],
      ["Funcionário", "Função", "Empresa", "Sem registro", "Pontos base", "Ajuste", "Fator presença", "Pontos", "Valor do ponto", "Gorjeta", "Descontos", "Créditos", "Líquido", "Salário proporcional", "Total a pagar"],
      ...aplicarOrdem(todas, ord.ordem, EXT_PESSOA).map((x) => [
        texto(x.nome), texto(x.funcao), texto(x.empresa), x.semRegistro ? "sim" : "não", num(x.pontosBase), num(x.ajuste), num(x.fatorPresenca),
        num(x.pontos), num(x.valorPonto), num(x.gorjeta), num(x.descontos), num(x.creditos), num(x.liquido), num(x.salarioProporcional), num(x.totalAPagar),
      ]),
    ]);
  }

  const itens: Array<[string, string]> = [
    ["Período", `${fmtDate(d.periodStart)} a ${fmtDate(d.periodEnd)}`],
    ["Serviço (faturamento)", money(num(p.servicoFaturamento))],
    ...(ajusteServico !== 0 ? [["Ajuste do serviço", `${money(ajusteServico)}${texto(p.ajusteServicoMotivo) ? ` — ${texto(p.ajusteServicoMotivo)}` : ""}`] as [string, string]] : []),
    ["Serviço bruto", money(num(p.grossPool))],
    ["Retenção", `${pts(num(p.deductionPercent))}%`],
    ["Líquido", money(num(t.netPool))],
    ["Cotas fixas", money(num(t.fixedTotal))],
    ["Rescisões", rescisoes.valor ? `${money(rescisoes.valor)} (${pts(rescisoes.pontos)} pts)` : "—"],
    // Retrato antigo não tem o campo: até então a parte de quem saiu ficava com quem continua.
    ...(rescisoes.valor || rescisoes.pontos
      ? [["Parte de quem saiu", p.sobraRescisaoParaSaldo === true ? "Foi para o livre" : "Ficou com quem continua"] as [string, string]]
      : []),
    ["Pontos disponíveis", pts(num(t.pontosDisponiveis))],
    ["Valor do ponto", money(num(t.pointValue))],
    ["Pontos da reserva", pts(num(p.reservaPontos))],
    ["Distribuído", money(num(t.distribuido))],
    ["Saldo ao fundo", money(num(t.saldo))],
    ["Total a pagar", money(num(t.totalAPagar))],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={panelStyle}>
        <div className="barra-lista">
          <Button variant="secondary" leadingIcon={<ArrowLeft size={14} />} onClick={onVoltar}>Fechamentos</Button>
          <span className="codigo-apuracao" style={{ fontSize: 14, height: 28 }}>{d.code}</span>
          <strong>{competencia(d.competenceYear, d.competenceMonth)}</strong>
          <SeloIntegridade integro={d.integro} />
          <div style={{ marginLeft: "auto" }}>
            <Button variant="secondary" leadingIcon={<Download size={14} />} onClick={exportar}>Excel (CSV)</Button>
          </div>
        </div>
        <span style={mutedStyle}>Fechado em {dataHora(d.closedAt)} por {d.closedByName}.</span>
        {d.reopenedAt && (
          <div className="fechamento-reaberto">
            <strong>Reaberto em {dataHora(d.reopenedAt)} por {d.reopenedByName}.</strong> Motivo: {d.reopenReason}
          </div>
        )}
        <dl className="fechamento-grade">
          {itens.map(([rotulo, valor]) => (
            <div key={rotulo}><dt>{rotulo}</dt><dd>{valor}</dd></div>
          ))}
        </dl>
      </div>

      <div style={panelStyle}>
        <div className="barra-lista">
          <strong>Pessoas ({d.participants.length})</strong>
          <div style={{ marginLeft: "auto" }}>
            <SeletorColunas colunas={COLUNAS_PESSOA} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
          </div>
        </div>
        <span style={mutedStyle}>Nomes como foram gravados no fechamento.</span>
        <BarraFiltro filtro={filtro} listas={listasFiltro} total={todas.length} visiveis={filtradas.length}
          placeholder="Filtrar por nome, apelido, função, empresa…" />
        {filtro.ativo && avisoExportacao}
        {filtro.ativo && filtradas.length === 0 && <span style={mutedStyle}>Ninguém bate com o filtro.</span>}
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...th("nome")} align="left" minWidth={200}>Funcionário</ThOrdenavel>
              {v("funcao") && <ThOrdenavel {...th("funcao")}>Função</ThOrdenavel>}
              {v("base") && <ThOrdenavel {...th("base")}>Base ± ajuste</ThOrdenavel>}
              {v("presenca") && <ThOrdenavel {...th("presenca")}>Presença</ThOrdenavel>}
              {v("pontos") && <ThOrdenavel {...th("pontos")}>Pontos</ThOrdenavel>}
              {v("gorjeta") && <ThOrdenavel {...th("gorjeta")}>Gorjeta</ThOrdenavel>}
              {v("vales") && <ThOrdenavel {...th("vales")}>Vales</ThOrdenavel>}
              {v("liquido") && <ThOrdenavel {...th("liquido")}>Líquido</ThOrdenavel>}
              {temSalario && v("salario") && <ThOrdenavel {...th("salario")}>Salário</ThOrdenavel>}
              {v("total") && <ThOrdenavel {...th("total")}>Total a pagar</ThOrdenavel>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {pessoas.map((x, i) => {
              const vales = (num(x.descontos) ?? 0) - (num(x.creditos) ?? 0);
              const fator = num(x.fatorPresenca);
              const ajuste = num(x.ajuste) ?? 0;
              return (
                <Table.Row key={texto(x.employeeId) ?? i}>
                  <Table.Td style={{ textAlign: "left" }}>
                    {/* Apelido gravado no retrato vale; retrato antigo, sem o campo, usa o do cadastro. */}
                    <NomePessoa nome={texto(x.nome) ?? "—"} employeeId={texto(x.employeeId)} apelido={apelidoDoRetrato(x)}>
                      {x.semRegistro === true && <StatusBadge tone="warning">Sem registro</StatusBadge>}
                      {texto(x.desligamento) && <StatusBadge tone="neutral">Saída {fmtDate(texto(x.desligamento))}</StatusBadge>}
                    </NomePessoa>
                  </Table.Td>
                  {v("funcao") && (
                    <Table.Td>
                      <div>{texto(x.funcao) ?? "—"}</div>
                      {texto(x.empresa) && <div style={mutedStyle}>{texto(x.empresa)}</div>}
                    </Table.Td>
                  )}
                  {v("base") && (
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {pts(num(x.pontosBase))}
                      {ajuste ? <span style={{ ...mutedStyle, marginLeft: 4 }}>{ajuste > 0 ? "+" : "−"}{pts(Math.abs(ajuste))}</span> : null}
                    </Table.Td>
                  )}
                  {v("presenca") && <Table.Td>{fator == null ? "—" : `${pts(fator * 100)}%`}</Table.Td>}
                  {v("pontos") && <Table.Td style={{ fontWeight: 700 }}>{pts(num(x.pontos))}</Table.Td>}
                  {v("gorjeta") && <Table.Td>{money(num(x.gorjeta))}</Table.Td>}
                  {v("vales") && <Table.Td style={{ color: vales > 0 ? "var(--danger)" : vales < 0 ? "var(--success)" : undefined }}>{vales ? money(-vales) : "—"}</Table.Td>}
                  {v("liquido") && <Table.Td>{money(num(x.liquido))}</Table.Td>}
                  {temSalario && v("salario") && <Table.Td>{num(x.salarioProporcional) ? money(num(x.salarioProporcional)) : "—"}</Table.Td>}
                  {v("total") && <Table.Td style={{ fontWeight: 700 }}>{money(num(x.totalAPagar))}</Table.Td>}
                </Table.Row>
              );
            })}
            {pessoas.length > 0 && (
              <Table.Row>
                <Table.Td style={{ ...totalTd, textAlign: "left" }}>
                  {filtro.ativo ? `Total do filtro (${filtradas.length} de ${todas.length})` : "Total"}
                </Table.Td>
                {v("funcao") && <Table.Td style={totalTd}> </Table.Td>}
                {v("base") && <Table.Td style={totalTd}> </Table.Td>}
                {v("presenca") && <Table.Td style={totalTd}> </Table.Td>}
                {v("pontos") && <Table.Td style={totalTd}>{pts(soma(pessoas, (x) => num(x.pontos)))}</Table.Td>}
                {v("gorjeta") && <Table.Td style={totalTd}>{money(soma(pessoas, (x) => num(x.gorjeta)))}</Table.Td>}
                {v("vales") && <Table.Td style={totalTd}>{money(-soma(pessoas, (x) => (num(x.descontos) ?? 0) - (num(x.creditos) ?? 0)))}</Table.Td>}
                {v("liquido") && <Table.Td style={totalTd}>{money(soma(pessoas, (x) => num(x.liquido)))}</Table.Td>}
                {temSalario && v("salario") && <Table.Td style={totalTd}>{money(soma(pessoas, (x) => num(x.salarioProporcional)))}</Table.Td>}
                {v("total") && <Table.Td style={totalTd}>{money(soma(pessoas, (x) => num(x.totalAPagar)))}</Table.Td>}
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </div>

      <div style={panelStyle}>
        <strong>Fundo de reserva neste fechamento</strong>
        {lancamentos.length === 0 ? <span style={mutedStyle}>Nada foi lançado no fundo.</span> : (
          <ul className="fechamento-lancamentos">
            {lancamentos.map((l, i) => (
              <li key={i}><span>{l.type === "FECHAMENTO_RESERVA" ? "Pontos da reserva" : "Saldo não distribuído"}</span><strong>{money(l.amount)}</strong></li>
            ))}
          </ul>
        )}
        <span style={mutedStyle}>Saldo do fundo logo após o fechamento: {money(num(d.reserve.saldoDoFundoAposFechar))}</span>
        <details className="fechamento-hash">
          <summary>Assinatura do conteúdo (SHA-256)</summary>
          <code>{d.payloadHash}</code>
          <span style={mutedStyle}>Recalculada a cada consulta. Se o conteúdo gravado mudar, o selo passa para “Conteúdo divergente”.</span>
        </details>
      </div>
    </div>
  );
}
