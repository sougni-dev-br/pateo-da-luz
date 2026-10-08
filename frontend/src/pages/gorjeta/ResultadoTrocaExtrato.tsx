// Resultado de "Trocar extrato": quem mudou no extrato novo e quais salários do Contas a
// Pagar ficaram diferentes dele (atualizar é no Retorno do RH). Fica na tela até fechar.
import { X } from "lucide-react";
import type { TipTrocaExtrato } from "../../api/client";
import { money, mutedStyle } from "./gorjetaUtils";

type Props = { empresa: string; troca: TipTrocaExtrato; avisos: string[]; onFechar: () => void };

const SITUACAO = { MUDOU: "mudou", ENTROU: "entrou", SAIU: "saiu" } as const;
const valor = (v: number | null) => (v == null ? "—" : money(v));
const antesDepois = (a: number | null, d: number | null) => `${valor(a)} → ${valor(d)}`;

export function ResultadoTrocaExtrato({ empresa, troca, avisos, onFechar }: Props) {
  return (
    <section className="troca-extrato" role="region" aria-label={`Extrato trocado: ${empresa}`}>
      <div className="troca-extrato-topo">
        <strong>Extrato de {empresa} trocado{troca.motivo ? ` — ${troca.motivo}` : ""}</strong>
        <button type="button" className="botao-desfazer" aria-label="Fechar o resultado da troca" onClick={onFechar}><X size={14} /></button>
      </div>
      {troca.diferencas.length === 0
        ? <span style={mutedStyle}>Nenhuma diferença de líquido ou gorjeta em relação ao extrato anterior.</span>
        : (
          <ul className="troca-extrato-lista" aria-label="Diferenças do extrato novo">
            {troca.diferencas.map((d) => (
              <li key={`${d.employeeId ?? d.nome}-${d.situacao}`}>
                <strong>{d.nome}</strong> <span style={mutedStyle}>({SITUACAO[d.situacao]})</span>
                {" · "}líquido {antesDepois(d.liquidoAntes, d.liquidoDepois)}
                {" · "}gorjeta {antesDepois(d.gorjetaAntes, d.gorjetaDepois)}
              </li>
            ))}
          </ul>
        )}
      {troca.contasAPagar.length > 0 && (
        <div className="troca-extrato-cap" role="alert">
          <strong>{troca.avisoContasAPagar}</strong>
          <ul aria-label="Salários diferentes no Contas a Pagar">
            {troca.contasAPagar.map((c) => (
              <li key={c.employeeId}>
                {c.nome}: no Contas a Pagar {valor(c.noContasAPagar)}, no extrato novo {valor(c.extratoNovo)}
                {c.titulo ? ` (no título "${c.titulo}")` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {avisos.length > 0 && (
        <ul className="troca-extrato-avisos" aria-label="Avisos da troca">
          {avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
    </section>
  );
}
