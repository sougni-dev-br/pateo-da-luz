// Lista de RH → Rescisões: quem saiu (ou está saindo), a situação e o próximo passo.
import { ChevronRight } from "lucide-react";
import type { RescisaoResumo } from "../../../api/client";
import { Button, Money, StatusBadge } from "../../../design-system";
import { type Situacao, type SituacaoRescisao, situacaoRescisao } from "./situacao";

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export type FiltroSituacao = Situacao | "TODAS";
export const FILTROS: Array<{ id: FiltroSituacao; rotulo: string; tom: "warning" | "info" | "success" | "neutral" }> = [
  { id: "TODAS", rotulo: "Todas", tom: "neutral" },
  { id: "FALTA_LANCAR", rotulo: "Falta lançar", tom: "warning" },
  { id: "TERMO_IMPORTADO", rotulo: "Termo importado", tom: "info" },
  { id: "LANCADA", rotulo: "Lançada", tom: "info" },
  { id: "PAGA_EM_PARTE", rotulo: "Paga em parte", tom: "warning" },
  { id: "PAGA", rotulo: "Paga", tom: "success" },
  { id: "QUITADA_NO_TERMO", rotulo: "Quitada no termo", tom: "success" },
];

export type LinhaRescisao = { pessoa: RescisaoResumo; situacao: SituacaoRescisao };

export function linhasDaLista(pessoas: RescisaoResumo[], hoje: string): LinhaRescisao[] {
  return pessoas.map((pessoa) => ({ pessoa, situacao: situacaoRescisao(pessoa, hoje) }));
}

export function contarPorSituacao(linhas: LinhaRescisao[]): Record<FiltroSituacao, number> {
  const contagem = Object.fromEntries(FILTROS.map((f) => [f.id, 0])) as Record<FiltroSituacao, number>;
  for (const l of linhas) contagem[l.situacao.situacao] += 1;
  contagem.TODAS = linhas.length;
  return contagem;
}

type Props = { linhas: LinhaRescisao[]; onAbrir: (employeeId: string) => void };

export function ListaRescisoes({ linhas, onAbrir }: Props) {
  return (
    <div className="rr-lista" role="table" aria-label="Rescisões">
      <div className="rr-cabecalho" role="row">
        <span role="columnheader">Funcionário</span>
        <span role="columnheader">Registro</span>
        <span role="columnheader">Saída</span>
        <span role="columnheader">Situação</span>
        <span role="columnheader" className="rr-num">Valor</span>
        <span role="columnheader">Próximo passo</span>
        <span role="columnheader"><span className="rr-sr-only">Ações</span></span>
      </div>
      {linhas.map(({ pessoa: p, situacao: s }) => (
        <div className="rr-linha" role="row" key={p.employeeId}>
          <span className="rr-nome" role="cell">
            <strong title={p.nome}>{p.apelido ? `${p.apelido} · ${p.nome}` : p.nome}</strong>
            <span className="rr-sub">
              {p.empresa ?? ""}
              <span className="rr-rotulo-celular">
                {[p.empresa ? "" : null, p.semRegistro ? "sem registro" : "CLT", p.saida ? `saída ${dataBr(p.saida)}` : "sem data de saída"].filter((x) => x != null).join(" · ")}
              </span>
            </span>
          </span>
          <span className="rr-col-registro" role="cell">
            <StatusBadge tone={p.semRegistro ? "warning" : "neutral"}>{p.semRegistro ? "Sem registro" : "CLT"}</StatusBadge>
          </span>
          <span className="rr-col-saida" role="cell">
            {p.saida ? dataBr(p.saida) : "—"}
            {s.saindo && <span className="rr-sub" style={{ display: "block" }}>ainda vai sair</span>}
          </span>
          <span className="rr-col-situacao" role="cell">
            <StatusBadge tone={s.tom}>{s.rotulo}</StatusBadge>
            {p.rescisao && p.rescisao.parcelas > 1 && <span className="rr-sub" style={{ display: "block" }}>{p.rescisao.pagas}/{p.rescisao.parcelas} parcelas pagas</span>}
          </span>
          <span className="rr-col-valor rr-num" role="cell">
            {p.rescisao ? <Money value={p.rescisao.liquido} /> : p.termo?.liquido != null ? <span title="líquido no termo"><Money value={p.termo.liquido} /></span> : "—"}
          </span>
          <span className="rr-col-passo rr-passo-texto" role="cell">{s.proximoPasso}</span>
          <span className="rr-col-acao" role="cell">
            <Button size="sm" variant="secondary" onClick={() => onAbrir(p.employeeId)} aria-label={`Abrir rescisão de ${p.nome}`}>
              Abrir <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </span>
        </div>
      ))}
    </div>
  );
}
