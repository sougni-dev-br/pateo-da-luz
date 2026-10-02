import { useEffect, useState } from "react";
import { getEmployeeFicha, type EmployeeFicha, type EmployeeFichaFerias, type StatusFerias } from "../../api/client";
import { Alert, Button, FormSection, Money, StatusBadge, type StatusTone } from "../../design-system";
import { diaBr } from "./historicoCadastroFormato";
import "./FichaRegistro.css";

type Props = { employeeId: string };

const STATUS: Record<StatusFerias, { texto: string; tom: StatusTone }> = {
  QUITADO: { texto: "Gozadas", tom: "success" },
  A_GOZAR: { texto: "A gozar", tom: "warning" },
  PRAZO_VENCIDO: { texto: "Prazo vencido", tom: "danger" },
  EM_AQUISICAO: { texto: "Em aquisição", tom: "info" },
  CONTRATO_ENCERRADO: { texto: "Acerto na rescisão", tom: "neutral" },
};

const ROTULO_CARTEIRA = { ADMISSAO: "Admissão", SALARIO: "Salário", CARGO: "Cargo" } as const;

function Periodo({ p }: { p: EmployeeFichaFerias }) {
  const s = STATUS[p.status];
  const dias = p.diasGozados + p.diasAbono;
  return (
    <li className="ficha-registro__ferias">
      <div className="ficha-registro__ferias-topo">
        <strong>{diaBr(p.aquisitivoInicio)} a {diaBr(p.aquisitivoFim)}</strong>
        <StatusBadge tone={s.tom}>{s.texto}</StatusBadge>
      </div>
      {p.gozos.map((g) => (
        <div key={`${g.inicio}-${g.fim}`} className="ficha-registro__detalhe">
          gozo {diaBr(g.inicio)} a {diaBr(g.fim)}
          {g.abonoInicio && g.abonoFim && <> · abono {diaBr(g.abonoInicio)} a {diaBr(g.abonoFim)}</>}
        </div>
      ))}
      <div className="ficha-registro__detalhe">
        {dias > 0 ? `${dias} de 30 dias` : "nenhum gozo registrado"}
        {(p.status === "A_GOZAR" || p.status === "PRAZO_VENCIDO") && <> · prazo para conceder até {diaBr(p.concessivoFim)}</>}
      </div>
    </li>
  );
}

function Carteira({ ficha }: { ficha: EmployeeFicha }) {
  return (
    <ol className="historico-cadastro" aria-label="Anotações da carteira">
      {ficha.carteira.map((a) => (
        <li key={a.id} className="historico-cadastro__item">
          <div className="historico-cadastro__data">{diaBr(a.data)}</div>
          <div className="historico-cadastro__mudanca">
            <strong>{ROTULO_CARTEIRA[a.tipo]}</strong>
            {a.tipo === "CARGO"
              ? <span>{a.cargoAnterior} → {a.cargo} {a.cbo && <span className="ficha-registro__cbo">CBO {a.cbo}</span>}</span>
              : <span>
                  {a.tipo === "ADMISSAO" && <>{a.cargo} {a.cbo && <span className="ficha-registro__cbo">CBO {a.cbo}</span>} · </>}
                  {ficha.salarioOculto ? <span className="historico-cadastro__oculto">salário oculto</span> : a.salario != null && <Money value={a.salario} />}
                </span>}
          </div>
          {a.retroativoCompetencia && <div className="historico-cadastro__meta">retroativo à competência {a.retroativoCompetencia}</div>}
        </li>
      ))}
    </ol>
  );
}

// Seção "Ficha de registro": o que veio do PDF da contabilidade e não cabe no formulário —
// dependentes, férias por período aquisitivo e as anotações da carteira. Só consulta.
export function FichaRegistro({ employeeId }: Props) {
  const [ficha, setFicha] = useState<EmployeeFicha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setFicha(null);
    setErro(null);
    getEmployeeFicha(employeeId)
      .then((r) => { if (vivo) setFicha(r); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : "Erro ao carregar a ficha de registro."); });
    return () => { vivo = false; };
  }, [employeeId, tentativa]);

  const vazia = ficha && ficha.dependentes.length === 0 && ficha.carteira.length === 0 && ficha.ferias.every((p) => p.gozos.length === 0);
  // Mais recente em cima, como o histórico do cadastro.
  const periodos = ficha ? [...ficha.ferias].reverse() : [];

  return (
    <FormSection title="Ficha de registro" description="Dependentes, férias e carteira, da ficha da contabilidade.">
      {erro && (
        <Alert tone="error">
          {erro}{" "}
          <Button variant="secondary" size="sm" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</Button>
        </Alert>
      )}
      {!erro && !ficha && <div className="historico-cadastro__vazio" role="status" aria-live="polite">Carregando…</div>}
      {ficha && vazia && <div className="historico-cadastro__vazio">Ficha de registro ainda não importada para esta pessoa.</div>}
      {ficha && !vazia && (
        <div className="ficha-registro">
          <div className="ficha-registro__bloco">
            <h4 className="ficha-registro__titulo">Dependentes</h4>
            {ficha.dependentes.length === 0
              ? <div className="historico-cadastro__vazio">Nenhum na ficha.</div>
              : <ul className="ficha-registro__lista">{ficha.dependentes.map((d) => <li key={d.id}>{d.nome}</li>)}</ul>}
          </div>
          <div className="ficha-registro__bloco">
            <h4 className="ficha-registro__titulo">Férias por período aquisitivo</h4>
            {periodos.length === 0
              ? <div className="historico-cadastro__vazio">Sem admissão em carteira para contar os períodos.</div>
              : <ol className="ficha-registro__lista ficha-registro__lista--ferias">{periodos.map((p) => <Periodo key={p.aquisitivoInicio} p={p} />)}</ol>}
          </div>
          <div className="ficha-registro__bloco">
            <h4 className="ficha-registro__titulo">Carteira</h4>
            {ficha.carteira.length === 0
              ? <div className="historico-cadastro__vazio">Nenhuma anotação na ficha.</div>
              : <div className="ficha-registro__rolagem"><Carteira ficha={ficha} /></div>}
          </div>
        </div>
      )}
    </FormSection>
  );
}
