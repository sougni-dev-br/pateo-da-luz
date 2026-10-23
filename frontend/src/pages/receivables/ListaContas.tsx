import { CheckCircle2, ChevronDown, ChevronRight, Eye, ListChecks } from "lucide-react";
import { useId, useState } from "react";
import type { ReceivableView } from "../../api/client";
import { Button, IconButton, Money, RowMenu, StatusBadge } from "../../design-system";
import { formatDate } from "../../utils/format";
import {
  estaPendente, ORIGEM_ROTULO, ORIGEM_SELO, podeCancelar, rotuloPrazo, SITUACAO_ROTULO, SITUACAO_TOM,
  situacaoDe, temRecebimento, tituloDaConta, type GrupoDeContas
} from "./regras";

export type AcoesDaLista = {
  podeReceber: boolean;
  podeDesfazer: boolean;
  selecionados: Set<string>;
  onAlternar: (id: string) => void;
  onAlternarGrupo: (ids: string[], marcar: boolean) => void;
  onReceberGrupo: (ids: string[]) => void;
  onVer: (c: ReceivableView) => void;
  onReceber: (c: ReceivableView) => void;
  onCancelar: (c: ReceivableView) => void;
  onEstornar: (c: ReceivableView) => void;
};

type Props = AcoesDaLista & { grupos: GrupoDeContas[]; hoje: string; rotuloTotal: string; rotuloData: string };

export function ListaContas({ grupos, hoje, rotuloTotal, rotuloData, ...acoes }: Props) {
  return (
    <div className="pg-lista rc-lista">
      <div className="pg-cabecalho" aria-hidden="true">
        <span />
        <span>{rotuloData}</span>
        <span>Conta</span>
        <span>Situação</span>
        <span className="pg-num">Valor</span>
        <span />
      </div>
      {grupos.map((g) => <Grupo key={g.chave} grupo={g} hoje={hoje} rotuloTotal={rotuloTotal} {...acoes} />)}
    </div>
  );
}

