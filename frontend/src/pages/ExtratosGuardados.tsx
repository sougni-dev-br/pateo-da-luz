import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { type CSSProperties, Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  getRhExtrato, getRhExtratoPdf, listarRhExtratos,
  type RhExtratoDetalhe, type RhExtratoPessoa, type RhExtratoResumo,
} from "../api/client";
import { Alert, Button, EmptyState, Money, Select, StatusBadge, Table } from "../design-system";

const MESES = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const ANO_ATUAL = new Date().getFullYear();
// O armazenamento dos extratos começou em 2026: não há o que listar antes disso.
const ANOS = Array.from({ length: Math.max(ANO_ATUAL - 2026 + 1, 1) }, (_, i) => ANO_ATUAL - i);

const dataBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const num = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

// Abre o PDF numa aba nova. A aba é aberta antes do download: depois de um await o
// navegador trata a abertura como pop-up e bloqueia. Se o download falhar, fecha a
// aba em branco que ficou aberta.
export async function abrirPdf(id: string, fileName: string) {
  const aba = window.open("", "_blank");
  let blob: Blob;
  try {
    blob = await getRhExtratoPdf(id);
  } catch (e) {
    aba?.close();
    throw e;
  }
  const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
  if (aba) {
    aba.location.href = url;
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type Props = {
  /** Muda a cada importação para recarregar a lista. */
  recarregar?: number;
  onErro: (mensagem: string) => void;
};

export function ExtratosGuardados({ recarregar = 0, onErro }: Props) {
  const [ano, setAno] = useState(ANO_ATUAL);
  const [lista, setLista] = useState<RhExtratoResumo[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<RhExtratoDetalhe | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [semPermissao, setSemPermissao] = useState<string | null>(null);
  // Número da requisição da vez: resposta atrasada (outro ano, outro extrato) é descartada.
  const pedidoLista = useRef(0);
  const pedidoDetalhe = useRef(0);

  const carregar = useCallback(async () => {
    const vez = ++pedidoLista.current;
    setCarregando(true);
    try {
      const r = await listarRhExtratos(ano);
      if (vez !== pedidoLista.current) return;
      setLista(r);
      setSemPermissao(null);
    } catch (e) {
      if (vez !== pedidoLista.current) return;
      const msg = (e as Error).message;
      // 403: quem não vê Funcionários não vê salário nem holerite — explica em vez de dar erro.
      if (/só quem pode ver Funcionários/.test(msg)) setSemPermissao(msg); else onErro(msg);
      setLista([]);
    } finally {
      if (vez === pedidoLista.current) setCarregando(false);
    }
  }, [ano, onErro]);

  useEffect(() => { void carregar(); }, [carregar, recarregar]);

  function fecharDetalhe() {
    pedidoDetalhe.current++;
    setAberto(null);
    setDetalhe(null);
  }

  async function alternar(id: string) {
    if (aberto === id) return fecharDetalhe();
    const vez = ++pedidoDetalhe.current;
    setAberto(id);
    setDetalhe(null);
    try {
      const d = await getRhExtrato(id);
      if (vez === pedidoDetalhe.current) setDetalhe(d);
    } catch (e) {
      if (vez !== pedidoDetalhe.current) return;
      setAberto(null);
      onErro((e as Error).message);
    }
  }

  async function pdf(e: RhExtratoResumo) {
    try {
      await abrirPdf(e.id, e.fileName);
    } catch (err) {
      onErro((err as Error).message);
    }
  }

  return (
    <section aria-labelledby="extratos-guardados" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <strong id="extratos-guardados">Extratos guardados</strong>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            Cada extrato importado fica guardado com o PDF original e o holerite de cada pessoa (cargo, salário, rubricas, FGTS).
          </span>
        </div>
        <div style={{ width: 120 }}>
          <Select
            label="Ano"
            value={String(ano)}
            options={ANOS.map((a) => ({ value: String(a), label: String(a) }))}
            onChange={(ev) => { setAno(Number(ev.target.value)); fecharDetalhe(); }}
          />
        </div>
      </div>

      {semPermissao && <Alert tone="info">{semPermissao}</Alert>}

      {!semPermissao && lista && lista.length === 0 && !carregando && (
        <EmptyState title={`Nenhum extrato guardado em ${ano}`} description="Os extratos aparecem aqui assim que são importados acima." />
      )}

      {!semPermissao && lista && lista.length > 0 && (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th>Competência</Table.Th>
              <Table.Th minWidth={200}>Empresa</Table.Th>
              <Table.Th>Emissão</Table.Th>
              <Table.Th>Pessoas</Table.Th>
              <Table.Th align="right">Líquido</Table.Th>
              <Table.Th actions>Ações</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {lista.map((e) => (
              <Fragment key={e.id}>
                <Table.Row>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {MESES[e.competenceMonth]}/{e.competenceYear}{" "}
                    <StatusBadge tone={e.calculo === "ADIANTAMENTO" ? "warning" : "neutral"}>
                      {e.calculo === "ADIANTAMENTO" ? "Adiantamento" : "Folha do mês"}
                    </StatusBadge>
                  </Table.Td>
                  <Table.Td>{e.empresa || "—"}</Table.Td>
                  <Table.Td>{dataBr(e.emissao)}</Table.Td>
                  <Table.Td>
                    {!e.detalhado
                      ? <StatusBadge tone="neutral">Só o resumo — reimporte o PDF</StatusBadge>
                      : e.todasConferidas
                        ? <StatusBadge tone="success"><CheckCircle2 size={12} /> {e.pessoas} conferida(s)</StatusBadge>
                        : <StatusBadge tone="warning"><AlertTriangle size={12} /> {e.naoConferidas} de {e.pessoas} a conferir</StatusBadge>}
                  </Table.Td>
                  <Table.Td align="right" style={{ fontWeight: 600 }}><Money value={e.totalLiquido} /></Table.Td>
                  <Table.Td actions>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <Button
                        size="sm" variant="secondary" disabled={!e.temArquivo}
                        title={e.temArquivo ? "Abrir o PDF original" : "O PDF deste extrato não foi guardado: importe o arquivo de novo."}
                        leadingIcon={<FileText size={14} />}
                        onClick={() => void pdf(e)}
                      >
                        PDF
                      </Button>
                      <Button
                        size="sm" variant="secondary" disabled={!e.detalhado}
                        aria-expanded={aberto === e.id}
                        leadingIcon={aberto === e.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        onClick={() => void alternar(e.id)}
                      >
                        Pessoas
                      </Button>
                    </div>
                  </Table.Td>
                </Table.Row>
                {aberto === e.id && (
                  <Table.Row>
                    <Table.Td colSpan={6} style={{ background: "var(--surface-alt, transparent)" }}>
                      {detalhe ? <PessoasDoExtrato detalhe={detalhe} /> : <span style={{ color: "var(--muted)", fontSize: 13 }}>Carregando…</span>}
                    </Table.Td>
                  </Table.Row>
                )}
              </Fragment>
            ))}
          </Table.Body>
        </Table>
      )}
    </section>
  );
}

// Botão "invisível": o nome abre o holerite pelo teclado sem mudar o visual da linha.
const botaoNome: CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, fontWeight: 500, background: "none", border: 0, padding: 0,
  font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left",
};

function PessoasDoExtrato({ detalhe }: { detalhe: RhExtratoDetalhe }) {
  const [expandida, setExpandida] = useState<string | null>(null);
  const alternarPessoa = (id: string) => setExpandida((atual) => (atual === id ? null : id));
  return (
    <Table>
      <Table.Head>
        <Table.Row>
          <Table.Th minWidth={220}>Pessoa · cargo</Table.Th>
          <Table.Th align="right">Salário base</Table.Th>
          <Table.Th align="right">Proventos</Table.Th>
          <Table.Th align="right">Descontos</Table.Th>
          <Table.Th align="right">Líquido</Table.Th>
          <Table.Th align="right">FGTS</Table.Th>
          <Table.Th>Leitura</Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {detalhe.pessoas.map((p) => (
          <Fragment key={p.id}>
            {/* Clique em qualquer ponto da linha abre (mouse); o botão do nome é o controle acessível. */}
            <Table.Row onClick={() => alternarPessoa(p.id)} style={{ cursor: "pointer" }}>
              <Table.Td>
                <button type="button" style={botaoNome} aria-expanded={expandida === p.id} aria-controls={`rubricas-${p.id}`}
                  onClick={(ev) => { ev.stopPropagation(); alternarPessoa(p.id); }}>
                  {expandida === p.id ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  {p.nome}
                </button>
                <div style={{ color: "var(--muted)", fontSize: 12, marginLeft: 20 }}>
                  {p.cargo ?? "—"}{p.vinculo ? ` · ${p.vinculo}` : ""} · admissão {dataBr(p.admissao)}
                  {p.demissao ? ` · demitido em ${dataBr(p.demissao)}` : ""}
                  {p.employeeName ? "" : " · sem vínculo no cadastro"}
                </div>
              </Table.Td>
              <Table.Td align="right"><Money value={p.salarioBase} /></Table.Td>
              <Table.Td align="right"><Money value={p.proventos} /></Table.Td>
              <Table.Td align="right"><Money value={p.descontos} /></Table.Td>
              <Table.Td align="right" style={{ fontWeight: 600 }}>
                <Money value={p.liquido} />
                {(p.liquidoRescisao ?? 0) > 0 && (
                  <div style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>rescisão <Money value={p.liquidoRescisao} /></div>
                )}
              </Table.Td>
              <Table.Td align="right"><Money value={p.valorFgts} /></Table.Td>
              <Table.Td>
                {p.conferido
                  ? <StatusBadge tone="success">Conferido</StatusBadge>
                  : <StatusBadge tone="warning" title="As rubricas lidas não somam os totais do extrato: confira no PDF.">Não conferido</StatusBadge>}
              </Table.Td>
            </Table.Row>
            {expandida === p.id && (
              <Table.Row id={`rubricas-${p.id}`}>
                <Table.Td colSpan={7}><RubricasDaPessoa pessoa={p} /></Table.Td>
              </Table.Row>
            )}
          </Fragment>
        ))}
      </Table.Body>
    </Table>
  );
}

function RubricasDaPessoa({ pessoa }: { pessoa: RhExtratoPessoa }) {
  const colunas: { tipo: "P" | "D"; titulo: string; total: number }[] = [
    { tipo: "P", titulo: "Proventos", total: pessoa.proventos },
    { tipo: "D", titulo: "Descontos", total: pessoa.descontos },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
      {colunas.map((c) => (
        <div key={c.tipo}>
          <strong style={{ fontSize: 13 }}>{c.titulo}</strong>
          <Table noScroll>
            <Table.Body>
              {pessoa.rubricas.filter((r) => r.tipo === c.tipo).map((r, i) => (
                <Table.Row key={`${r.codigo}-${i}`}>
                  <Table.Td style={{ color: "var(--muted)", width: 48 }}>{r.codigo}</Table.Td>
                  <Table.Td>{r.descricao}</Table.Td>
                  <Table.Td align="right" style={{ color: "var(--muted)" }}>{num(r.referencia)}</Table.Td>
                  <Table.Td align="right"><Money value={r.valor} /></Table.Td>
                </Table.Row>
              ))}
              <Table.Row>
                <Table.Td colSpan={3} style={{ fontWeight: 600 }}>Total</Table.Td>
                <Table.Td align="right" style={{ fontWeight: 600 }}><Money value={c.total} /></Table.Td>
              </Table.Row>
            </Table.Body>
          </Table>
        </div>
      ))}
      <div style={{ color: "var(--muted)", fontSize: 12, gridColumn: "1 / -1" }}>
        Base INSS {num(pessoa.baseInss)} · Base FGTS {num(pessoa.baseFgts)} · Base IRRF {num(pessoa.baseIrrf)}
        {pessoa.cbo ? ` · CBO ${pessoa.cbo}` : ""}{pessoa.horasMes ? ` · ${num(pessoa.horasMes)} h/mês` : ""}
        {pessoa.demissaoMotivo ? ` · motivo da demissão: ${pessoa.demissaoMotivo}` : ""}
      </div>
    </div>
  );
}
