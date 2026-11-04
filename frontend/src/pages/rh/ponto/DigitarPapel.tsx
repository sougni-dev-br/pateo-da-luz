// Ponto → Ponto de papel: uma linha por dia, quatro campos de horário. Salva sozinho quando o
// foco sai da linha. Dia do relógio corrigido aqui passa a valer como lançamento manual.
// Também marca a folga tirada contra o banco de horas (mesmo tipo de dia da Escala).
// O mês é dividido em duas colunas lado a lado (1–16 e 17–31) quando a tela comporta: cabe sem rolar.
import { ArrowRight, Check } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ROTAS_RH } from "../rotasRh";
import { type DiaPontoLancado, type ResumoPonto, abonarPontoDia, folgaBancoPonto, getPontoDias, salvarPontoDia } from "../../../api/client";
import { Alert, Button, Select, StatusBadge } from "../../../design-system";
import { MOTIVOS_DE_ABONO, PODE_USAR_BANCO, ROTULO_DO_ABONO, ROTULO_ESCALA, batidasDosCampos, diasDoMes, fmtMin, jornadaDoDiaMin, minutosDoHorario, normalizarHorario, resumoDoDia, rotuloDoDia, turnoCurto } from "./pontoFormato";

type Props = {
  year: number;
  month: number;
  pessoas: Array<{ employeeId: string; nome: string }>;
  employeeId: string;
  onEscolher: (employeeId: string) => void;
  fechado: boolean;
  resumo: ResumoPonto | null;
  onSalvou: () => void;
  onIrParaFechamento: () => void;
};

const NOMES_CAMPOS = ["Entrada", "Intervalo", "Volta", "Saída"];
const nomeDoCampo = (i: number) => NOMES_CAMPOS[i] ?? `Batida ${i + 1}`;
const vazios = (): string[] => NOMES_CAMPOS.map(() => "");
const DICA_FORMATO = "Digite assim: 8:00, 800 ou 8h30.";
const DOMINGO = "dom";
const DIAS_DA_PRIMEIRA_QUINZENA = 15; // 1ª quinzena: 1 a 15; 2ª: 16 ao último dia do mês
const FOLGA_DO_BANCO = "FOLGA_BANCO_HORAS";

type Situacao = { estado: "salvando" | "salvo" | "erro"; motivo?: string };
type FormAbono = { horas: string; motivo: string; observacao: string };

// Duas batidas são entrada e saída (sem intervalo): a saída vai para o último campo, não para "Intervalo".
const camposDe = (marcacoes: string[]) =>
  marcacoes.length === 2 ? [marcacoes[0], "", "", marcacoes[1]] : [...marcacoes, ...vazios()].slice(0, Math.max(NOMES_CAMPOS.length, marcacoes.length));

// Quem trabalhou direto, sem intervalo, só tem entrada e saída: "Intervalo" e "Volta" podem ficar vazios.
const semIntervalo = (linha: string[]) => linha.length === NOMES_CAMPOS.length && linha[0].trim() !== "" && linha[1].trim() === "" && linha[2].trim() === "" && linha[3].trim() !== "";

// Aviso curto para caber na linha; o texto inteiro fica no title e no leitor de tela.
const avisoCurto = (aviso: string) => (aviso.startsWith("Falta") ? "falta batida" : aviso.startsWith("Trabalhou em dia de") ? "trabalhou na folga" : aviso.includes("16h") ? "mais de 16h" : "conferir");

