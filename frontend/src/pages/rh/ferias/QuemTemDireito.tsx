import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { PessoaFerias } from "../../../api/client";
import { dataBr, plural, textoPrazo } from "./feriasFormato";
import { type SituacaoDoDireito, contarPorSituacao, quemTemDireito } from "./direito";

const ROTULO: Record<SituacaoDoDireito, string> = { vencido: "Prazo vencido", perto: "Perto do limite", tempo: "Ainda há tempo" };
const semAcento = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Quem já tem ciclo completo para tirar férias e quanto tempo a empresa ainda tem para liberar. */
export function QuemTemDireito({ pessoas, hoje }: { pessoas: PessoaFerias[]; hoje: string }) {
  const [busca, setBusca] = useState("");
  const linhas = useMemo(() => quemTemDireito(pessoas, hoje), [pessoas, hoje]);
  const total = contarPorSituacao(linhas);
  const termo = semAcento(busca.trim());
  const achadas = linhas.filter((l) => semAcento(l.pessoa.nome).includes(termo));
  const semDireito = termo && achadas.length === 0 ? pessoas.filter((p) => semAcento(p.nome).includes(termo)) : [];

  return (
    <section className="fe-direito" aria-label="Quem tem direito a férias">
      <header className="fe-direito-topo">
        <div>
          <h3>Quem tem direito a férias</h3>
          <p>
            {linhas.length === 0 ? "Ninguém tem ciclo completo com dias a gozar agora." : (
              <>
                <strong>{linhas.length}</strong> {plural(linhas.length, "pessoa tem", "pessoas têm")} ciclo completo:{" "}
                <span className="fe-direito-n fe-direito-n--tempo">{total.tempo} com tempo</span> ·{" "}
                <span className="fe-direito-n fe-direito-n--perto">{total.perto} perto do limite</span> ·{" "}
                <span className="fe-direito-n fe-direito-n--vencido">{total.vencido} {plural(total.vencido, "vencido", "vencidos")}</span>
              </>
            )}
          </p>
        </div>
        <label className="fe-direito-busca">
          <Search size={16} aria-hidden="true" />
          <span className="fe-sr">Buscar pessoa</span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa…" />
        </label>
      </header>

      {achadas.length > 0 && (
        <table className="fe-direito-tabela">
          <thead>
            <tr><th>Pessoa</th><th>Ciclos completos</th><th>Completou em</th><th>Dias a gozar</th><th>Começar até</th><th>Situação</th></tr>
          </thead>
          <tbody>
            {achadas.map((l) => (
              <tr key={l.pessoa.employeeId}>
                <td><strong>{l.pessoa.nome}</strong><small>{[l.pessoa.setor, l.pessoa.empresa].filter(Boolean).join(" · ")}</small></td>
                <td>{l.ciclosCompletos}<small>{l.aGozar.length} com férias a gozar</small></td>
                <td>{dataBr(l.completoEm)}</td>
                <td>{l.diasPendentes}</td>
                <td>{dataBr(l.limite)}<small>{textoPrazo(l.aGozar[0])}</small></td>
                <td><span className={`fe-direito-selo fe-direito-selo--${l.situacao}`}>{ROTULO[l.situacao]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {termo && achadas.length === 0 && (
        <p className="fe-direito-vazio" role="status">
          {semDireito.length > 0
            ? `${semDireito.map((p) => p.nome).join(", ")}: ainda sem ciclo completo para tirar férias (o ciclo está em aquisição ou as férias já foram programadas).`
            : "Ninguém com esse nome na lista."}
        </p>
      )}
    </section>
  );
}
