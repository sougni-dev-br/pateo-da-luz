import { useEffect, useMemo, useState } from "react";
import {
  createExtraDiaria, getExtraEventos, getExtraHabitualidade, updateExtraDiaria,
  type ExtraDiaria, type ExtraEventoUsado, type ExtraDuracao, type ExtraMotivo, type ExtraPessoas, type ExtraStatus,
} from "../../../api/client";
import { Alert, Button, FormField, FormGrid, Select, TextField, Textarea } from "../../../design-system";
import { Janela } from "./Janela";
import { maskMoney, moneyToMasked } from "../../../utils/format";
import {
  MOTIVO_COBERTURA, MOTIVO_ROTULO, MOTIVOS, SETORES_BASE, STATUS_ROTULO, brl, hojeIso, paraNumero,
} from "./extrasRotulos";
import { PessoaForaModal } from "./PessoaForaModal";

export type PessoaEscolhida = { tipo: "CASA" | "FORA"; id: string };

type Props = {
  diaria: ExtraDiaria | null;
  pessoas: ExtraPessoas;
  padrao: { inteira: number; meia: number };
  pessoaInicial?: PessoaEscolhida | null;
  dataInicial?: string;
  onRecarregarPessoas: () => Promise<ExtraPessoas>;
  podeCadastrarPessoa: boolean;
  onFechar: () => void;
  onSalvo: () => void;
  // "Lançar e continuar": a lista atrás é recarregada e a janela segue aberta.
  onLancouOutra: () => void;
};

