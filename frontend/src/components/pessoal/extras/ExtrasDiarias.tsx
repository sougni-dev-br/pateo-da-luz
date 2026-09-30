import { Check, Pencil, Search, Trash2, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import type { ExtraDiaria, ExtraStatus } from "../../../api/client";
import { Button, EmptyState, Money, RowMenu, StatusBadge, Table, TextField } from "../../../design-system";
import { MOTIVO_ROTULO, STATUS_ROTULO, STATUS_TOM, dataCurta, diariasTexto, hojeIso } from "./extrasRotulos";

export type FiltroSituacao = "TODAS" | ExtraStatus;
type Origem = "TODAS" | "CASA" | "FORA";

type Props = {
  itens: ExtraDiaria[];
  carregando: boolean;
  mesRotulo: string;
  situacao: FiltroSituacao;
  onSituacao: (s: FiltroSituacao) => void;
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
  onLancar: () => void;
  onEditar: (d: ExtraDiaria) => void;
  onExcluir: (d: ExtraDiaria) => void;
  onMudarSituacao: (d: ExtraDiaria, status: ExtraStatus) => void;
  ocupado: boolean;
};

const SITUACOES: FiltroSituacao[] = ["TODAS", "REALIZADA", "PREVISTA", "NAO_COMPARECEU", "CANCELADA"];
const normaliza = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const peso = (d: ExtraDiaria) => (d.duration === "MEIA" ? 0.5 : 1);

// Prevista cuja data já chegou: falta dizer se a pessoa veio.
export const aguardaConfirmacao = (d: ExtraDiaria) => d.status === "PREVISTA" && d.date <= hojeIso();

export function ExtrasDiarias(p: Props) {
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<Origem>("TODAS");

  const contagem = useMemo(() => {
    const c: Record<string, number> = { TODAS: p.itens.length };
    for (const d of p.itens) c[d.status] = (c[d.status] ?? 0) + 1;
    return c;
  }, [p.itens]);

  const filtro = normaliza(busca.trim());
  const visiveis = p.itens.filter((d) =>
    (p.situacao === "TODAS" || d.status === p.situacao) &&
    (origem === "TODAS" || d.origem === origem) &&
    (!filtro || normaliza(`${d.pessoaNome} ${d.pessoaApelido ?? ""} ${d.sector} ${d.role ?? ""}`).includes(filtro))
  );
  const realizadas = visiveis.filter((d) => d.status === "REALIZADA");
  const totalRealizado = realizadas.reduce((s, d) => s + d.totalAmount, 0);

  if (p.carregando && p.itens.length === 0) return <section className="panel"><p className="extras-sub">Carregando…</p></section>;

  if (p.itens.length === 0) {
    return (
      <section className="panel">
        <EmptyState
          title={`Nenhuma diária em ${p.mesRotulo}`}
          description="Lance cada extra chamado, da equipe da casa ou de fora. O gasto do mês aparece no resumo acima."
        />
        {p.podeCriar && <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}><Button onClick={p.onLancar}>Lançar a primeira diária</Button></div>}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="extras-filtros">
        <div className="extras-filtro-busca">
          <Search size={15} aria-hidden="true" />
          <TextField value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa, setor ou função" aria-label="Buscar diária" />
        </div>
        <div className="extras-chips" role="group" aria-label="Filtrar por situação">
          {SITUACOES.filter((s) => s === "TODAS" || contagem[s]).map((s) => (
            <button key={s} type="button" className="extras-chip" aria-pressed={p.situacao === s} onClick={() => p.onSituacao(s)}>
              {s === "TODAS" ? "Todas" : STATUS_ROTULO[s]} <span>{contagem[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="extras-chips" role="group" aria-label="Filtrar por origem">
          {(["TODAS", "CASA", "FORA"] as Origem[]).map((o) => (
            <button key={o} type="button" className="extras-chip" aria-pressed={origem === o} onClick={() => setOrigem(o)}>
              {o === "TODAS" ? "Casa e fora" : o === "CASA" ? "Casa" : "De fora"}
            </button>
          ))}
        </div>
      </div>

      {visiveis.length === 0 ? (
        <EmptyState title="Nada com esses filtros" description="Limpe a busca ou escolha outra situação." />
      ) : (
        <Table className="extras-tabela">
          <Table.Head>
            <Table.Row>
              <Table.Th>Data</Table.Th>
              <Table.Th>Pessoa</Table.Th>
              <Table.Th className="extras-ocultar-celular">Setor</Table.Th>
              <Table.Th className="extras-ocultar-celular">Motivo</Table.Th>
              <Table.Th className="extras-ocultar-celular">Situação</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>Valor</Table.Th>
              <Table.Th aria-label="Ações" />
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {visiveis.map((d) => {
              const confirmar = aguardaConfirmacao(d) && p.podeEditar;
              const badge = <StatusBadge tone={aguardaConfirmacao(d) ? "warning" : STATUS_TOM[d.status]}>{aguardaConfirmacao(d) ? "Confirmar" : STATUS_ROTULO[d.status]}</StatusBadge>;
              return (
                <Table.Row key={d.id} className={aguardaConfirmacao(d) ? "extras-linha-atencao" : undefined}>
                  <Table.Td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {dataCurta(d.date)}
                    {(d.startTime || d.endTime) && <div className="extras-sub">{d.startTime ?? "?"}–{d.endTime ?? "?"}</div>}
                  </Table.Td>
                  <Table.Td>
                    <strong>{d.pessoaNome}</strong>
                    <span className={`extras-origem${d.origem === "FORA" ? " fora" : ""}`}>
                      {d.origem === "CASA" ? (d.modalidade === "CLT" ? "Casa · CLT" : "Casa · sem registro") : "De fora"}
                    </span>
                    <div className="extras-sub">{[d.duration === "MEIA" ? "Meia diária" : "Diária", d.role].filter(Boolean).join(" · ")}</div>
                  </Table.Td>
                  <Table.Td className="extras-ocultar-celular">{d.sector}</Table.Td>
                  <Table.Td className="extras-ocultar-celular">
                    {MOTIVO_ROTULO[d.reason]}
                    {d.coveredNome && <div className="extras-sub">cobrindo {d.coveredNome}</div>}
                  </Table.Td>
                  <Table.Td className="extras-ocultar-celular">{badge}</Table.Td>
                  <Table.Td style={{ textAlign: "right" }} className="extras-num">
                    <strong style={d.status === "REALIZADA" ? undefined : { color: "var(--muted)", textDecoration: d.status === "PREVISTA" ? undefined : "line-through" }}>
                      <Money value={d.totalAmount} />
                    </strong>
                    {d.baseAdjustReason && <div className="extras-ajuste" title={d.baseAdjustReason}>valor ajustado</div>}
                    {d.paymentCode && <div className={d.pago ? "extras-pago" : "extras-no-pagamento"}>{d.pago ? "pago" : "a pagar"} · {d.paymentCode}</div>}
                    <div className="extras-so-celular">{badge}</div>
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {confirmar && (
                      <span className="extras-confirmar">
                        <Button variant="secondary" size="sm" leadingIcon={<Check size={14} />} title="Veio: marcar como realizada" aria-label="Veio: marcar como realizada" disabled={p.ocupado} onClick={() => p.onMudarSituacao(d, "REALIZADA")}><span className="extras-rotulo-botao">Veio</span></Button>
                        <Button variant="secondary" size="sm" leadingIcon={<UserX size={14} />} title="Não veio: marcar não compareceu" aria-label="Não veio: marcar não compareceu" disabled={p.ocupado} onClick={() => p.onMudarSituacao(d, "NAO_COMPARECEU")}><span className="extras-rotulo-botao">Não veio</span></Button>
                      </span>
                    )}
                    {(p.podeEditar || p.podeExcluir) && !d.paymentId && (
                      <RowMenu
                        items={[
                          ...(p.podeEditar ? [{ label: "Editar", icon: <Pencil size={14} />, onClick: () => p.onEditar(d) }] : []),
                          ...(p.podeEditar && d.status === "REALIZADA" ? [{ label: "Marcar não compareceu", icon: <UserX size={14} />, onClick: () => p.onMudarSituacao(d, "NAO_COMPARECEU") }] : []),
                          ...(p.podeExcluir ? [{ label: "Excluir", icon: <Trash2 size={14} />, tone: "danger" as const, onClick: () => p.onExcluir(d) }] : []),
                        ]}
                      />
                    )}
                  </Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}

      <div className="extras-rodape">
        <span>{visiveis.length} de {p.itens.length} lançamento(s)</span>
        <span>Realizado no filtro: <strong>{diariasTexto(realizadas.reduce((s, d) => s + peso(d), 0))} · <Money value={totalRealizado} /></strong></span>
      </div>
    </section>
  );
}
