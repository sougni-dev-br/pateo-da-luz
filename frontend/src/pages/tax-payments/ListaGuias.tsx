import { ChevronDown, ChevronRight, Copy, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Button, EmptyState, Money, RowMenu, StatusBadge, Table, type RowMenuItem, type RowMenuSeparator, type StatusTone } from "../../design-system";
import type { TaxPayment } from "../../api/client";
import { formatarDiaDaGuia, situacaoDaGuia } from "../../lib/guia-imposto";
import { ComposicaoDaGuia } from "./ComposicaoDaGuia";
import { prazoDaGuia, rotuloMes, mesDaData } from "./regras";
import "./tax-payments.css";

export type AcoesDaGuia = {
  onEditar: (g: TaxPayment) => void;
  onDuplicar: (g: TaxPayment) => void;
  onExcluir: (g: TaxPayment) => void;
  /** Abre a guia em Contas a Pagar: é lá que a baixa (o pagamento) é registrada. */
  onContasAPagar: (g: TaxPayment) => void;
};

type Props = AcoesDaGuia & {
  guias: TaxPayment[];
  hoje: string;
  carregando: boolean;
  podeEditar: boolean;
  /** Quem não vê Contas a Pagar não recebe o atalho Pagar (cairia numa tela negada). */
  podeVerContasAPagar: boolean;
  podeLancar: boolean;
  podeExcluir: boolean;
  filtrando: boolean;
  onLancar?: () => void;
  onLimparFiltros: () => void;
};

type Situacao = ReturnType<typeof situacaoDaGuia>;

const SITUACAO: Record<Situacao, { rotulo: string; tom: StatusTone }> = {
  OVERDUE: { rotulo: "Vencida", tom: "danger" },
  PENDING: { rotulo: "A vencer", tom: "warning" },
  PAID: { rotulo: "Paga", tom: "success" },
  CANCELED: { rotulo: "Cancelada", tom: "neutral" },
};