const normaliza = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function DiariaModal({ diaria, pessoas: pessoasIniciais, padrao, pessoaInicial, dataInicial, podeCadastrarPessoa, onRecarregarPessoas, onFechar, onSalvo, onLancouOutra }: Props) {
  const [pessoas, setPessoas] = useState(pessoasIniciais);
  const [escolhida, setEscolhida] = useState<PessoaEscolhida | null>(
    diaria ? { tipo: diaria.origem, id: diaria.pessoaId } : pessoaInicial ?? null
  );
  const [busca, setBusca] = useState("");
  const [novaPessoa, setNovaPessoa] = useState<string | null>(null);

  const casaInicial = escolhida?.tipo === "CASA" ? pessoas.casa.find((p) => p.id === escolhida.id) : undefined;
  const [date, setDate] = useState(diaria?.date ?? dataInicial ?? hojeIso());
  const [duration, setDuration] = useState<ExtraDuracao>(diaria?.duration ?? "INTEIRA");
  const [sector, setSector] = useState(diaria?.sector ?? casaInicial?.setor ?? "");
  const [role, setRole] = useState(diaria?.role ?? casaInicial?.cargo ?? "");
  const [startTime, setStartTime] = useState(diaria?.startTime ?? "");
  const [endTime, setEndTime] = useState(diaria?.endTime ?? "");
  const [reason, setReason] = useState<ExtraMotivo | "">(diaria?.reason ?? "");
  const [covered, setCovered] = useState(diaria?.coveredEmployeeId ?? "");
  const [status, setStatus] = useState<ExtraStatus>(diaria?.status ?? ((dataInicial ?? hojeIso()) > hojeIso() ? "PREVISTA" : "REALIZADA"));
  const [statusTocado, setStatusTocado] = useState(Boolean(diaria));
  const [base, setBase] = useState(moneyToMasked(diaria?.baseAmount ?? padrao.inteira));
  const [baseEditada, setBaseEditada] = useState(Boolean(diaria?.baseAdjustReason));
  const [baseMotivo, setBaseMotivo] = useState(diaria?.baseAdjustReason ?? "");
  const [transporte, setTransporte] = useState(diaria?.transportAmount ? moneyToMasked(diaria.transportAmount) : "");
  const [acrescimo, setAcrescimo] = useState(diaria?.bonusAmount ? moneyToMasked(diaria.bonusAmount) : "");
  const [desconto, setDesconto] = useState(diaria?.discountAmount ? moneyToMasked(diaria.discountAmount) : "");
  const [notes, setNotes] = useState(diaria?.notes ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [lancadas, setLancadas] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [avisoFrequencia, setAvisoFrequencia] = useState<string[]>([]);
  const [evento, setEvento] = useState(diaria?.eventName ?? "");
  const [eventosUsados, setEventosUsados] = useState<ExtraEventoUsado[]>([]);

  // Nomes já usados viram sugestão: "Apraxia" digitado uma vez, escolhido depois.
  useEffect(() => {
    let vivo = true;
    getExtraEventos().then((l) => { if (vivo) setEventosUsados(l); }).catch(() => {});
    return () => { vivo = false; };
  }, [lancadas.length]);

  // Pessoa de fora: simula a diária antes de salvar e avisa se, com ela, a
  // frequência passa do limite (risco de vínculo). Só avisa, não bloqueia.
  const conta = status === "REALIZADA" || status === "PREVISTA";
  const foraId = escolhida?.tipo === "FORA" && conta ? escolhida.id : null;
  useEffect(() => {
    if (!foraId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setAvisoFrequencia([]); return; }
    let vivo = true;
    getExtraHabitualidade({ pessoa: foraId, data: date, ...(diaria ? { ignorar: diaria.id } : {}) })
      .then((h) => { if (vivo) setAvisoFrequencia(h.simulacao?.emRisco ? h.simulacao.motivos : []); })
      .catch(() => { if (vivo) setAvisoFrequencia([]); });
    return () => { vivo = false; };
  }, [foraId, date, lancadas.length, diaria]);

  const valorPadrao = duration === "MEIA" ? padrao.meia : padrao.inteira;
  const baseNum = paraNumero(base);
  // Editar mantendo valor e duração não pede motivo de novo, mesmo que o padrão
  // tenha mudado depois do lançamento (o servidor aplica a mesma regra).
  const mantida = diaria != null && diaria.duration === duration && Math.abs(baseNum - diaria.baseAmount) < 0.005;
  const ajustada = !mantida && Math.abs(baseNum - valorPadrao) >= 0.005;
  const total = Math.round((baseNum + paraNumero(transporte) + paraNumero(acrescimo) - paraNumero(desconto)) * 100) / 100;

  const setores = useMemo(
    () => Array.from(new Set([...SETORES_BASE, ...pessoas.casa.map((p) => p.setor ?? "").filter(Boolean)])).sort(),
    [pessoas.casa]
  );

  const filtro = normaliza(busca.trim());
  const combina = (nome: string, apelido: string | null) => !filtro || normaliza(`${nome} ${apelido ?? ""}`).includes(filtro);
  // Desligados no fim: continuam escolhíveis (ex-funcionário que volta como extra), mas não atrapalham.
  const casaLista = pessoas.casa.filter((p) => combina(p.nome, p.apelido)).sort((a, b) => Number(b.ativo) - Number(a.ativo));
  const foraLista = pessoas.fora.filter((p) => p.ativo && combina(p.nome, p.apelido));

  const escolhidaInfo = escolhida
    ? escolhida.tipo === "CASA"
      ? pessoas.casa.find((p) => p.id === escolhida.id)
      : pessoas.fora.find((p) => p.id === escolhida.id)
    : undefined;

  function escolher(p: PessoaEscolhida) {
    setEscolhida(p);
    setBusca("");
    if (p.tipo === "CASA") {
      const info = pessoas.casa.find((c) => c.id === p.id);
      if (info?.setor && !sector) setSector(info.setor);
      if (info?.cargo && !role) setRole(info.cargo);
      if (covered === p.id) setCovered("");
    }
  }

  // Data futura sugere "Prevista" (o servidor recusa Realizada no futuro), enquanto
  // quem lança não escolheu a situação à mão.
  function trocarData(nova: string) {
    setDate(nova);
    if (!statusTocado) setStatus(nova > hojeIso() ? "PREVISTA" : "REALIZADA");
  }

  function trocarDuracao(d: ExtraDuracao) {
    setDuration(d);
    if (!baseEditada) setBase(moneyToMasked(d === "MEIA" ? padrao.meia : padrao.inteira));
  }

  async function aposCadastrarFora(id: string) {
    setNovaPessoa(null);
    const atualizadas = await onRecarregarPessoas();
    setPessoas(atualizadas);
    escolher({ tipo: "FORA", id });
  }

  // Noite de evento: vários extras com a mesma data, setor, função, horário e
  // motivo. Mantém esses campos e limpa só a pessoa e o que é individual.
  function prepararProxima(nome: string) {
    setLancadas((l) => [...l, nome]);
    setEscolhida(null);
    setBusca("");
    setCovered("");
    setTransporte("");
    setAcrescimo("");
    setDesconto("");
    setNotes("");
    setBaseEditada(false);
    setBaseMotivo("");
    setBase(moneyToMasked(duration === "MEIA" ? padrao.meia : padrao.inteira));
  }

  async function salvar(continuar = false) {
    if (!escolhida) return setErro("Escolha quem trabalhou.");
    if (!sector.trim()) return setErro("Informe o setor.");
    if (!reason) return setErro("Informe o motivo da diária.");
    if (ajustada && baseMotivo.trim().length < 3) return setErro(`O valor é diferente do padrão (${brl(valorPadrao)}): informe o motivo.`);
    if (total < 0) return setErro("O desconto não pode ser maior que a diária somada aos acréscimos.");
    setErro(null);
    setSalvando(true);
    const payload = {
      date,
      employeeId: escolhida.tipo === "CASA" ? escolhida.id : null,
      extraWorkerId: escolhida.tipo === "FORA" ? escolhida.id : null,
      sector: sector.trim(),
      role: role.trim() || null,
      startTime: startTime || null,
      endTime: endTime || null,
      duration,
      reason,
      eventName: MOTIVO_COBERTURA.has(reason) ? null : evento.trim() || null,
      coveredEmployeeId: MOTIVO_COBERTURA.has(reason) && covered ? covered : null,
      status,
      baseAmount: baseNum,
      baseAdjustReason: ajustada ? baseMotivo.trim() : null,
      transportAmount: paraNumero(transporte),
      bonusAmount: paraNumero(acrescimo),
      discountAmount: paraNumero(desconto),
      notes: notes.trim() || null,
    };
    try {
      if (diaria) await updateExtraDiaria(diaria.id, payload);
      else await createExtraDiaria(payload);
      if (continuar && !diaria) {
        prepararProxima(escolhidaInfo?.nome ?? "");
        onLancouOutra();
      } else {
        onSalvo();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar a diária.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Janela titulo={diaria ? "Editar diária" : "Lançar diária"} onFechar={onFechar} ocupado={salvando} confirmarDescarte={!diaria && escolhida != null}>
          {lancadas.length > 0 && (
            <Alert tone="success" className="extras-lancadas">
              {lancadas.length === 1 ? "1 diária lançada" : `${lancadas.length} diárias lançadas`} nesta sequência: {lancadas.join(", ")}. Escolha a próxima pessoa.
            </Alert>
          )}

          <FormField label="Quem trabalhou" required>
            {escolhidaInfo ? (
              <div className="extras-escolhida">
                <div>
                  <strong>{escolhidaInfo.nome}</strong>
                  <span className={`extras-origem${escolhida?.tipo === "FORA" ? " fora" : ""}`}>
                    {escolhida?.tipo === "CASA" ? "Equipe da casa" : "De fora"}
                  </span>
                  <div className="extras-sub">
                    {escolhidaInfo.tipo === "CASA"
                      ? [escolhidaInfo.setor, escolhidaInfo.cargo, escolhidaInfo.modalidade === "CLT" ? "CLT" : "Sem registro", escolhidaInfo.ativo ? null : "desligado"].filter(Boolean).join(" · ")
                      : [escolhidaInfo.apelido, escolhidaInfo.indicadoPor ? `indicação de ${escolhidaInfo.indicadoPor}` : null].filter(Boolean).join(" · ") || "Pessoa de fora"}
                  </div>
                </div>
                <Button variant="secondary" onClick={() => setEscolhida(null)}>Trocar</Button>
              </div>
            ) : (
              <div className="extras-busca">
                <TextField
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar pelo nome ou apelido"
                  aria-label="Buscar pessoa"
                  autoFocus
                  onKeyDown={(e) => {
                    // Enter escolhe quando a busca achou uma pessoa só.
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const unica = [...casaLista.map((p) => ({ tipo: "CASA" as const, id: p.id })), ...foraLista.map((p) => ({ tipo: "FORA" as const, id: p.id }))];
                    if (unica.length === 1) escolher(unica[0]);
                  }}
                />
                <div className="extras-lista-pessoas" role="listbox" aria-label="Pessoas">
                  <div className="grupo">Equipe da casa · do cadastro de Funcionários</div>
                  {casaLista.length === 0 && <div className="extras-sub" style={{ padding: "8px 12px" }}>Ninguém com esse nome.</div>}
                  {casaLista.map((p) => (
                    <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => escolher({ tipo: "CASA", id: p.id })}>
                      <span>
                        {p.nome}
                        {p.apelido && <span className="extras-sub"> · {p.apelido}</span>}
                      </span>
                      <span className="extras-sub">
                        {[p.setor, p.modalidade === "CLT" ? "CLT" : "Sem registro", p.ativo ? null : "desligado"].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  ))}
                  <div className="grupo">De fora · indicação</div>
                  {foraLista.map((p) => (
                    <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => escolher({ tipo: "FORA", id: p.id })}>
                      <span>
                        {p.nome}
                        {p.apelido && <span className="extras-sub"> · {p.apelido}</span>}
                      </span>
                      <span className="extras-sub">{p.indicadoPor ? `indicação de ${p.indicadoPor}` : ""}</span>
                    </button>
                  ))}
                </div>
                {podeCadastrarPessoa && (
                  <button type="button" className="extras-cadastrar-fora" onClick={() => setNovaPessoa(busca.trim())}>
                    + Cadastrar pessoa de fora{busca.trim() ? ` "${busca.trim()}"` : ""}
                  </button>
                )}
              </div>
            )}
          </FormField>

          <FormGrid cols={2}>
            <FormField label="Data" required>
              <TextField type="date" value={date} onChange={(e) => trocarData(e.target.value)} />
            </FormField>
            <FormField label="Situação">
              <Select
                value={status}
                onChange={(e) => { setStatus(e.target.value as ExtraStatus); setStatusTocado(true); }}
                options={Object.entries(STATUS_ROTULO).map(([value, label]) => ({ value, label }))}
              />
            </FormField>
          </FormGrid>
          {avisoFrequencia.length > 0 && (
            <Alert tone="warning" className="extras-aviso">
              Frequência alta contando esta diária: {avisoFrequencia.join(" · ")}. Diária frequente de quem é de fora pode caracterizar vínculo. Você pode salvar mesmo assim.
            </Alert>
          )}

          <FormField label="Diária">
            <div className="extras-duracao">
              <button type="button" aria-pressed={duration === "INTEIRA"} onClick={() => trocarDuracao("INTEIRA")}>
                Diária inteira <span className="extras-sub extras-duracao-valor">{brl(padrao.inteira)}</span>
              </button>
              <button type="button" aria-pressed={duration === "MEIA"} onClick={() => trocarDuracao("MEIA")}>
                Meia diária <span className="extras-sub extras-duracao-valor">{brl(padrao.meia)}</span>
              </button>
            </div>
          </FormField>

          <FormGrid cols={2}>
            <datalist id="extras-setores">{setores.map((s) => <option key={s} value={s} />)}</datalist>
            <FormField label="Setor" required>
              <TextField value={sector} onChange={(e) => setSector(e.target.value)} list="extras-setores" placeholder="Ex.: Salão" />
            </FormField>
            <FormField label="Função">
              <TextField value={role} onChange={(e) => setRole(e.target.value)} placeholder="Ex.: Garçom, auxiliar de cozinha" />
            </FormField>
            <FormField label="Entrada">
              <TextField type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </FormField>
            <FormField label="Saída">
              <TextField type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </FormField>
            <FormField label="Motivo" required>
              <Select
                value={reason}
                onChange={(e) => setReason(e.target.value as ExtraMotivo)}
                placeholder="Por que chamou extra?"
                options={MOTIVOS.map((m) => ({ value: m, label: MOTIVO_ROTULO[m] }))}
              />
            </FormField>
            {reason && MOTIVO_COBERTURA.has(reason) ? (
              <FormField label="Cobrindo quem" hint="Opcional. Mostra quanto cada ausência custou.">
                <Select
                  value={covered}
                  onChange={(e) => setCovered(e.target.value)}
                  placeholder="Escolha o funcionário"
                  options={pessoas.casa
                    .filter((p) => p.ativo && !(escolhida?.tipo === "CASA" && escolhida.id === p.id))
                    .map((p) => ({ value: p.id, label: p.apelido ? `${p.nome} (${p.apelido})` : p.nome }))}
                />
              </FormField>
            ) : (
              <FormField label="Evento" hint={reason === "EVENTO" ? "Mostra quanto cada evento custou." : "Opcional."}>
                <TextField value={evento} onChange={(e) => setEvento(e.target.value)} list="extras-eventos" placeholder="Ex.: Apraxia" autoComplete="off" />
                <datalist id="extras-eventos">
                  {eventosUsados.map((ev) => <option key={ev.nome} value={ev.nome} />)}
                </datalist>
              </FormField>
            )}
          </FormGrid>

          <FormGrid cols={4}>
            <FormField label="Valor da diária">
              <TextField
                value={base}
                inputMode="numeric"
                onChange={(e) => { setBase(maskMoney(e.target.value)); setBaseEditada(true); }}
              />
            </FormField>
            <FormField label="Transporte">
              <TextField value={transporte} inputMode="numeric" placeholder="0,00" onChange={(e) => setTransporte(maskMoney(e.target.value))} />
            </FormField>
            <FormField label="Acréscimo">
              <TextField value={acrescimo} inputMode="numeric" placeholder="0,00" onChange={(e) => setAcrescimo(maskMoney(e.target.value))} />
            </FormField>
            <FormField label="Desconto">
              <TextField value={desconto} inputMode="numeric" placeholder="0,00" onChange={(e) => setDesconto(maskMoney(e.target.value))} />
            </FormField>
          </FormGrid>
          {ajustada && (
            <FormField label={`Motivo do valor diferente do padrão (${brl(valorPadrao)})`} required>
              <TextField value={baseMotivo} onChange={(e) => setBaseMotivo(e.target.value)} placeholder="Ex.: fechou a casa, dobrou o turno" />
            </FormField>
          )}

          <FormField label="Observação">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </FormField>

          <div className="extras-total" style={{ marginTop: 12 }}>
            <span>Total a pagar</span>
            <strong>{brl(Math.max(total, 0))}</strong>
          </div>

          {erro && <div style={{ marginTop: 12 }}><Alert tone="error">{erro}</Alert></div>}
          <div className="extras-acoes">
            <Button variant="secondary" onClick={onFechar} disabled={salvando}>{lancadas.length ? "Concluir" : "Cancelar"}</Button>
            {!diaria && <Button variant="secondary" onClick={() => void salvar(true)} disabled={salvando}>Lançar e continuar</Button>}
            <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : diaria ? "Salvar alterações" : "Lançar diária"}</Button>
          </div>
      </Janela>

      {novaPessoa !== null && (
        <PessoaForaModal
          pessoa={null}
          podeVerDados={pessoas.podeVerDados}
          nomeInicial={novaPessoa}
          onFechar={() => setNovaPessoa(null)}
          onSalvo={(id) => void aposCadastrarFora(id)}
        />
      )}
    </>
  );
}