function Grupo({ grupo, hoje, rotuloTotal, ...acoes }: AcoesDaLista & { grupo: GrupoDeContas; hoje: string; rotuloTotal: string }) {
  const id = useId();
  const [recolhido, setRecolhido] = useState(false);
  const selecionaveis = acoes.podeReceber ? grupo.contas.filter(estaPendente).map((c) => c.id) : [];
  const marcados = selecionaveis.filter((sid) => acoes.selecionados.has(sid)).length;
  const todos = selecionaveis.length > 0 && marcados === selecionaveis.length;

  return (
    <section className={`pg-grupo pg-grupo--${grupo.chave === "atrasadas" ? "vencidos" : grupo.chave}`} aria-labelledby={id}>
      <header className="pg-grupo-topo">
        {selecionaveis.length > 0 ? (
          <input
            type="checkbox"
            className="pg-check"
            checked={todos}
            ref={(el) => { if (el) el.indeterminate = marcados > 0 && !todos; }}
            onChange={() => acoes.onAlternarGrupo(selecionaveis, !todos)}
            aria-label={`Selecionar todas de "${grupo.rotulo}"`}
          />
        ) : <span className="pg-check-vazio" />}
        <h3 id={id}>
          <button type="button" className="pg-grupo-toggle" aria-expanded={!recolhido} onClick={() => setRecolhido((r) => !r)}>
            {recolhido ? <ChevronRight size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
            {grupo.rotulo}
          </button>
        </h3>
        <span className="pg-grupo-qtd">{grupo.contas.length} {grupo.contas.length === 1 ? "conta" : "contas"}</span>
        {selecionaveis.length > 1 && (
          <button
            type="button"
            className="pg-grupo-baixar"
            onClick={() => acoes.onReceberGrupo(selecionaveis)}
            aria-label={`Registrar o recebimento das ${selecionaveis.length} contas de "${grupo.rotulo}"`}
          >
            <ListChecks size={14} aria-hidden="true" /> Receber grupo
          </button>
        )}
        <strong className="pg-grupo-total pg-num" title={rotuloTotal}><Money value={grupo.total} /></strong>
      </header>
      {!recolhido && (
        <ul className="pg-linhas">
          {grupo.contas.map((c) => <Linha key={c.id} conta={c} grupo={grupo.chave} hoje={hoje} {...acoes} />)}
        </ul>
      )}
    </section>
  );
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Data prevista como folha de calendário; a data completa fica para leitores de tela. */
function FolhaDeData({ dia }: { dia: string }) {
  return (
    <span className="pg-folha" aria-hidden="true">
      <b>{Number(dia.slice(8, 10))}</b>
      <small>{MESES[Number(dia.slice(5, 7)) - 1]}</small>
    </span>
  );
}

function Linha({ conta: c, grupo, hoje, ...acoes }: AcoesDaLista & { conta: ReceivableView; grupo: string; hoje: string }) {
  const nome = tituloDaConta(c.description);
  const situacao = situacaoDe(c);
  const pendente = estaPendente(c);
  const parcial = c.status === "PARTIALLY_RECEIVED";
  const subtitulo = [c.customerName && c.customerName !== ORIGEM_ROTULO[c.sourceType] ? c.customerName : null, c.installmentNumber && c.totalInstallments ? `parcela ${c.installmentNumber}/${c.totalInstallments}` : null]
    .filter(Boolean).join(" · ");
  const recebida = c.status === "RECEIVED" && c.receivedDate;
  // Na recebida a folha mostra o dia em que o dinheiro entrou; o previsto vai para a legenda.
  const diaDaFolha = recebida ? c.receivedDate! : c.expectedDate;
  const prazo = pendente
    ? rotuloPrazo(c, hoje)
    : recebida ? `previsto em ${formatDate(c.expectedDate)}` : c.status === "CANCELLED" ? "cancelada" : "";
  const marcaLateral = grupo === "atrasadas" ? "vencidos" : grupo === "hoje" ? "hoje" : "outro";

  const itensMenu = [
    ...(temRecebimento(c) && acoes.podeDesfazer ? [{ label: "Recebimentos e estorno…", onClick: () => acoes.onEstornar(c) }] : []),
    ...(podeCancelar(c) && acoes.podeDesfazer ? [{ label: "Cancelar conta…", tone: "danger" as const, onClick: () => acoes.onCancelar(c) }] : [])
  ];

  return (
    <li
      className={`pg-linha pg-linha--${marcaLateral}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button, input, a, label, [role='menu']")) acoes.onVer(c); }}
    >
      <div className="pg-c-sel">
        {acoes.podeReceber && pendente ? (
          <input
            type="checkbox"
            className="pg-check"
            checked={acoes.selecionados.has(c.id)}
            onChange={() => acoes.onAlternar(c.id)}
            aria-label={`Selecionar ${nome} para receber em lote`}
          />
        ) : null}
      </div>

      <div className="pg-c-venc">
        <FolhaDeData dia={diaDaFolha} />
        <span className="pg-data pg-sr">{formatDate(diaDaFolha)}</span>
        <span className="pg-prazo">{prazo}</span>
      </div>

      <div className="pg-c-quem">
        <strong className="pg-nome">{nome}</strong>
        <div className="pg-sub">
          <span className={`pg-selo pg-selo--${ORIGEM_SELO[c.sourceType]}`}>{ORIGEM_ROTULO[c.sourceType]}</span>
          {subtitulo && <span className="pg-sub-texto">{subtitulo}</span>}
        </div>
        {c.status === "CANCELLED" && c.cancellationReason && <p className="pg-obs" title={c.cancellationReason}>Motivo: {c.cancellationReason}</p>}
      </div>

      <div className="pg-c-status">
        <StatusBadge tone={SITUACAO_TOM[situacao]}>{SITUACAO_ROTULO[situacao]}</StatusBadge>
      </div>

      <div className="pg-c-valor">
        <strong className="pg-num"><Money value={parcial ? c.remainingAmount : c.netAmount} /></strong>
        {parcial && <span className="pg-pago-valor">a receber de <Money value={c.netAmount} /></span>}
        {c.status === "RECEIVED" && c.paidAmount !== null && c.paidAmount !== c.netAmount && (
          <span className="pg-pago-valor">recebido <Money value={c.paidAmount} /></span>
        )}
      </div>

      <div className="pg-c-acoes">
        <IconButton icon={<Eye size={16} />} label={`Ver detalhes de ${nome}`} size="sm" onClick={() => acoes.onVer(c)} />
        {acoes.podeReceber && pendente && (
          <Button size="sm" leadingIcon={<CheckCircle2 size={14} />} onClick={() => acoes.onReceber(c)} aria-label={`Registrar recebimento de ${nome}`}>
            Receber
          </Button>
        )}
        {itensMenu.length > 0 && <RowMenu items={itensMenu} label={`Mais ações de ${nome}`} />}
      </div>
    </li>
  );
}
