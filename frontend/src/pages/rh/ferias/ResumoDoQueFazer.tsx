import type { PessoaFerias } from "../../../api/client";
import { plural } from "./feriasFormato";
import { type ItemDoResumo, JANELA_DIREITO_DIAS, resumoDoQueFazer } from "./proximoPasso";

const ROTULO_DO_RESUMO: Record<ItemDoResumo["tipo"], (n: number) => string> = {
  vencido: (n) => `${n} ${plural(n, "prazo vencido", "prazos vencidos")}, definir a data já`,
  responder: (n) => `${n} ${plural(n, "pedido para responder", "pedidos para responder")}`,
  definir: (n) => `${n} ${plural(n, "pessoa com direito a férias, definir a data", "pessoas com direito a férias, definir a data")}`,
  completar: (n) => `${n} ${plural(n, "pessoa completa", "pessoas completam")} o período aquisitivo em até ${JANELA_DIREITO_DIAS} dias e passa${n === 1 ? "" : "m"} a ter direito`,
  avisar: (n) => `${n} ${plural(n, "aviso a fazer", "avisos a fazer")}`,
  confirmar: (n) => `${n} ${plural(n, "gozo para confirmar", "gozos para confirmar")}`,
};

/** O que fazer: as providências somadas por tipo, com os nomes. Serve à tela (`fe-resumo`) e à folha impressa (`fe-ti-resumo`). */
export function ResumoDoQueFazer({ pessoas, hoje, classe }: { pessoas: PessoaFerias[]; hoje: string; classe: "fe-resumo" | "fe-ti-resumo" }) {
  const itens = resumoDoQueFazer(pessoas, hoje);
  const urgente = `${classe}--urgente`;
  return (
    <section className={classe} aria-label="O que fazer">
      <h3>O que fazer</h3>
      {itens.length === 0 ? <p>Nada a decidir agora.</p> : (
        <ul>
          {itens.map((i) => (
            <li key={i.tipo} className={i.urgente ? urgente : undefined}><b>{ROTULO_DO_RESUMO[i.tipo](i.nomes.length)}:</b> {i.nomes.join(", ")}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
