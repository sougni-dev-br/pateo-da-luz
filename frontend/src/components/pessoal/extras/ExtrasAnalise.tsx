import type { ExtraDiaria, ExtraGrupo, ExtraMotivo, ExtraResumo } from "../../../api/client";
import { EmptyState, Money, PanelEyebrow } from "../../../design-system";
import { MOTIVO_COBERTURA, MOTIVO_ROTULO, diariasTexto } from "./extrasRotulos";

function Quebra({ titulo, grupos, rotulo, vazio = "Sem diárias realizadas." }: { titulo: string; grupos: ExtraGrupo[]; rotulo?: (chave: string) => string; vazio?: string }) {
  const maior = Math.max(...grupos.map((g) => g.total), 1);
  return (
    <div className="extras-quebra">
      <h3>{titulo}</h3>
      {grupos.length === 0 && <p className="extras-sub">{vazio}</p>}
      {grupos.map((g) => (
        <div className="extras-barra" key={g.chave}>
          <span className="extras-barra-nome">{rotulo ? rotulo(g.chave) : g.chave}</span>
          <span className="extras-barra-valor"><Money value={g.total} /></span>
          <span className="extras-barra-trilho"><span style={{ width: `${(g.total / maior) * 100}%` }} /></span>
          <span className="extras-barra-sub">{diariasTexto(g.diarias)}</span>
        </div>
      ))}
    </div>
  );
}

// Quanto custou cobrir a ausência de cada funcionário (falta, folga, férias).
function custoDasAusencias(itens: ExtraDiaria[]): ExtraGrupo[] {
  const mapa = new Map<string, ExtraGrupo>();
  for (const d of itens) {
    if (d.status !== "REALIZADA" || !MOTIVO_COBERTURA.has(d.reason) || !d.coveredNome) continue;
    const g = mapa.get(d.coveredNome) ?? { chave: d.coveredNome, total: 0, diarias: 0 };
    g.total = Math.round((g.total + d.totalAmount) * 100) / 100;
    g.diarias += d.duration === "MEIA" ? 0.5 : 1;
    mapa.set(d.coveredNome, g);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

export function ExtrasAnalise({ resumo, itens, mesRotulo }: { resumo: ExtraResumo; itens: ExtraDiaria[]; mesRotulo: string }) {
  if (resumo.diariasRealizadas === 0) {
    return (
      <section className="panel">
        <EmptyState title={`Nada para analisar em ${mesRotulo}`} description="A análise aparece quando houver diárias realizadas no mês." />
      </section>
    );
  }
  return (
    <section className="panel">
      <PanelEyebrow>Onde foi o gasto de {mesRotulo}</PanelEyebrow>
      <div className="extras-quebras">
        <Quebra titulo="Por setor" grupos={resumo.porSetor} />
        <Quebra titulo="Por motivo" grupos={resumo.porMotivo} rotulo={(c) => MOTIVO_ROTULO[c as ExtraMotivo] ?? c} />
        <Quebra titulo="Quem mais trabalhou" grupos={resumo.porPessoa.slice(0, 8).map((p) => ({ chave: p.nome, total: p.total, diarias: p.diarias }))} />
        <Quebra titulo="Ausências cobertas" grupos={custoDasAusencias(itens)} vazio="Nenhuma cobertura com o funcionário informado." />
      </div>
    </section>
  );
}
