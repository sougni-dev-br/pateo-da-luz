import { CheckCircle2, ClipboardList, Copy, Eye, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AppUser,
  InventoryRequisition,
  InventoryRequisitionItem,
  InventorySector,
  getRequisition,
  getRequisitions,
  getSectors
} from "../api/client";
import { Button, EmptyState, IconButton, PanelEyebrow, StatusBadge, Table } from "../design-system";
import { Notice, useNotice } from "../components/Notice";
import { formatDate, formatNumber } from "../utils/format";
import type { Escolhas } from "./requisitions/catalogo";
import { lerRascunho } from "./requisitions/rascunho";
import { FormularioDaRequisicao, MOTIVOS, TURNOS, cabecalhoVazio, type ModeloInicial } from "./requisitions/FormularioDaRequisicao";

const shiftLabels = TURNOS;
const reasonLabels = MOTIVOS;

const shiftTone = (shift: string) =>
  shift === "MORNING" ? "info" : shift === "AFTERNOON" ? "warning" : "neutral";

export function Requisitions({ user }: { user: AppUser }) {
  const [view, setView] = useState<"form" | "list">("form");
  const [sectors, setSectors] = useState<InventorySector[]>([]);
  const [modelo, setModelo] = useState<ModeloInicial | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [confirmedRequisition, setConfirmedRequisition] = useState<InventoryRequisition | null>(null);
  const [requisitions, setRequisitions] = useState<InventoryRequisition[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InventoryRequisition | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const { notice, setNotice } = useNotice();

  useEffect(() => {
    getSectors().then(setSectors).catch(() => {});
    loadRequisitions();
  }, []);

  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    setLoadingDetail(true);
    getRequisition(detailId)
      .then(setDetail)
      .catch(() => setNotice({ tone: "error", message: "Não foi possível carregar os detalhes." }))
      .finally(() => setLoadingDetail(false));
  }, [detailId]);

  function loadRequisitions() {
    getRequisitions().then(setRequisitions).catch(() => {});
  }

  async function duplicateRequisition(id: string) {
    if (lerRascunho(user.id) && !window.confirm("Há uma requisição em andamento. Substituir pelos itens desta?")) return;
    try {
      const req = await getRequisition(id);
      const escolhas: Escolhas = {};
      for (const item of req.items ?? []) {
        // A retirada fica na unidade do estoque; o formulário confere o saldo de hoje ao abrir.
        if (item.productId) escolhas[item.productId] = { unit: item.unit ?? "UN", quantity: String(Number(item.quantity)).replace(".", ",") };
      }
      setModelo({
        cabecalho: { ...cabecalhoVazio(), shift: req.shift, reason: req.reason, reasonNotes: req.reasonNotes ?? "", sectorId: req.sectorId ?? "", notes: req.notes ?? "" },
        escolhas
      });
      setFormKey((k) => k + 1);
      setConfirmedRequisition(null);
      setView("form");
    } catch {
      setNotice({ tone: "error", message: "Erro ao duplicar a requisição." });
    }
  }

  function aoCriar(created: InventoryRequisition) {
    setConfirmedRequisition(created);
    setNotice({ tone: "success", message: `${created.code} registrada com sucesso.` });
    setRequisitions((prev) => [{ ...created, itemCount: created.items?.length ?? 0 }, ...prev]);
  }

  function novaRequisicao() {
    setModelo(null);
    setConfirmedRequisition(null);
    setFormKey((k) => k + 1);
  }

  return (
    <div className="stack">
      <Notice notice={notice} />

      <div className="section-heading req-page-heading">
        <div style={{ flex: 1 }}>
          <PanelEyebrow>Estoque</PanelEyebrow>
          <h2>Requisições de Insumos</h2>
          <span className="muted">Registre retiradas de produtos do estoque para uso na cozinha.</span>
        </div>
      </div>

      <div className="tabs">
        <button type="button" className={view === "form" ? "active" : ""} onClick={() => setView("form")}>
          <Plus size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Nova requisição
        </button>
        <button
          type="button"
          className={view === "list" ? "active" : ""}
          onClick={() => { setView("list"); if (view !== "list") loadRequisitions(); }}
        >
          <ClipboardList size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Histórico{requisitions.length > 0 ? ` (${requisitions.length})` : ""}
        </button>
      </div>

      {/* Escondido, não desmontado: ir ao histórico e voltar não pode descartar o que já foi montado */}
      {!confirmedRequisition && (
        <div hidden={view !== "form"}>
          <FormularioDaRequisicao
            key={formKey}
            user={user}
            sectors={sectors}
            modelo={modelo}
            onCriada={aoCriar}
            onAviso={(tone, message) => setNotice({ tone, message })}
          />
        </div>
      )}

      {view === "form" && confirmedRequisition && (
        <div className="form-section">
          <div className="req-success-header">
            <CheckCircle2 size={28} className="req-success-icon" />
            <div>
              <strong style={{ fontSize: 17 }}>{confirmedRequisition.code} registrada</strong>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
                {shiftLabels[confirmedRequisition.shift] ?? confirmedRequisition.shift}
                {confirmedRequisition.sectorName ? ` — ${confirmedRequisition.sectorName}` : ""}
                {" — "}{reasonLabels[confirmedRequisition.reason] ?? confirmedRequisition.reason}
              </p>
            </div>
          </div>

          {confirmedRequisition.items && confirmedRequisition.items.length > 0 && (
            <Table style={{ marginTop: 12 }}>
              <Table.Head>
                <Table.Row>
                  <Table.Th>Produto</Table.Th>
                  <Table.Th align="right">Retirado</Table.Th>
                  <Table.Th>Un.</Table.Th>
                  <Table.Th align="right">Antes</Table.Th>
                  <Table.Th align="right">Após</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {confirmedRequisition.items.map((item: InventoryRequisitionItem) => (
                  <Table.Row key={item.id}>
                    <Table.Td>
                      <strong>{item.productName}</strong>
                      {item.productCode && <small style={{ display: "block", color: "var(--muted)" }}>{item.productCode}</small>}
                    </Table.Td>
                    <Table.Td align="right">{formatNumber(Number(item.quantity))}</Table.Td>
                    <Table.Td>{item.unit ?? "—"}</Table.Td>
                    <Table.Td align="right">{item.stockBefore != null ? formatNumber(Number(item.stockBefore)) : "—"}</Table.Td>
                    <Table.Td align="right" style={{ color: Number(item.stockAfter ?? 0) <= 0 ? "var(--danger)" : "var(--success)" }}>
                      {item.stockAfter != null ? formatNumber(Number(item.stockAfter)) : "—"}
                    </Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <Button variant="primary" leadingIcon={<Plus size={14} />} onClick={novaRequisicao}>
              Nova requisição
            </Button>
            <Button variant="secondary" leadingIcon={<ClipboardList size={14} />} onClick={() => { setView("list"); setConfirmedRequisition(null); }}>
              Ver histórico
            </Button>
          </div>
        </div>
      )}

      {/* ── HISTORICO ──────────────────────────────────────────────────── */}
      {view === "list" && (
        <div className="form-section">
          <div className="section-heading compact-heading" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <PanelEyebrow>Estoque</PanelEyebrow>
              <h3>Histórico de requisições</h3>
              <span className="muted">Retiradas de insumos registradas do estoque.</span>
            </div>
            <Button variant="primary" leadingIcon={<Plus size={14} />} onClick={() => setView("form")}>
              Nova requisição
            </Button>
          </div>

          {requisitions.length === 0 ? (
            <EmptyState
              title="Nenhuma requisição registrada"
              description="As retiradas de insumos aparecerão aqui após serem registradas."
            />
          ) : (
            <>
            <div className="req-history-table">
              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.Th>Código</Table.Th>
                    <Table.Th>Data</Table.Th>
                    <Table.Th>Turno</Table.Th>
                    <Table.Th>Setor</Table.Th>
                    <Table.Th>Motivo</Table.Th>
                    <Table.Th align="right">Itens</Table.Th>
                    <Table.Th>Registrado por</Table.Th>
                    <Table.Th actions>Ações</Table.Th>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {requisitions.map((req) => (
                    <Table.Row key={req.id}>
                      <Table.Td><strong>{req.code}</strong></Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDate(req.date)}</Table.Td>
                      <Table.Td>
                        <StatusBadge tone={shiftTone(req.shift)}>
                          {shiftLabels[req.shift] ?? req.shift}
                        </StatusBadge>
                      </Table.Td>
                      <Table.Td>{req.sectorName ?? "—"}</Table.Td>
                      <Table.Td truncate style={{ maxWidth: 160 }} title={reasonLabels[req.reason] ?? req.reason}>
                        {reasonLabels[req.reason] ?? req.reason}
                      </Table.Td>
                      <Table.Td align="right">{req.itemCount ?? "—"}</Table.Td>
                      <Table.Td truncate style={{ maxWidth: 140 }} title={req.requestedByName ?? undefined}>{req.requestedByName ?? "—"}</Table.Td>
                      <Table.Td actions>
                        <IconButton icon={<Eye size={16} />} label="Ver requisição" onClick={() => setDetailId(req.id)} />
                        <IconButton icon={<Copy size={16} />} label="Duplicar requisição" onClick={() => void duplicateRequisition(req.id)} />
                      </Table.Td>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>

          <div className="mobile-cards">
            {requisitions.map((req) => (
              <div key={req.id} className="mobile-card">
                <div className="mobile-card-header">
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: "0.85rem" }}>{req.code}</strong>
                    <span style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>
                      {formatDate(req.date)}
                    </span>
                  </div>
                  <StatusBadge tone={shiftTone(req.shift)}>
                    {shiftLabels[req.shift] ?? req.shift}
                  </StatusBadge>
                </div>
                <div className="mobile-card-body">
                  <div className="mobile-card-row">
                    <span>Setor</span>
                    <strong>{req.sectorName ?? "—"}</strong>
                  </div>
                  <div className="mobile-card-row">
                    <span>Motivo</span>
                    <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>
                      {reasonLabels[req.reason] ?? req.reason}
                    </strong>
                  </div>
                  <div className="mobile-card-row">
                    <span>Itens</span>
                    <strong>{req.itemCount ?? "—"}</strong>
                  </div>
                  {req.requestedByName && (
                    <div className="mobile-card-row">
                      <span>Por</span>
                      <strong>{req.requestedByName}</strong>
                    </div>
                  )}
                </div>
                <div className="mobile-card-actions">
                  <Button variant="secondary" leadingIcon={<Eye size={13} />} onClick={() => setDetailId(req.id)}>
                    Ver
                  </Button>
                  <Button variant="secondary" leadingIcon={<Copy size={13} />} onClick={() => void duplicateRequisition(req.id)}>
                    Duplicar
                  </Button>
                </div>
              </div>
            ))}
          </div>
          </>
          )}
        </div>
      )}

      {/* ── MODAL DE DETALHE ───────────────────────────────────────────── */}
      {detailId && (
        <div className="modal-backdrop" onClick={() => setDetailId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>Detalhes da requisição</p>
                <strong>{detail?.code ?? "Carregando..."}</strong>
              </div>
              <button type="button" onClick={() => setDetailId(null)} aria-label="Fechar"><X size={18} /></button>
            </div>
            <div className="modal-body">
              {loadingDetail && <p className="muted">Carregando...</p>}
              {detail && !loadingDetail && (
                <>
                  <div className="req-detail-meta">
                    <div><small className="muted">Data</small><p>{formatDate(detail.date)}</p></div>
                    <div>
                      <small className="muted">Turno</small>
                      <p><StatusBadge tone={shiftTone(detail.shift)}>{shiftLabels[detail.shift] ?? detail.shift}</StatusBadge></p>
                    </div>
                    <div><small className="muted">Setor</small><p>{detail.sectorName ?? "—"}</p></div>
                    <div>
                      <small className="muted">Motivo</small>
                      <p>{reasonLabels[detail.reason] ?? detail.reason}{detail.reasonNotes ? `: ${detail.reasonNotes}` : ""}</p>
                    </div>
                    <div><small className="muted">Registrado por</small><p>{detail.requestedByName ?? "—"}</p></div>
                  </div>
                  {detail.notes && <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>{detail.notes}</p>}
                  <Table>
                    <Table.Head>
                      <Table.Row>
                        <Table.Th>Produto</Table.Th>
                        <Table.Th align="right">Qtd</Table.Th>
                        <Table.Th>Un.</Table.Th>
                        <Table.Th align="right">Antes</Table.Th>
                        <Table.Th align="right">Após</Table.Th>
                        <Table.Th align="right">Atual</Table.Th>
                      </Table.Row>
                    </Table.Head>
                    <Table.Body>
                      {(detail.items ?? []).map((item: InventoryRequisitionItem) => (
                        <Table.Row key={item.id}>
                          <Table.Td>
                            <strong>{item.productName}</strong>
                            {item.productCode && <small style={{ display: "block", color: "var(--muted)" }}>{item.productCode}</small>}
                          </Table.Td>
                          <Table.Td align="right">{formatNumber(Number(item.quantity))}</Table.Td>
                          <Table.Td>{item.unit ?? "—"}</Table.Td>
                          <Table.Td align="right">{item.stockBefore != null ? formatNumber(Number(item.stockBefore)) : "—"}</Table.Td>
                          <Table.Td align="right">{item.stockAfter != null ? formatNumber(Number(item.stockAfter)) : "—"}</Table.Td>
                          <Table.Td align="right" style={{ color: Number(item.currentStock ?? 0) <= 0 ? "var(--danger)" : undefined }}>
                            {item.currentStock != null ? formatNumber(Number(item.currentStock)) : "—"}
                          </Table.Td>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
