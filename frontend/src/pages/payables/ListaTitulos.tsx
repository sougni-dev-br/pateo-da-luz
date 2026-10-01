import { CheckCircle2, Eye, History, RotateCcw } from "lucide-react";
import { useId } from "react";
import type { Payable } from "../../api/client";
import { Button, IconButton, Money } from "../../design-system";
import { formatDate } from "../../utils/format";
import { StatusTitulo } from "./Campos";
import {
  dateKey, detalhesDoTitulo, estaEmAberto, estaPago, favorecidoDoTitulo,
  rotuloPrazo, seloDoTitulo, valorDoTitulo, type GrupoDeTitulos
} from "./regras";

type Acoes = {
  podeGerir: boolean;
  podeSelecionar: (p: Payable) => boolean;
  selecionados: Set<string>;
  onAlternar: (id: string) => void;
  onAlternarGrupo: (ids: string[], marcar: boolean) => void;
  onVer: (p: Payable) => void;
  onBaixar: (p: Payable) => void;
  onEstornar: (p: Payable) => void;
  onHistorico: (p: Payable) => void;
};

type Props = Acoes & { grupos: GrupoDeTitulos[]; hoje: string };

export function ListaTitulos({ grupos, hoje, ...acoes }: Props) {
  return (
    <div className="pg-lista">
      <div className="pg-cabecalho" aria-hidden="true">
        <span />
        <span>Vencimento</span>
        <span>Favorecido</span>
        <span>Status</span>
        <span className="pg-num">Valor</span>
        <span />
      </div>
      {grupos.map((g) => <Grupo key={g.chave} grupo={g} hoje={hoje} {...acoes} />)}
    </div>
  );
}

function Grupo({ grupo, hoje, ...acoes }: Acoes & { grupo: GrupoDeTitulos; hoje: string }) {
  const id = useId();
  const selecionaveis = grupo.titulos.filter(acoes.podeSelecionar).map((p) => p.id);
  const marcados = selecionaveis.filter((sid) => acoes.selecionados.has(sid)).length;
  const todos = selecionaveis.length > 0 && marcados === selecionaveis.length;

  return (
    <section className={`pg-grupo pg-grupo--${grupo.chave}`} aria-labelledby={id}>
      <header className="pg-grupo-topo">
        {selecionaveis.length > 0 ? (
          <input
            type="checkbox"
            className="pg-check"
            checked={todos}
            ref={(el) => { if (el) el.indeterminate = marcados > 0 && !todos; }}
            onChange={() => acoes.onAlternarGrupo(selecionaveis, !todos)}
            aria-label={`Selecionar todos de "${grupo.rotulo}"`}
          />
        ) : <span className="pg-check-vazio" />}
        <h3 id={id}>{grupo.rotulo}</h3>
        <span className="pg-grupo-qtd">{grupo.titulos.length} {grupo.titulos.length === 1 ? "título" : "títulos"}</span>
        <strong className="pg-grupo-total pg-num"><Money value={grupo.total} /></strong>
      </header>
      <ul className="pg-linhas">
        {grupo.titulos.map((p) => <Linha key={p.id} titulo={p} grupo={grupo.chave} hoje={hoje} {...acoes} />)}
      </ul>
    </section>
  );
}

function Linha({ titulo: p, grupo, hoje, ...acoes }: Acoes & { titulo: Payable; grupo: GrupoDeTitulos["chave"]; hoje: string }) {
  const nome = favorecidoDoTitulo(p);
  const selo = seloDoTitulo(p);
  const detalhes = detalhesDoTitulo(p);
  const nota = p.paymentNotes ?? p.notes ?? "";
  const mostrarNota = nota && !detalhes.includes(nota);
  const pago = estaPago(p);
  const paidDiferente = pago && p.paidAmount != null && Number(p.paidAmount) !== valorDoTitulo(p);

  return (
    <li className={`pg-linha pg-linha--${grupo}`}>
      <div className="pg-c-sel">
        {acoes.podeSelecionar(p) ? (
          <input
            type="checkbox"
            className="pg-check"
            checked={acoes.selecionados.has(p.id)}
            onChange={() => acoes.onAlternar(p.id)}
            aria-label={`Selecionar ${nome} para baixa em lote`}
          />
        ) : null}
      </div>

      <div className="pg-c-venc">
        <span className="pg-data">{p.dueDate ? formatDate(p.dueDate) : "Sem venc."}</span>
        <span className="pg-prazo">
          {pago ? `pago em ${formatDate(p.paidDate)}` : estaEmAberto(p) ? rotuloPrazo(dateKey(p.dueDate), hoje) : ""}
        </span>
      </div>

      <div className="pg-c-quem">
        <strong className="pg-nome">{nome}</strong>
        <div className="pg-sub">
          {selo && <span className={`pg-selo pg-selo--${selo.tom}`}>{selo.rotulo}</span>}
          {detalhes.length > 0 && <span className="pg-sub-texto">{detalhes.join(" · ")}</span>}
        </div>
        {mostrarNota && <p className="pg-obs" title={nota}>{nota}</p>}
      </div>

      <div className="pg-c-status"><StatusTitulo status={p.status} /></div>

      <div className="pg-c-valor">
        <strong className="pg-num"><Money value={valorDoTitulo(p)} /></strong>
        {paidDiferente && <span className="pg-pago-valor">pago <Money value={p.paidAmount} /></span>}
      </div>

      <div className="pg-c-acoes">
        <IconButton icon={<Eye size={16} />} label={`Ver título de ${nome}`} size="sm" onClick={() => acoes.onVer(p)} />
        <IconButton icon={<History size={16} />} label={`Histórico de ${nome}`} size="sm" onClick={() => acoes.onHistorico(p)} />
        {acoes.podeGerir && estaEmAberto(p) && (
          <Button size="sm" leadingIcon={<CheckCircle2 size={14} />} onClick={() => acoes.onBaixar(p)} aria-label={`Baixar ${nome}`}>
            Baixar
          </Button>
        )}
        {acoes.podeGerir && pago && (
          <Button variant="secondary" size="sm" leadingIcon={<RotateCcw size={14} />} onClick={() => acoes.onEstornar(p)} aria-label={`Estornar ${nome}`}>
            Estornar
          </Button>
        )}
      </div>
    </li>
  );
}