function formatarCnpj(cnpj: string | null): string {
  const d = (cnpj ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return cnpj ?? "";
}

function nomeDaEmpresa(g: TaxPayment): string {
  return g.tradeName ?? g.legalName ?? "";
}

function urgente(g: TaxPayment, situacao: Situacao, hoje: string): boolean {
  return situacao === "OVERDUE" || (situacao === "PENDING" && prazoDaGuia(g.dueDate, hoje)?.tom === "hoje");
}

function Prazo({ g, situacao, hoje }: { g: TaxPayment; situacao: Situacao; hoje: string }) {
  if (situacao === "PAID") return <span className="ip-prazo ip-prazo--pago">paga em {formatarDiaDaGuia(g.paymentDate)}</span>;
  if (situacao === "CANCELED") return <span className="ip-prazo">cancelada</span>;
  const prazo = prazoDaGuia(g.dueDate, hoje);
  return prazo ? <span className={`ip-prazo ip-prazo--${prazo.tom}`}>{prazo.texto}</span> : null;
}

function itensDoMenu(g: TaxPayment, a: AcoesDaGuia, podeEditar: boolean, podeLancar: boolean, podeExcluir: boolean, podeVerContasAPagar: boolean): Array<RowMenuItem | RowMenuSeparator> {
  const itens: Array<RowMenuItem | RowMenuSeparator> = [
    { label: podeEditar ? "Editar guia" : "Ver guia", icon: <Pencil size={15} />, onClick: () => a.onEditar(g) },
  ];
  // Duplicar grava uma guia nova (POST): vale a permissão de lançar, não a de editar.
  if (podeLancar) itens.push({ label: "Duplicar para outro mês", icon: <Copy size={15} />, onClick: () => a.onDuplicar(g) });
  if (podeVerContasAPagar) itens.push({ label: "Ver em Contas a Pagar", icon: <ExternalLink size={15} />, onClick: () => a.onContasAPagar(g) });
  if (podeExcluir) {
    itens.push({ separator: true });
    itens.push({ label: "Excluir guia", icon: <Trash2 size={15} />, tone: "danger", onClick: () => a.onExcluir(g) });
  }
  return itens;
}

// A baixa não é feita nesta tela: o botão leva a guia para Contas a Pagar. A urgência decide o peso do botão.
function BotaoPagar({ g, a, urgente }: { g: TaxPayment; a: AcoesDaGuia; urgente: boolean }) {
  return (
    <Button
      size="sm" variant={urgente ? "primary" : "secondary"} leadingIcon={<ExternalLink size={14} />}
      onClick={() => a.onContasAPagar(g)} aria-label={`Pagar ${g.documentType} em Contas a Pagar`} title="Abre a guia em Contas a Pagar, onde o pagamento é registrado"
    >
      Pagar
    </Button>
  );
}

// Subtítulo da guia: número do documento e quantas linhas tem (no lugar da lista de denominações, igual em todo DAS).
function SubtituloDaGuia({ g, aberta, onAlternar }: { g: TaxPayment; aberta: boolean; onAlternar: () => void }) {
  const linhas = g.itemsCount ?? 0;
  if (!g.documentNumber && linhas === 0) return g.description ? <span className="ip-guia-desc" title={g.description}>{g.description}</span> : null;
  return (
    <span className="ip-guia-desc">
      {g.documentNumber && <span title="Número do documento">nº {g.documentNumber}</span>}
      {g.documentNumber && linhas > 0 && " · "}
      {linhas > 0 && (
        <button type="button" className="ip-linhas-link" aria-expanded={aberta} onClick={onAlternar}>
          {aberta ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          {linhas} {linhas === 1 ? "linha" : "linhas"}
        </button>
      )}
    </span>
  );
}

export function ListaGuias({ guias, hoje, carregando, podeEditar, podeVerContasAPagar, podeLancar, podeExcluir, filtrando, onLancar, onLimparFiltros, ...acoes }: Props) {
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string) => setAbertas((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (carregando && guias.length === 0) return <p className="ip-carregando" role="status">Carregando guias…</p>;

  if (guias.length === 0) {
    return (
      <EmptyState
        title={filtrando ? "Nenhuma guia com esses filtros" : "Nenhuma guia lançada ainda"}
        description={filtrando ? "Tire algum filtro para ver mais guias." : "Lance a primeira guia: ela entra em Contas a Pagar e no DRE."}
        action={filtrando
          ? <Button variant="secondary" onClick={onLimparFiltros}>Limpar filtros</Button>
          : onLancar ? <Button onClick={onLancar}>Lançar guia</Button> : undefined}
      />
    );
  }

  return (
    <>
      <div className="ip-tabela" aria-busy={carregando}>
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th>Guia</Table.Th>
              <Table.Th>Empresa</Table.Th>
              <Table.Th>Competência</Table.Th>
              <Table.Th>Vencimento</Table.Th>
              <Table.Th align="right">Valor</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th actions><span className="ip-sr">Ações</span></Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {guias.map((g) => {
              const situacao = situacaoDaGuia(g, hoje);
              const aberta = situacao === "OVERDUE" || situacao === "PENDING";
              return (
                <Fragment key={g.id}>
                <Table.Row className={`ip-linha ip-linha--${situacao.toLowerCase()}`}>
                  <Table.Td>
                    <strong className="ip-guia-tipo">{g.documentType}</strong>
                    <SubtituloDaGuia g={g} aberta={abertas.has(g.id)} onAlternar={() => alternar(g.id)} />
                  </Table.Td>
                  <Table.Td>
                    <span className="ip-empresa">{nomeDaEmpresa(g) || "—"}</span>
                    {g.cnpj && <span className="ip-cnpj">{formatarCnpj(g.cnpj)}</span>}
                  </Table.Td>
                  <Table.Td>
                    {g.competenceDate
                      ? <span className="ip-competencia">{rotuloMes(mesDaData(g.competenceDate))}</span>
                      : <span className="ip-competencia ip-competencia--falta" title="Sem competência a guia fica fora do DRE">sem competência</span>}
                  </Table.Td>
                  <Table.Td>
                    <span className="ip-vencimento">{formatarDiaDaGuia(g.dueDate)}</span>
                    <Prazo g={g} situacao={situacao} hoje={hoje} />
                  </Table.Td>
                  <Table.Td align="right">
                    <strong className="ip-valor"><Money value={Number(g.amount)} /></strong>
                    {situacao === "PAID" && g.paidAmount != null && Number(g.paidAmount) !== Number(g.amount) && (
                      <span className="ip-prazo">pago <Money value={Number(g.paidAmount)} /></span>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge tone={SITUACAO[situacao].tom}>{SITUACAO[situacao].rotulo}</StatusBadge>
                  </Table.Td>
                  <Table.Td actions>
                    {aberta && podeVerContasAPagar && <BotaoPagar g={g} a={acoes} urgente={urgente(g, situacao, hoje)} />}
                    <RowMenu items={itensDoMenu(g, acoes, podeEditar, podeLancar, podeExcluir, podeVerContasAPagar)} label={`Mais ações da guia ${g.documentType}`} />
                  </Table.Td>
                </Table.Row>
                {abertas.has(g.id) && (
                  <Table.Row className="ip-linha-composicao">
                    <Table.Td colSpan={7}><ComposicaoDaGuia guiaId={g.id} /></Table.Td>
                  </Table.Row>
                )}
                </Fragment>
              );
            })}
          </Table.Body>
        </Table>
      </div>

      <ul className="ip-cartoes" aria-label="Guias">
        {guias.map((g) => {
          const situacao = situacaoDaGuia(g, hoje);
          const aberta = situacao === "OVERDUE" || situacao === "PENDING";
          return (
            <li key={g.id} className={`ip-cartao ip-linha--${situacao.toLowerCase()}`}>
              <div className="ip-cartao-topo">
                <div>
                  <strong className="ip-guia-tipo">{g.documentType}</strong>
                  <span className="ip-guia-desc">{nomeDaEmpresa(g) || g.description || "—"}</span>
                  <SubtituloDaGuia g={g} aberta={abertas.has(g.id)} onAlternar={() => alternar(g.id)} />
                </div>
                <strong className="ip-valor"><Money value={Number(g.amount)} /></strong>
              </div>
              <div className="ip-cartao-meio">
                <Campo rotulo="Vence">{formatarDiaDaGuia(g.dueDate)} <Prazo g={g} situacao={situacao} hoje={hoje} /></Campo>
                <Campo rotulo="Competência">{g.competenceDate ? rotuloMes(mesDaData(g.competenceDate)) : "sem competência"}</Campo>
              </div>
              {abertas.has(g.id) && <div className="ip-cartao-composicao"><ComposicaoDaGuia guiaId={g.id} /></div>}
              <div className="ip-cartao-pe">
                <StatusBadge tone={SITUACAO[situacao].tom}>{SITUACAO[situacao].rotulo}</StatusBadge>
                <div className="ip-cartao-acoes">
                  {aberta && podeVerContasAPagar && <BotaoPagar g={g} a={acoes} urgente={urgente(g, situacao, hoje)} />}
                  <RowMenu items={itensDoMenu(g, acoes, podeEditar, podeLancar, podeExcluir, podeVerContasAPagar)} label={`Mais ações da guia ${g.documentType}`} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="ip-campo">
      <span className="ip-rotulo">{rotulo}</span>
      <span>{children}</span>
    </div>
  );
}
