import { useEffect, useState } from "react";
import { getEmployeeHistorico, type EmployeeHistoricoLinha } from "../../api/client";
import { Alert, FormSection, Money } from "../../design-system";
import { ROTULO_ORIGEM, diaBr, ehDinheiro, momentoBr, textoDoValor } from "./historicoCadastroFormato";
import "./HistoricoCadastro.css";

type Props = { employeeId: string };

function Valor({ linha, v }: { linha: EmployeeHistoricoLinha; v: string | null }) {
  if (ehDinheiro(linha) && v != null) return <Money value={v} />;
  return <>{textoDoValor(linha.campo, v)}</>;
}

// Seção "Histórico do cadastro" da ficha: cada alteração de salário, vínculo, empresa,
// cargo etc., mais recente primeiro. Salário sem permissão vem do backend sem valores.
export function HistoricoCadastro({ employeeId }: Props) {
  const [linhas, setLinhas] = useState<EmployeeHistoricoLinha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    getEmployeeHistorico(employeeId)
      .then((r) => { if (vivo) setLinhas(r); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : "Erro ao carregar o histórico."); });
    return () => { vivo = false; };
  }, [employeeId]);

  return (
    <FormSection title="Histórico do cadastro">
      {erro && <Alert tone="error">{erro}</Alert>}
      {!erro && linhas == null && <div className="historico-cadastro__vazio">Carregando…</div>}
      {!erro && linhas?.length === 0 && (
        <div className="historico-cadastro__vazio">
          Nenhuma alteração de salário, vínculo, empresa ou cargo registrada. O cadastro vale como está desde a admissão.
        </div>
      )}
      {!erro && linhas && linhas.length > 0 && (
        <ol className="historico-cadastro" aria-label="Alterações do cadastro">
          {linhas.map((l) => (
            <li key={l.id} className="historico-cadastro__item">
              <div className="historico-cadastro__data">vale desde <strong>{diaBr(l.vigenteDesde)}</strong></div>
              <div className="historico-cadastro__mudanca">
                <strong>{l.rotulo}</strong>
                {l.oculto
                  ? <span className="historico-cadastro__oculto">alterado</span>
                  : <span><Valor linha={l} v={l.valorAnterior} /> → <Valor linha={l} v={l.valorNovo} /></span>}
              </div>
              {l.motivo && <div className="historico-cadastro__motivo">{l.motivo}</div>}
              <div className="historico-cadastro__meta">
                {ROTULO_ORIGEM[l.origem] ?? l.origem} · {l.criadoPorNome ?? "—"} em {momentoBr(l.createdAt)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </FormSection>
  );
}