export function DigitarPapel({ year, month, pessoas, employeeId, onEscolher, fechado, resumo, onSalvou, onIrParaFechamento }: Props) {
  const dias = diasDoMes(year, month);
  const metade = DIAS_DA_PRIMEIRA_QUINZENA;
  const blocos = [dias.slice(0, metade), dias.slice(metade)];
  const [campos, setCampos] = useState<Record<string, string[]>>({});
  const [salvos, setSalvos] = useState<Record<string, DiaPontoLancado>>({});
  const [escala, setEscala] = useState<Record<string, string>>({});
  const [turno, setTurno] = useState<string | null>(null);
  const [jornadaMin, setJornadaMin] = useState<number | null>(null);
  const [abonando, setAbonando] = useState<string | null>(null);
  const [formAbono, setFormAbono] = useState<FormAbono>({ horas: "", motivo: "", observacao: "" });
  const [abonoOcupado, setAbonoOcupado] = useState(false);
  const [abonoErro, setAbonoErro] = useState<string | null>(null);
  const [mesMontado, setMesMontado] = useState(true);
  const [situacao, setSituacao] = useState<Record<string, Situacao>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [carregando, setCarregando] = useState(false);
  const grade = useRef<HTMLDivElement>(null);
  // O que está na tela agora, para o salvamento (que roda depois do blur) não usar um valor velho.
  const camposAtuais = useRef(campos);
  camposAtuais.current = campos;

  const carregar = useCallback(async (sinal: AbortSignal) => {
    if (!employeeId) return;
    setErro(null);
    setCarregando(true);
    try {
      const { dias: lancados, escala: tipos, turno: turnoDaPessoa, jornadaMin: jornada, mesMontado: montado } = await getPontoDias(employeeId, year, month, sinal);
      setSalvos(Object.fromEntries(lancados.map((d) => [d.date, d])));
      setCampos(Object.fromEntries(lancados.map((d) => [d.date, camposDe(d.marcacoes)])));
      setEscala(Object.fromEntries(tipos.map((e) => [e.date, e.tipo])));
      setSituacao({});
      setTurno(turnoDaPessoa);
      setJornadaMin(jornada);
      setAbonando(null);
      setMesMontado(montado);
    } catch (e) {
      if (sinal.aborted) return;
      setErro(e instanceof Error ? e.message : "Não consegui carregar os dias.");
    } finally {
      if (!sinal.aborted) setCarregando(false);
    }
  }, [employeeId, year, month]);

  useEffect(() => {
    setCampos({});
    setSalvos({});
    setEscala({});
    const controle = new AbortController();
    void carregar(controle.signal);
    return () => controle.abort();
  }, [carregar]);

  const editar = (dia: string, i: number, valor: string) =>
    setCampos((atual) => {
      const linha = [...(atual[dia] ?? vazios())];
      linha[i] = valor;
      return { ...atual, [dia]: linha };
    });

  // Ao sair do campo, o que ela digitou já aparece no formato final (800 → 08:00).
  const normalizar = (dia: string, i: number) => {
    const valor = campos[dia]?.[i] ?? "";
    const pronto = normalizarHorario(valor);
    if (pronto && pronto !== valor) editar(dia, i, pronto);
  };

  const salvar = async (dia: string) => {
    const linha = camposAtuais.current[dia] ?? vazios();
    const batidas = batidasDosCampos(linha);
    const rotulo = rotuloDoDia(dia);
    if (batidas === null) {
      setSituacao((s) => ({ ...s, [dia]: { estado: "erro", motivo: `Horário inválido. ${DICA_FORMATO}` } }));
      return;
    }
    const ultimoPreenchido = linha.map((c) => c.trim() !== "").lastIndexOf(true);
    if (!semIntervalo(linha) && linha.slice(0, ultimoPreenchido + 1).some((c) => c.trim() === "")) {
      setSituacao((s) => ({ ...s, [dia]: { estado: "erro", motivo: "Preencha os horários em ordem, sem deixar campo vazio no meio." } }));
      return;
    }
    if (batidas.join(",") === (salvos[dia]?.marcacoes ?? []).join(",")) return;

    setSituacao((s) => ({ ...s, [dia]: { estado: "salvando" } }));
    setErro(null);
    try {
      await salvarPontoDia(employeeId, dia, batidas);
      setSalvos((s) => ({ ...s, [dia]: { date: dia, origem: "PAPEL", marcacoes: batidas, editadoManual: true, notes: null } }));
      setSituacao((s) => ({ ...s, [dia]: { estado: "salvo" } }));
      setAnuncio(batidas.length === 0 ? `${rotulo} limpo.` : `${rotulo} salvo.`);
      onSalvou();
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "Não consegui salvar. Tente de novo.";
      setSituacao((s) => ({ ...s, [dia]: { estado: "erro", motivo } }));
      setAnuncio(`${rotulo}: não salvou. ${motivo}`);
    }
  };

  // Usa (ou devolve) o banco de horas para folgar neste dia. A escala volta do servidor: o dia
  // desfeito retoma o tipo que tinha antes.
  const alternarFolgaBanco = async (dia: string, ativo: boolean) => {
    const rotulo = rotuloDoDia(dia);
    setSituacao((s) => ({ ...s, [dia]: { estado: "salvando" } }));
    setErro(null);
    try {
      await folgaBancoPonto(employeeId, dia, ativo);
      const { escala: tipos, mesMontado: montado } = await getPontoDias(employeeId, year, month);
      setMesMontado(montado);
      setEscala(Object.fromEntries(tipos.map((e) => [e.date, e.tipo])));
      setSituacao((s) => ({ ...s, [dia]: { estado: "salvo" } }));
      setAnuncio(ativo ? `${rotulo}: folga do banco de horas marcada.` : `${rotulo}: folga do banco desfeita.`);
      onSalvou();
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "Não consegui marcar a folga.";
      setSituacao((s) => ({ ...s, [dia]: { estado: "erro", motivo } }));
      setAnuncio(`${rotulo}: ${motivo}`);
    }
  };

  // Abre o painel de abono do dia: sugere o que faltou para a jornada (ou mostra o abono já lançado).
  const abrirAbono = (dia: string) => {
    const lancado = salvos[dia];
    const trabalhado = resumoDoDia(campos[dia] ?? vazios()).trabalhadoMin;
    const sugerido = jornadaMin ? Math.max(0, jornadaMin - trabalhado) : 0;
    setAbonoErro(null);
    setFormAbono(lancado?.abonoMin ? { horas: fmtMin(lancado.abonoMin), motivo: lancado.abonoMotivo ?? "", observacao: "" } : { horas: sugerido > 0 ? fmtMin(sugerido) : "", motivo: "", observacao: "" });
    setAbonando(dia);
  };

  const salvarAbono = async (dia: string, remover: boolean) => {
    const rotulo = rotuloDoDia(dia);
    const minutos = remover ? 0 : minutosDoHorario(formAbono.horas);
    if (minutos === null || (!remover && minutos === 0)) {
      setAbonoErro("Informe as horas abonadas, por exemplo 3:01.");
      return;
    }
    if (!remover && !formAbono.motivo) {
      setAbonoErro("Escolha o motivo do abono.");
      return;
    }
    setAbonoOcupado(true);
    setAbonoErro(null);
    try {
      const obs = formAbono.observacao.trim();
      await abonarPontoDia(employeeId, dia, minutos, remover ? null : formAbono.motivo, obs ? obs : undefined);
      setSalvos((s) => ({ ...s, [dia]: { ...(s[dia] as DiaPontoLancado), abonoMin: minutos, abonoMotivo: remover ? null : formAbono.motivo } }));
      setAbonando(null);
      setAnuncio(remover ? `${rotulo}: abono removido.` : `${rotulo}: ${fmtMin(minutos)} abonadas.`);
      onSalvou();
    } catch (e) {
      setAbonoErro(e instanceof Error ? e.message : "Não consegui salvar o abono.");
    } finally {
      setAbonoOcupado(false);
    }
  };

  const aoSairDaLinha = (dia: string) => (e: FocusEvent<HTMLTableRowElement>) => {
    // Com o foco trocado por programa (Enter) nem todo navegador informa o destino: espera o foco pousar e olha onde ele está.
    const linha = e.currentTarget;
    window.setTimeout(() => {
      if (!linha.contains(document.activeElement)) void salvar(dia);
    }, 0);
  };

  // Enter anda para o próximo campo; no último da linha, vai ao primeiro da linha seguinte (inclusive na outra coluna).
  const aoTeclar = (dia: string, i: number, quantos: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const proximoDia = i + 1 < quantos ? dia : dias[dias.indexOf(dia) + 1];
    const proximoCampo = i + 1 < quantos ? i + 1 : 0;
    if (!proximoDia) return;
    grade.current?.querySelector<HTMLInputElement>(`[data-campo="${proximoDia}:${proximoCampo}"]`)?.focus();
  };

  const indice = pessoas.findIndex((p) => p.employeeId === employeeId);
  const proxima = indice >= 0 ? pessoas[indice + 1] : undefined;

  const linhaDoDia = (dia: string) => {
    const linha = campos[dia] ?? vazios();
    const lancado = salvos[dia];
    const estado = situacao[dia];
    const tipo = escala[dia];
    const folgaDoBanco = tipo === FOLGA_DO_BANCO;
    const temBatidas = linha.some((c) => c.trim() !== "");
    const conta = resumoDoDia(linha);
    const jornadaDoDia = jornadaMin && temBatidas ? jornadaDoDiaMin(jornadaMin, batidasDosCampos(linha) ?? []) : null;
    const domingo = rotuloDoDia(dia).startsWith(DOMINGO);
    const travado = fechado || folgaDoBanco;
    const abono = lancado?.abonoMin ?? 0;
    const podeAbonar = !fechado && !folgaDoBanco && Boolean(lancado) && (lancado?.marcacoes.length ?? 0) > 0;
    return (
      <Fragment key={dia}>
      <tr onBlur={aoSairDaLinha(dia)} className={folgaDoBanco ? "po-linha--banco" : domingo ? "po-linha--domingo" : undefined}>
        <th scope="row">
          <time dateTime={dia} className="po-dia">
            <span className="po-dia-sem">{rotuloDoDia(dia).split(" ")[0]}</span>{" "}
            <span className="po-dia-num">{rotuloDoDia(dia).split(" ")[1]}</span>
          </time>
          {domingo ? <span className="po-sr"> domingo</span> : null}
        </th>
        {linha.map((valor, i) => (
          <td key={i}>
            <input
              className={`po-hora${estado?.estado === "erro" ? " po-hora--erro" : ""}`}
              data-campo={`${dia}:${i}`}
              inputMode="numeric"
              enterKeyHint="next"
              autoComplete="off"
              aria-label={`${nomeDoCampo(i)}, ${rotuloDoDia(dia)}`}
              aria-invalid={estado?.estado === "erro" || undefined}
              aria-describedby={estado?.estado === "erro" ? `erro-${dia}` : undefined}
              readOnly={travado}
              aria-readonly={travado || undefined}
              value={valor}
              onChange={(e) => editar(dia, i, e.target.value)}
              onBlur={() => normalizar(dia, i)}
              onKeyDown={aoTeclar(dia, i, linha.length)}
            />
          </td>
        ))}
        <td className="po-trabalhou">
          {temBatidas ? (
            <>
              <span className="po-num-forte">{fmtMin(conta.trabalhadoMin)}</span>
              {conta.viraNoite ? <span className="po-tag" title="A saída é no dia seguinte">+1 dia</span> : null}
              {jornadaDoDia && jornadaMin && jornadaDoDia !== jornadaMin ? <span className="po-tag" title="Turno de 2h de intervalo: a jornada deste dia é maior que a do cadastro">jornada {fmtMin(jornadaDoDia)}</span> : null}
              {conta.avisos.map((a) => <span className="po-tag po-tag--aviso" key={a} title={a}>{avisoCurto(a)}<span className="po-sr">: {a}</span></span>)}
            </>
          ) : null}
        </td>
        <td className="po-banco">
          {folgaDoBanco ? (
            <>
              <StatusBadge tone="info">folga do banco</StatusBadge>
              {!fechado ? <button type="button" className="po-link" onClick={() => void alternarFolgaBanco(dia, false)}>Desfazer</button> : null}
            </>
          ) : tipo && !PODE_USAR_BANCO(tipo) ? (
            <span className="po-esc po-esc--folga">{ROTULO_ESCALA[tipo] ?? tipo.toLowerCase()}</span>
          ) : (
            <>
              {tipo === "EVENTO" ? <span className="po-esc">evento</span> : mesMontado ? <span className="po-esc" title={turno ? `Turno ${turno}` : undefined}>{turnoCurto(turno) || "turno"}</span> : <span className="po-esc po-esc--sem" title="A escala deste mês não está montada para esta pessoa">sem escala</span>}
              {!fechado && !temBatidas ? <button type="button" className="po-link" aria-label={`Usar banco de horas para folgar em ${rotuloDoDia(dia)}`} onClick={() => void alternarFolgaBanco(dia, true)}>Usar banco</button> : null}
            </>
          )}
          {abono > 0 ? (
            podeAbonar ? (
              <button type="button" className="po-link po-link--abono" title={ROTULO_DO_ABONO(lancado?.abonoMotivo)} aria-label={`Abono de ${fmtMin(abono)} em ${rotuloDoDia(dia)}, ${ROTULO_DO_ABONO(lancado?.abonoMotivo)}. Editar`} onClick={() => abrirAbono(dia)}>abono {fmtMin(abono)}</button>
            ) : (
              <span className="po-esc" title={ROTULO_DO_ABONO(lancado?.abonoMotivo)}>abono {fmtMin(abono)}</span>
            )
          ) : podeAbonar ? (
            <button type="button" className="po-link" aria-label={`Abonar horas em ${rotuloDoDia(dia)}`} onClick={() => abrirAbono(dia)}>Abonar horas</button>
          ) : null}
        </td>
        <td className="po-situacao">
          {estado?.estado === "salvando" ? <span className="po-sub">salvando…</span> : null}
          {estado?.estado === "salvo" ? <StatusBadge tone="success"><Check size={12} aria-hidden="true" /> salvo</StatusBadge> : null}
          {estado?.estado === "erro" ? <span id={`erro-${dia}`} role="alert" className="po-erro-linha">{estado.motivo}</span> : null}
          {estado?.estado === undefined && lancado && lancado.marcacoes.length > 0 ? (
            <StatusBadge tone={lancado.origem === "PAPEL" ? "info" : "neutral"}>{lancado.origem === "PAPEL" ? "papel" : "relógio"}</StatusBadge>
          ) : null}
        </td>
      </tr>
      {abonando === dia ? (
        <tr className="po-linha-abono">
          <td colSpan={8}>
            <form className="po-abono" aria-label={`Abonar horas de ${rotuloDoDia(dia)}`} onSubmit={(e) => { e.preventDefault(); void salvarAbono(dia, false); }}>
              <label>Horas abonadas
                <input className="po-hora po-hora--larga" inputMode="numeric" autoComplete="off" autoFocus value={formAbono.horas} onChange={(e) => setFormAbono({ ...formAbono, horas: e.target.value })} onBlur={() => { const p = normalizarHorario(formAbono.horas); if (p) setFormAbono((f) => ({ ...f, horas: fmtMin(Number(p.slice(0, 2)) * 60 + Number(p.slice(3, 5))) })); }} />
              </label>
              <label>Motivo
                <select className="po-select" value={formAbono.motivo} onChange={(e) => setFormAbono({ ...formAbono, motivo: e.target.value })}>
                  <option value="">Escolha…</option>
                  {MOTIVOS_DE_ABONO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
              <label>Observação (opcional; obrigatória em “Outro”)
                <input className="po-texto" type="text" maxLength={300} autoComplete="off" value={formAbono.observacao} onChange={(e) => setFormAbono({ ...formAbono, observacao: e.target.value })} />
              </label>
              <Button type="submit" size="sm" aria-busy={abonoOcupado} disabled={abonoOcupado}>{abonoOcupado ? "Salvando…" : "Salvar abono"}</Button>
              {abono > 0 ? <Button type="button" variant="secondary" size="sm" disabled={abonoOcupado} onClick={() => void salvarAbono(dia, true)}>Remover abono</Button> : null}
              <Button type="button" variant="secondary" size="sm" onClick={() => setAbonando(null)}>Cancelar</Button>
            </form>
            {abonoErro ? <span role="alert" className="po-erro-linha">{abonoErro}</span> : null}
            <p className="po-ajuda">Horas abonadas contam como cumpridas: não viram atraso e não saem do banco. Jornada do dia: {jornadaMin ? fmtMin(jornadaMin) : "não cadastrada"}.</p>
          </td>
        </tr>
      ) : null}
      </Fragment>
    );
  };

  return (
    <div className="po-papel">
      <div className="po-barra">
        <Select
          label="Pessoa"
          value={employeeId}
          onChange={(e) => onEscolher(e.target.value)}
          options={pessoas.map((p) => ({ value: p.employeeId, label: p.nome }))}
          placeholder="Escolha quem vai lançar"
          disabled={pessoas.length === 0}
          containerClassName="po-barra-pessoa"
        />
        {resumo ? (
          <dl className="po-faixa" aria-label="Resumo do mês desta pessoa">
            <div><dt>Faltas</dt><dd>{resumo.faltas}</dd></div>
            <div><dt>Atraso</dt><dd>{fmtMin(resumo.atrasoMin)}</dd></div>
            <div><dt>Extra a pagar</dt><dd>{fmtMin(resumo.extraAPagarMin)}</dd></div>
            <div><dt>Noturno</dt><dd>{fmtMin(resumo.noturnoMin)}</dd></div>
            <div><dt>Saldo do banco</dt><dd className={resumo.devendo ? "po-negativo" : undefined}>{resumo.devendo ? <span className="po-sr">deve </span> : null}{fmtMin(resumo.saldoBancoFinalMin)}</dd></div>
          </dl>
        ) : null}
        <details className="po-dicas">
          <summary>Como digitar</summary>
          <p>Os campos são entrada, intervalo (saída para o intervalo), volta e saída. Digite só os números (800 vira 08:00). Quem trabalhou direto, sem intervalo, leva só Entrada e Saída: deixe Intervalo e Volta vazios. Enter passa para o próximo campo. O dia salva quando você sai da linha. Apague todos os horários para limpar o dia. Use “Usar banco” para folgar um dia contra o saldo do banco de horas e “Abonar horas” quando a pessoa saiu com atestado de horas ou foi ao médico do trabalho.</p>
        </details>
        {employeeId && proxima ? (
          <Button variant="secondary" size="sm" className="po-barra-proxima" onClick={() => onEscolher(proxima.employeeId)}>
            Próxima: {proxima.nome} <ArrowRight size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {fechado ? (
        <Alert tone="warning" title="Mês fechado">
          Os horários estão só para consulta. <Button variant="secondary" size="sm" onClick={onIrParaFechamento}>Ir para o Fechamento</Button> para reabrir.
        </Alert>
      ) : null}
      {erro ? <Alert tone="error">{erro}</Alert> : null}
      {employeeId && !carregando && !mesMontado ? (
        <Alert tone="warning" title="Escala do mês não montada para esta pessoa">
          Sem escala, dia sem batida não conta como falta. <Link to={ROTAS_RH.escala}>Montar a escala</Link> para o Ponto e a Escala conversarem.
        </Alert>
      ) : null}

      <p className="po-sr" role="status">{anuncio}</p>

      {employeeId ? (
        <div className="po-grade" ref={grade} aria-busy={carregando}>
          {blocos.map((lista, n) => (
            <div className="po-tabela-rolagem po-tabela-rolagem--dias" role="region" aria-label={`Batidas dos dias ${lista[0].slice(8)} a ${lista[lista.length - 1].slice(8)}`} tabIndex={0} key={lista[0]}>
              <table className="po-tabela po-tabela--dias">
                <caption className="po-quinzena-titulo">
                  {n + 1}ª quinzena <span>dias {Number(lista[0].slice(8))} a {Number(lista[lista.length - 1].slice(8))}</span>
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Dia</th>
                    {NOMES_CAMPOS.map((n) => <th scope="col" key={n}>{n}</th>)}
                    <th scope="col">Trabalhou</th>
                    <th scope="col">Escala</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>{lista.map(linhaDoDia)}</tbody>
              </table>
            </div>
          ))}
        </div>
      ) : (
        <p className="po-ajuda">Escolha uma pessoa para lançar o ponto de papel dela. Só aparece quem tem jornada cadastrada ou alguma batida no mês.</p>
      )}
    </div>
  );
}
