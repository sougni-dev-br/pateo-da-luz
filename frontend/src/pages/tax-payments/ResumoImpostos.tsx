import { AlertTriangle, CheckCircle2, CircleAlert, Plus } from "lucide-react";
import { Button, Money } from "../../design-system";
import type { TaxPanorama } from "../../api/client";
import {
  composicaoAPagar, lacunasPorImposto, montarGrade, rotuloMes,
  type CelulaGrade, type EstadoCelula,
} from "./regras";
import "./tax-payments.css";

type Props = {
  panorama: TaxPanorama;
  podeLancar: boolean;
  onLancar: () => void;
  onVerSituacao: (situacao: "OVERDUE") => void;
  onVerMes: (mes: string) => void;
};

const ROTULO_ESTADO: Record<EstadoCelula, string> = {
  pago: "pago",
  aberto: "a pagar",
  vencido: "vencido",
  vazio: "sem guia",
};

/**
 * O que o dono precisa saber ao abrir a tela: quanto há de imposto a pagar e quão urgente é,
 * o que pede atenção e quais meses já têm guia lançada (a ausência de um mês é o erro mais caro:
 * a guia não lançada não entra no DRE nem nos alertas).
 */
export function ResumoImpostos({ panorama, podeLancar, onLancar, onVerSituacao, onVerMes }: Props) {
  const { total, qtd, fatias } = composicaoAPagar(panorama.aPagar);
  const vencido = panorama.aPagar.vencido;
  const grade = montarGrade(panorama.cobertura, panorama.meses, panorama.hoje);
  const lacunas = lacunasPorImposto(grade);

  return (
    <div className="ip-panorama">
      <div className="ip-linha-topo">
        <section className="ip-hero" aria-label="Total de impostos a pagar">
          <span className="ip-rotulo">Impostos a pagar</span>
          <strong className="ip-hero-valor"><Money value={total} /></strong>
          <p className={`ip-hero-frase${vencido.qtd > 0 ? " ip-hero-frase--alerta" : ""}`}>
            {vencido.qtd > 0
              ? <><Money value={vencido.valor} /> já venceram ({fatias[0].pct}% do total)</>
              : qtd > 0 ? "Nada vencido. Tudo no prazo." : "Nenhuma guia em aberto."}
          </p>

          <div className="ip-barra" role="img" aria-label={`Composição: ${fatias.map((f) => `${f.rotulo} ${f.pct}%`).join(", ")}`}>
            {fatias.filter((f) => f.valor > 0).map((f) => (
              <span key={f.chave} className={`ip-fatia ip-fatia--${f.chave}`} style={{ flexGrow: f.valor }} />
            ))}
          </div>

          <ul className="ip-legenda">
            {fatias.map((f) => (
              <li key={f.chave} className={f.valor === 0 ? "ip-legenda--zero" : undefined}>
                <i className={`ip-fatia ip-fatia--${f.chave}`} aria-hidden="true" />
                <span>{f.rotulo}</span>
                <b><Money value={f.valor} /></b>
              </li>
            ))}
          </ul>
        </section>

        <Atencao
          panorama={panorama}
          lacunas={lacunas}
          podeLancar={podeLancar}
          onLancar={onLancar}
          onVerSituacao={onVerSituacao}
        />
      </div>

      <Cobertura grade={grade} meses={panorama.meses} hoje={panorama.hoje} onVerMes={onVerMes} />
    </div>
  );
}

type Alerta = { chave: string; tom: "danger" | "warning" | "success"; titulo: string; texto: React.ReactNode; acao?: React.ReactNode };

