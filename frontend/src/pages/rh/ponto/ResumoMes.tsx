// Ponto → Fechamento: uma linha por pessoa com o que a folha precisa saber do mês.
import { AlertTriangle, PencilLine } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PessoaPonto } from "../../../api/client";
import { Alert, Button, StatusBadge } from "../../../design-system";
import { ROTAS_RH } from "../rotasRh";
import { AVISO_SEM_ESCALA, fmtMin } from "./pontoFormato";

type Props = {
  pessoas: PessoaPonto[];
  onAbrirPapel: (employeeId: string) => void;
};

type Filtro = "todos" | "devem" | "extra" | "falta" | "conferir";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const conferir = (p: PessoaPonto) => p.avisosDia.filter((a) => a.avisos.some((x) => x !== AVISO_SEM_ESCALA));

const TEM: Record<Exclude<Filtro, "todos">, (p: PessoaPonto) => boolean> = {
  devem: (p) => p.resumo.devendo,
  extra: (p) => p.resumo.extraAPagarMin + p.resumo.noturnoMin > 0,
  falta: (p) => p.resumo.faltas > 0,
  conferir: (p) => conferir(p).length > 0,
};

// Quem pede atenção primeiro: deve horas, depois falta, depois dias para conferir.
const prioridade = (p: PessoaPonto) => (p.resumo.devendo ? 0 : p.resumo.faltas > 0 ? 1 : conferir(p).length > 0 ? 2 : 3);

function Vazio() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="po-sr">nenhum</span>
    </>
  );
}

const CARTOES: Array<{ filtro: Exclude<Filtro, "todos">; tom: string; rotulo: (n: number) => string }> = [
  { filtro: "devem", tom: "warning", rotulo: (n) => (n === 1 ? "deve horas" : "devem horas") },
  { filtro: "extra", tom: "success", rotulo: () => "com extra ou adicional noturno" },
  { filtro: "falta", tom: "danger", rotulo: () => "com falta para descontar" },
  { filtro: "conferir", tom: "info", rotulo: () => "com dias para conferir" },
];

