import { ChevronRight, Download, Loader2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { OperationalInventory, StockCoverageAudit } from "../../../api/client";
import { ConfirmDialog } from "../../../components/ui";
import { EmptyState, Money, StatusBadge } from "../../../design-system";
import { formatDate, formatNumber } from "../../../utils/format";
import "./inventario.css";
import { operationalStatusLabels, operationalTone, operationalTypeLabels } from "../shared";
import { STATUS_EM_ANDAMENTO, agruparPorMes, dataDoInventario, proximoPasso, rascunhosVazios, situacao, tituloCurto } from "./lista";

// Uma lista so, por mes. Eram duas tabelas ("em andamento" e "oficiais") com
// as mesmas colunas, e o inventario de um mes ficava partido entre elas.
// Em cima, a situacao: o que o CMV esta usando, o que esta parado. Em cada
// linha, o proximo passo — o selo de status sozinho nao dizia o que fazer.

type Filtro = "todos" | "andamento" | "oficiais";

type Props = {
  inventarios: OperationalInventory[];
  coberturas: Record<string, StockCoverageAudit | undefined>;
  abrindoId: string | null;
  podeCancelar: boolean;
  onAbrir: (id: string) => void;
  onPdf: (inventario: OperationalInventory) => void;
  onCancelarRascunhos: (ids: string[]) => Promise<void>;
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function mesPorExtenso(iso: string) {
  const [ano, mes] = iso.slice(0, 7).split("-").map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

export function ListaDeInventarios({ inventarios, coberturas, abrindoId, podeCancelar, onAbrir, onPdf, onCancelarRascunhos }: Props) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);
  const [limpando, setLimpando] = useState(false);

  const emAndamento = useMemo(() => inventarios.filter((i) => STATUS_EM_ANDAMENTO.has(i.status)), [inventarios]);
  const oficiais = useMemo(() => inventarios.filter((i) => !STATUS_EM_ANDAMENTO.has(i.status)), [inventarios]);
  const abandonados = useMemo(() => rascunhosVazios(inventarios, new Date()), [inventarios]);
  const resumo = useMemo(() => situacao(inventarios), [inventarios]);
  const visiveis = filtro === "andamento" ? emAndamento : filtro === "oficiais" ? oficiais : inventarios;
  const grupos = useMemo(() => agruparPorMes(visiveis), [visiveis]);

  async function limpar() {
    setLimpando(true);
    try {
      await onCancelarRascunhos(abandonados.map((i) => i.id));
    } finally {
      setLimpando(false);
      setConfirmandoLimpeza(false);
    }
  }

  const ultimo = resumo.ultimoFechamento;

  return (
    <section className="invl" aria-label="Inventários">
      <div className="invl-situacao">
        {ultimo ? (
          <button type="button" className="invl-situacao__celula invl-situacao__celula--principal" onClick={() => onAbrir(ultimo.id)}>
            <span className="invl-situacao__rotulo">Último fechamento · base do CMV</span>
            <strong className="invl-situacao__valor">
              {ultimo.snapshotTotalValue != null ? <Money value={ultimo.snapshotTotalValue} /> : "sem base"}
            </strong>
            <span className="invl-situacao__nota">
              {mesPorExtenso(dataDoInventario(ultimo))} · {ultimo.code} ·{" "}
              <em className={`invl-passo invl-passo--${proximoPasso(ultimo).tom}`}>{proximoPasso(ultimo).texto.toLowerCase()}</em>
            </span>
          </button>
        ) : (
          <div className="invl-situacao__celula invl-situacao__celula--principal">
            <span className="invl-situacao__rotulo">Último fechamento</span>
            <strong className="invl-situacao__valor">Nenhum ainda</strong>
            <span className="invl-situacao__nota">Consolide as contagens setoriais em Contagem de Estoque.</span>
          </div>
        )}

        <button type="button" className="invl-situacao__celula" onClick={() => setFiltro("andamento")} disabled={resumo.emAndamento === 0}>
          <span className="invl-situacao__rotulo">Em andamento</span>
          <strong className="invl-situacao__valor">{formatNumber(resumo.emAndamento)}</strong>
          <span className="invl-situacao__nota">
            {resumo.emRevisao > 0
              ? <em className="invl-passo invl-passo--espera">{resumo.emRevisao} aguardando aprovação</em>
              : "nenhum aguardando aprovação"}
          </span>
        </button>

        <div className="invl-situacao__celula">
          <span className="invl-situacao__rotulo">Rascunhos parados</span>
          <strong className="invl-situacao__valor">{formatNumber(abandonados.length)}</strong>
          {abandonados.length > 0 && podeCancelar ? (
            <button type="button" className="invl-situacao__acao" disabled={limpando} onClick={() => setConfirmandoLimpeza(true)}>
              {limpando ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <Trash2 size={13} aria-hidden="true" />}
              Cancelar {abandonados.length === 1 ? "o rascunho vazio" : `os ${abandonados.length} vazios`}
            </button>
          ) : (
            <span className="invl-situacao__nota">{abandonados.length > 0 ? "sem quantidade há mais de 30 dias" : "lista limpa"}</span>
          )}
        </div>
      </div>

      <div className="invl-filtros" role="group" aria-label="Mostrar">
        {([
          ["todos", "Todos", inventarios.length],
          ["andamento", "Em andamento", emAndamento.length],
          ["oficiais", "Oficiais", oficiais.length]
        ] as const).map(([valor, rotulo, total]) => (
          <button key={valor} type="button" className="invl-filtro" aria-pressed={filtro === valor} onClick={() => setFiltro(valor)}>
            {rotulo} <span>{formatNumber(total)}</span>
          </button>
        ))}
      </div>

      {grupos.length === 0 && (
        <EmptyState
          title={filtro === "andamento" ? "Nenhum inventário em andamento" : "Nenhum inventário"}
          description="Inventários nascem das contagens: conclua as contagens setoriais e consolide o fechamento do mês na aba Contagem de Estoque."
        />
      )}

      {grupos.map((grupo) => (
        <div key={grupo.chave} className="invl-mes">
          <h3 className="invl-mes__titulo">
            <span>{grupo.rotulo}</span>
            <span>{grupo.inventarios.length} {grupo.inventarios.length === 1 ? "inventário" : "inventários"}</span>
          </h3>
          <ul className="invl-linhas">
            {grupo.inventarios.map((inventario) => (
              <LinhaDoInventario
                key={inventario.id}
                inventario={inventario}
                cobertura={coberturas[inventario.id]}
                abrindo={abrindoId === inventario.id}
                onAbrir={onAbrir}
                onPdf={onPdf}
              />
            ))}
          </ul>
        </div>
      ))}

      <ConfirmDialog
        open={confirmandoLimpeza}
        title={`Cancelar ${abandonados.length === 1 ? "1 rascunho vazio" : `${abandonados.length} rascunhos vazios`}?`}
        description={
          <div>
            <p>{abandonados.map((i) => i.code).join(", ")}</p>
            <p>Nenhum deles tem quantidade lançada, então nada de contagem se perde. Eles saem da lista e aparecem só com "Exibir cancelados/testes".</p>
          </div>
        }
        confirmLabel={limpando ? "Cancelando…" : "Cancelar rascunhos"}
        cancelLabel="Voltar"
        onConfirm={() => void limpar()}
        onCancel={() => setConfirmandoLimpeza(false)}
      />
    </section>
  );
}

type LinhaProps = {
  inventario: OperationalInventory;
  cobertura: StockCoverageAudit | undefined;
  abrindo: boolean;
  onAbrir: (id: string) => void;
  onPdf: (inventario: OperationalInventory) => void;
};

function LinhaDoInventario({ inventario, cobertura, abrindo, onAbrir, onPdf }: LinhaProps) {
  const emAndamento = STATUS_EM_ANDAMENTO.has(inventario.status);
  const total = Number(inventario.totalItems);
  const contados = Number(inventario.countedItems);
  const pct = total > 0 ? Math.round((contados / total) * 100) : 0;
  const tipo = [operationalTypeLabels[inventario.type], inventario.sectorName].filter(Boolean).join(" · ");
  const passo = proximoPasso(inventario);

  return (
    <li className={`invl-linha${inventario.type === "FINAL_CMV" ? " invl-linha--final" : ""}${inventario.status === "CANCELADO" ? " invl-linha--cancelado" : ""}`}>
      <button type="button" className="invl-linha__abrir" disabled={abrindo} onClick={() => onAbrir(inventario.id)} title={`Abrir ${inventario.code}`}>
        <span className="invl-linha__id">
          <strong>{inventario.code}</strong>
          <small>{formatDate(dataDoInventario(inventario))}</small>
        </span>
        <span className="invl-linha__nome">
          <span>{tituloCurto(inventario)}</span>
          <small>{tipo}</small>
        </span>
        <span className="invl-linha__status">
          <StatusBadge tone={operationalTone(inventario.status)}>{operationalStatusLabels[inventario.status] ?? inventario.status}</StatusBadge>
          <em className={`invl-passo invl-passo--${passo.tom}`}>{passo.texto}</em>
        </span>
        <span className="invl-linha__medida">
          {emAndamento ? (
            <>
              <span className="invl-linha__numero">{pct}%</span>
              <span className="invl-progresso" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
              <small>
                {formatNumber(contados)} de {formatNumber(total)} contados
                {cobertura && ` · cobertura ${cobertura.coveredTotal}/${cobertura.expectedTotal}`}
              </small>
            </>
          ) : inventario.snapshotTotalValue != null ? (
            <>
              <span className="invl-linha__numero"><Money value={inventario.snapshotTotalValue} /></span>
              <small>base do CMV · {formatNumber(contados)} itens</small>
            </>
          ) : (
            <small>{formatNumber(contados)} itens</small>
          )}
        </span>
        <span className="invl-linha__seta" aria-hidden="true">
          {abrindo ? <Loader2 size={16} className="spin" /> : <ChevronRight size={16} />}
        </span>
      </button>
      <button type="button" className="icon-button invl-linha__pdf" aria-label={`Gerar PDF — ${inventario.code}`} title="Gerar PDF" onClick={() => onPdf(inventario)}>
        <Download size={15} />
      </button>
    </li>
  );
}