function Atencao({ panorama, lacunas, podeLancar, onLancar, onVerSituacao }: {
  panorama: TaxPanorama; lacunas: ReturnType<typeof lacunasPorImposto>; podeLancar: boolean; onLancar: () => void; onVerSituacao: Props["onVerSituacao"];
}) {
  const alertas: Alerta[] = [];
  const vencido = panorama.aPagar.vencido;

  if (vencido.qtd > 0) {
    alertas.push({
      chave: "vencidas",
      tom: "danger",
      titulo: `${vencido.qtd} ${vencido.qtd === 1 ? "guia vencida" : "guias vencidas"}`,
      texto: <>Somam <Money value={vencido.valor} />. Pague ou confira se já foram pagas e dê baixa.</>,
      acao: <Button size="sm" variant="secondary" onClick={() => onVerSituacao("OVERDUE")}>Ver vencidas</Button>,
    });
  }

  if (lacunas.length > 0) {
    const detalhe = lacunas.slice(0, 4).map((l) => `${l.grupo}: ${l.meses.map(rotuloMes).join(", ")}`).join(" · ");
    alertas.push({
      chave: "sem-guia",
      tom: "warning",
      titulo: lacunas.length === 1 ? `Falta lançar guia de ${lacunas[0].grupo}` : `Falta lançar guias de ${lacunas.length} impostos`,
      texto: `${detalhe}${lacunas.length > 4 ? " · …" : ""}. Guia não lançada não entra no DRE nem nos alertas de vencimento.`,
      acao: podeLancar ? <Button size="sm" variant="secondary" leadingIcon={<Plus size={14} />} onClick={onLancar}>Lançar guia</Button> : undefined,
    });
  }

  if (panorama.semCompetencia > 0) {
    alertas.push({
      chave: "sem-competencia",
      tom: "warning",
      titulo: `${panorama.semCompetencia} ${panorama.semCompetencia === 1 ? "guia sem competência" : "guias sem competência"}`,
      texto: "Sem competência a guia fica fora do DRE. Abra cada uma pelo menu da linha, em Editar, e informe o mês.",
    });
  }

  if (alertas.length === 0) {
    alertas.push({
      chave: "ok",
      tom: "success",
      titulo: "Tudo em dia",
      texto: "Nada vencido e todas as competências até o mês passado têm guia lançada.",
    });
  }

  return (
    <section className="ip-atencao" aria-label="O que pede atenção">
      <span className="ip-rotulo">O que pede atenção</span>
      <ul className="ip-alertas">
        {alertas.map((a) => (
          <li key={a.chave} className={`ip-alerta ip-alerta--${a.tom}`}>
            <span className="ip-alerta-icone" aria-hidden="true">
              {a.tom === "success" ? <CheckCircle2 size={18} /> : a.tom === "danger" ? <AlertTriangle size={18} /> : <CircleAlert size={18} />}
            </span>
            <div className="ip-alerta-corpo">
              <strong>{a.titulo}</strong>
              <p>{a.texto}</p>
            </div>
            {a.acao && <div className="ip-alerta-acao">{a.acao}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Cobertura({ grade, meses, hoje, onVerMes }: { grade: ReturnType<typeof montarGrade>; meses: string[]; hoje: string; onVerMes: (mes: string) => void }) {
  const mesAtual = hoje.slice(0, 7);

  return (
    <section className="ip-cobertura" aria-label="Guias lançadas por competência">
      <header className="ip-cobertura-topo">
        <div>
          <span className="ip-rotulo">Guias lançadas por competência</span>
          <p className="ip-cobertura-sub">Últimos 12 meses. Clique num mês para ver as guias dele.</p>
        </div>
        <ul className="ip-chaves" aria-label="Legenda">
          {(["pago", "aberto", "vencido", "vazio"] as EstadoCelula[]).map((e) => (
            <li key={e}><i className={`ip-celula ip-celula--${e}`} aria-hidden="true" />{ROTULO_ESTADO[e]}</li>
          ))}
          <li><i className="ip-celula ip-celula--vazio ip-celula--lacuna" aria-hidden="true" />falta lançar</li>
        </ul>
      </header>

      {grade.length === 0 ? (
        <p className="ip-cobertura-vazio">Nenhuma guia com competência nos últimos 12 meses.</p>
      ) : (
        <div className="ip-grade-rolagem">
          <table className="ip-grade">
            <thead>
              <tr>
                <th scope="col"><span className="ip-sr">Imposto</span></th>
                {meses.map((m) => (
                  <th key={m} scope="col" className={m === mesAtual ? "ip-grade-mes ip-grade-mes--atual" : "ip-grade-mes"}>
                    <button type="button" aria-label={`Ver guias de ${rotuloMes(m)}`} onClick={() => onVerMes(m)}>{rotuloMes(m)}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grade.map((linha) => (
                <tr key={linha.grupo}>
                  <th scope="row" className="ip-grade-grupo">{linha.grupo}</th>
                  {linha.celulas.map((c) => <Celula key={c.mes} c={c} grupo={linha.grupo} onVerMes={onVerMes} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Celula({ c, grupo, onVerMes }: { c: CelulaGrade; grupo: string; onVerMes: (mes: string) => void }) {
  const descricao = c.estado === "vazio"
    ? `${grupo}, ${rotuloMes(c.mes)}: ${c.lacuna ? "falta lançar a guia" : "sem guia"}`
    : `${grupo}, ${rotuloMes(c.mes)}: ${c.qtd} ${c.qtd === 1 ? "guia" : "guias"}, ${ROTULO_ESTADO[c.estado]}`;
  return (
    <td>
      <button
        type="button"
        className={`ip-celula ip-celula--${c.estado}${c.lacuna ? " ip-celula--lacuna" : ""}`}
        title={descricao}
        aria-label={descricao}
        onClick={() => onVerMes(c.mes)}
      >
        {c.estado === "vazio" ? (c.lacuna ? "!" : "") : c.qtd > 1 ? c.qtd : ""}
      </button>
    </td>
  );
}