export function ResumoMes({ pessoas, onAbrirPapel }: Props) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const apuradas = useMemo(() => pessoas.filter((p) => !p.semJornada), [pessoas]);
  const semJornada = pessoas.filter((p) => p.semJornada);
  const semSaldoAnterior = apuradas.filter((p) => !p.saldoAnteriorConfirmado && p.saldoInicialMin === 0).length;
  const visiveis = useMemo(
    () => [...apuradas.filter((p) => filtro === "todos" || TEM[filtro](p))].sort((a, b) => prioridade(a) - prioridade(b) || a.nome.localeCompare(b.nome, "pt-BR")),
    [apuradas, filtro],
  );

  return (
    <div className="po-resumo">
      {semJornada.length > 0 ? (
        <Alert tone="warning" title="Sem jornada cadastrada: não entram na conta">
          {semJornada.map((p) => p.nome).join(", ")}. Preencha entrada, saída e intervalo no cadastro do funcionário.
        </Alert>
      ) : null}

      <ul className="po-cartoes" aria-label="Filtrar pessoas">
        {CARTOES.map((c) => {
          const n = apuradas.filter(TEM[c.filtro]).length;
          const ativo = filtro === c.filtro;
          return (
            <li key={c.filtro}>
              <button type="button" className={`po-cartao po-cartao--${c.tom}`} aria-pressed={ativo} onClick={() => setFiltro(ativo ? "todos" : c.filtro)}>
                <strong>{n}</strong>
                <span>{c.rotulo(n)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="po-sr" role="status">Mostrando {visiveis.length} de {apuradas.length} pessoas.</p>
      {semSaldoAnterior > 0 ? (
        <p className="po-ajuda">O mês anterior ainda não foi fechado aqui para {plural(semSaldoAnterior, "pessoa", "pessoas")}: o saldo do banco delas começa em 0:00.</p>
      ) : null}

      <div className="po-tabela-rolagem" role="region" aria-label="Horas do mês por pessoa" tabIndex={0}>
        <table className="po-tabela">
          <caption className="po-sr">Horas do mês por pessoa, em horas e minutos</caption>
          <thead>
            <tr>
              <th scope="col">Pessoa</th>
              <th scope="col" className="po-num">Faltas</th>
              <th scope="col" className="po-num">Atraso <br />(banco)</th>
              <th scope="col" className="po-num">Extra a <br />pagar</th>
              <th scope="col" className="po-num">Extra <br />abatida</th>
              <th scope="col" className="po-num">Folga do <br />banco</th>
              <th scope="col" className="po-num">Adicional <br />noturno</th>
              <th scope="col" className="po-num">Saldo do <br />banco</th>
              <th scope="col">Dias para conferir</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((p) => {
              const dias = conferir(p);
              return (
                <tr key={p.employeeId} className={p.resumo.devendo ? "po-linha--devendo" : undefined}>
                  <th scope="row">
                    <div className="po-pessoa-celula">
                    <span className="po-pessoa-nome" title={p.turno ? `Turno ${p.turno} (${p.turnoFonte === "escala" ? "da Escala" : "do contrato"})` : undefined}>{p.nome}</span>
                    {p.resumo.devendo ? (
                      <StatusBadge tone="warning"><AlertTriangle size={12} aria-hidden="true" /> deve horas</StatusBadge>
                    ) : null}
                    {p.status === "FECHADO" ? <StatusBadge tone="neutral">fechado</StatusBadge> : null}
                    <Button variant="secondary" size="sm" leadingIcon={<PencilLine size={14} />} aria-label={`Lançar ponto de papel de ${p.nome}`} onClick={() => onAbrirPapel(p.employeeId)}>Lançar papel</Button>
                    </div>
                  </th>
                  <td className="po-num">{p.resumo.faltas || <Vazio />}</td>
                  <td className="po-num">{p.resumo.atrasoMin ? fmtMin(p.resumo.atrasoMin) : <Vazio />}</td>
                  <td className="po-num po-destaque">{p.resumo.extraAPagarMin ? fmtMin(p.resumo.extraAPagarMin) : <Vazio />}</td>
                  <td className="po-num">{p.resumo.abatidoMin ? fmtMin(p.resumo.abatidoMin) : <Vazio />}</td>
                  <td className="po-num">{p.debitoFolgaMin ? fmtMin(p.debitoFolgaMin) : <Vazio />}</td>
                  <td className="po-num">{p.resumo.noturnoMin ? fmtMin(p.resumo.noturnoMin) : <Vazio />}</td>
                  <td className={`po-num${p.resumo.devendo ? " po-negativo" : ""}`}>
                    {p.resumo.devendo ? <span className="po-sr">deve </span> : null}
                    {fmtMin(p.resumo.saldoBancoFinalMin)}
                  </td>
                  <td>
                    {dias.length > 0 ? (
                      <details className="po-avisos">
                        <summary>{plural(dias.length, "dia para conferir", "dias para conferir")}</summary>
                        <ul>
                          {dias.map((a) => (
                            <li key={a.data}><strong>{a.data.slice(8)}/{a.data.slice(5, 7)}</strong> {a.avisos.filter((x) => x !== AVISO_SEM_ESCALA).join(" ")}</li>
                          ))}
                        </ul>
                      </details>
                    ) : <Vazio />}
                    {!p.mesMontado ? <span className="po-sub po-sub--aviso">escala não montada · <Link to={ROTAS_RH.escala}>montar</Link></span> : null}
                  </td>
                </tr>
              );
            })}
            {visiveis.length === 0 ? (
              <tr><td colSpan={10} className="po-vazio">Ninguém neste filtro. Toque no cartão de novo para ver todos.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
