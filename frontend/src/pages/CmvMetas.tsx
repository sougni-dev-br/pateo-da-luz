// CMV → Metas de CMV: meta de CMV % (compras ÷ faturamento) por mês, geral e por setor.
// Mostra o realizado contra a meta, a projeção do fim do mês e quanto ainda dá para comprar sem estourar.
// Só lê compras, pedidos e faturamento que já existem; o cadastro das metas é a única escrita.
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type LinhaPainelMetaCmv, type ListaMetasCmv, type PainelMetasCmv, type StatusMetaCmv,
  getMetasCmv, getPainelMetasCmv, removerMetaCmv, salvarMetaCmv,
} from "../api/client";
import { Alert, Button, EmptyState, Money, Select, StatusBadge, Table, TextField } from "../design-system";
import type { StatusTone } from "../design-system";
import "./CmvMetas.css";

const mensagem = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`);
const mesAtual = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
const nomeDoMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
};
const decimal = (texto: string) => Number(texto.replace(",", "."));

const ROTULO: Record<StatusMetaCmv, string> = { VERDE: "Dentro da meta", AMARELO: "Em alerta", VERMELHO: "Acima da meta", SEM_DADOS: "Sem meta ou sem faturamento" };
const TOM: Record<StatusMetaCmv, StatusTone> = { VERDE: "success", AMARELO: "warning", VERMELHO: "danger", SEM_DADOS: "neutral" };

function Selo({ status }: { status: StatusMetaCmv }) {
  return <StatusBadge tone={TOM[status]}>{ROTULO[status]}</StatusBadge>;
}

function Barra({ linha }: { linha: LinhaPainelMetaCmv }) {
  if (!linha.meta || linha.realizadoPercentual == null) return null;
  const { alvoPercentual, alertaPercentual } = linha.meta;
  // A escala vai até 120% da meta, para o estouro continuar visível.
  const escala = alvoPercentual * 1.2;
  const largura = Math.min(100, (linha.realizadoPercentual / escala) * 100);
  return (
    <div className="mt-barra" role="img" aria-label={`Realizado ${pct(linha.realizadoPercentual)} para meta de ${pct(alvoPercentual)}`}>
      <div className={`mt-barra-cheia mt-${linha.status.toLowerCase()}`} style={{ width: `${largura}%` }} />
      <span className="mt-barra-marca" style={{ left: `${(alertaPercentual / escala) * 100}%` }} title={`Alerta ${pct(alertaPercentual)}`} />
      <span className="mt-barra-marca mt-barra-meta" style={{ left: `${(alvoPercentual / escala) * 100}%` }} title={`Meta ${pct(alvoPercentual)}`} />
    </div>
  );
}

function Margem({ linha }: { linha: LinhaPainelMetaCmv }) {
  const p = linha.projecao;
  if (!p || p.margemParaComprar == null) return <span className="mt-sub">—</span>;
  const estourou = p.margemParaComprar < 0;
  return (
    <span className={estourou ? "mt-estouro" : undefined}>
      {estourou ? "Estourou em " : "Ainda dá para comprar "}
      <Money value={Math.abs(p.margemParaComprar)} />
    </span>
  );
}

type FormMeta = { escopo: "GERAL" | "SETOR"; sectorId: string; alvo: string; alerta: string; inicio: string; observacao: string };
const FORM_VAZIO = (inicio: string): FormMeta => ({ escopo: "GERAL", sectorId: "", alvo: "", alerta: "", inicio, observacao: "" });

export function CmvMetas() {
  const [mes, setMes] = useState(mesAtual());
  const [painel, setPainel] = useState<PainelMetasCmv | null>(null);
  const [cadastro, setCadastro] = useState<ListaMetasCmv | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState<FormMeta | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    setCarregando(true);
    try {
      const [p, c] = await Promise.all([getPainelMetasCmv(mes), getMetasCmv()]);
      setPainel(p);
      setCadastro(c);
    } catch (e) {
      setErro(mensagem(e, "Não foi possível carregar as metas."));
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => { void carregar(); }, [carregar]);

  const geral = painel?.linhas.find((l) => l.escopo === "GERAL") ?? null;
  const opcoesSetor = useMemo(() => (cadastro?.setores ?? []).map((s) => ({ value: s.id, label: s.name })), [cadastro]);

  async function salvar() {
    if (!form) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarMetaCmv({
        escopo: form.escopo,
        sectorId: form.escopo === "SETOR" ? form.sectorId || null : null,
        alvoPercentual: decimal(form.alvo),
        alertaPercentual: decimal(form.alerta),
        inicio: form.inicio,
        observacao: form.observacao.trim() || null,
      });
      setForm(null);
      await carregar();
      setAviso("Meta salva.");
    } catch (e) {
      setErro(mensagem(e, "Não foi possível salvar a meta."));
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    if (!window.confirm("Remover esta vigência de meta? O histórico dos meses dela passa a aparecer como \"sem meta\".")) return;
    setErro(null);
    try {
      await removerMetaCmv(id);
      await carregar();
      setAviso("Vigência removida.");
    } catch (e) {
      setErro(mensagem(e, "Não foi possível remover a meta."));
    }
  }

  return (
    <section className="mt-tela">
      <header className="mt-topo">
        <div>
          <h2>Metas de CMV</h2>
          <p>Compras ÷ faturamento do mês, contra a meta. O CMV real só fecha na contagem do estoque; aqui você acompanha o caminho até lá.</p>
        </div>
        <div className="mt-topo-acoes">
          <TextField label="Mês" type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          <Button variant="secondary" onClick={() => void carregar()} disabled={carregando}><RefreshCw size={16} aria-hidden /> Atualizar</Button>
          <Button onClick={() => setForm(FORM_VAZIO(mes))}><Plus size={16} aria-hidden /> Nova meta</Button>
        </div>
      </header>

      {erro && <Alert tone="error">{erro}</Alert>}
      {aviso && <Alert tone="success" onClick={() => setAviso("")}>{aviso}</Alert>}

      {form && (
        <div className="mt-cartao" role="group" aria-label="Nova meta de CMV">
          <h3>Nova meta</h3>
          <p className="mt-ajuda">A meta vale a partir do mês escolhido. A que estava valendo termina na véspera, e o histórico dela se mantém.</p>
          <div className="mt-form">
            <Select label="Vale para" value={form.escopo} onChange={(e) => setForm({ ...form, escopo: e.target.value as "GERAL" | "SETOR", sectorId: "" })}
              options={[{ value: "GERAL", label: "Restaurante todo" }, { value: "SETOR", label: "Um setor do estoque" }]} />
            {form.escopo === "SETOR" && (
              <Select label="Setor" value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}
                options={[{ value: "", label: "Escolha…" }, ...opcoesSetor]} />
            )}
            <TextField label="A partir de" type="month" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
            <TextField label="Meta (%)" inputMode="decimal" placeholder="30" value={form.alvo} onChange={(e) => setForm({ ...form, alvo: e.target.value })} hint="Acima disso fica vermelho." />
            <TextField label="Alerta (%)" inputMode="decimal" placeholder="27" value={form.alerta} onChange={(e) => setForm({ ...form, alerta: e.target.value })} hint="Daqui até a meta fica amarelo." />
            <TextField label="Observação" value={form.observacao} maxLength={300} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
          </div>
          <div className="mt-acoes">
            <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar meta"}</Button>
            <Button variant="secondary" onClick={() => setForm(null)} disabled={salvando}>Cancelar</Button>
          </div>
        </div>
      )}

      {!painel && carregando && <p className="mt-ajuda">Carregando…</p>}

      {painel && geral && (
        <>
          <div className="mt-resumo">
            <div className={`mt-destaque mt-${geral.status.toLowerCase()}`}>
              <span className="mt-sub">Compras ÷ faturamento · {nomeDoMes(painel.mes)}{painel.mesCorrente ? ` · até ${painel.ateODia.split("-").reverse().join("/")}` : ""}</span>
              <strong>{pct(geral.realizadoPercentual)}</strong>
              <span>{geral.meta ? `Meta ${pct(geral.meta.alvoPercentual)} · alerta ${pct(geral.meta.alertaPercentual)}` : "Sem meta para este mês"}</span>
              <Selo status={geral.status} />
              <Barra linha={geral} />
            </div>
            <dl className="mt-numeros">
              <div><dt>Faturamento líquido</dt><dd><Money value={painel.faturamento} /></dd></div>
              <div><dt>Compras no mês</dt><dd><Money value={geral.compras} /></dd></div>
              <div><dt>Pedidos em andamento</dt><dd><Money value={geral.pedidosAbertos} /></dd></div>
              <div><dt>CMV real do ciclo</dt><dd>{painel.cmvRealCiclo ? `${pct(painel.cmvRealCiclo.percentual)} (${painel.cmvRealCiclo.status === "CLOSED" ? "fechado" : "em aberto"})` : "—"}</dd></div>
            </dl>
          </div>

          {geral.projecao && geral.projecao.margemParaComprar != null && (
            <Alert tone={geral.projecao.margemParaComprar < 0 ? "error" : "info"}>
              No ritmo atual o mês fecha com <Money value={geral.projecao.faturamentoProjetado} /> de faturamento. O teto de compras na meta é <Money value={geral.projecao.tetoDeCompras} />;
              {geral.projecao.margemParaComprar < 0
                ? <> já estourou em <Money value={Math.abs(geral.projecao.margemParaComprar)} /> contando os pedidos em andamento.</>
                : <> ainda dá para comprar <Money value={geral.projecao.margemParaComprar} /> contando os pedidos em andamento.</>}
            </Alert>
          )}

          <div className="mt-bloco">
            <h3>Por escopo</h3>
            <Table aria-label="Realizado contra a meta">
              <Table.Head>
                <Table.Row>
                  <Table.Th>Escopo</Table.Th>
                  <Table.Th align="right">Meta</Table.Th>
                  <Table.Th align="right">Realizado</Table.Th>
                  <Table.Th align="right">Compras</Table.Th>
                  <Table.Th>Situação</Table.Th>
                  <Table.Th>Margem para comprar</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {painel.linhas.map((l) => (
                  <Table.Row key={l.sectorId ?? "geral"}>
                    <Table.Td>{l.nome}</Table.Td>
                    <Table.Td align="right">{l.meta ? pct(l.meta.alvoPercentual) : "—"}</Table.Td>
                    <Table.Td align="right">{pct(l.realizadoPercentual)}</Table.Td>
                    <Table.Td align="right"><Money value={l.compras} /></Table.Td>
                    <Table.Td><Selo status={l.status} /></Table.Td>
                    <Table.Td><Margem linha={l} /></Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            <p className="mt-ajuda">Setores só aparecem quando têm meta ou compras no mês. O realizado do setor é a compra dele ÷ o faturamento do restaurante todo.</p>
          </div>

          <div className="mt-bloco">
            <h3>Últimos 6 meses (geral)</h3>
            <Table aria-label="Histórico de CMV contra a meta">
              <Table.Head>
                <Table.Row>
                  <Table.Th>Mês</Table.Th>
                  <Table.Th align="right">Faturamento</Table.Th>
                  <Table.Th align="right">Compras</Table.Th>
                  <Table.Th align="right">Realizado</Table.Th>
                  <Table.Th align="right">Meta</Table.Th>
                  <Table.Th>Situação</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {[...painel.historico].reverse().map((h) => (
                  <Table.Row key={h.mes}>
                    <Table.Td>{nomeDoMes(h.mes)}</Table.Td>
                    <Table.Td align="right"><Money value={h.faturamento} /></Table.Td>
                    <Table.Td align="right"><Money value={h.compras} /></Table.Td>
                    <Table.Td align="right">{pct(h.realizadoPercentual)}</Table.Td>
                    <Table.Td align="right">{pct(h.alvoPercentual)}</Table.Td>
                    <Table.Td><Selo status={h.status} /></Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        </>
      )}

      <div className="mt-bloco">
        <h3>Metas cadastradas</h3>
        {cadastro && cadastro.metas.length === 0 ? (
          <EmptyState title="Nenhuma meta cadastrada" description="Crie a meta geral do restaurante para o painel começar a classificar os meses." />
        ) : (
          cadastro && (
            <Table aria-label="Metas cadastradas">
              <Table.Head>
                <Table.Row>
                  <Table.Th>Escopo</Table.Th>
                  <Table.Th align="right">Meta</Table.Th>
                  <Table.Th align="right">Alerta</Table.Th>
                  <Table.Th>Vigência</Table.Th>
                  <Table.Th>Observação</Table.Th>
                  <Table.Th align="right"><span className="mt-sr">Ações</span></Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {cadastro.metas.map((m) => (
                  <Table.Row key={m.id}>
                    <Table.Td>{m.escopo === "GERAL" ? "Geral" : m.setorNome ?? "Setor removido"}</Table.Td>
                    <Table.Td align="right">{pct(m.alvoPercentual)}</Table.Td>
                    <Table.Td align="right">{pct(m.alertaPercentual)}</Table.Td>
                    <Table.Td>{m.vigenciaInicio.slice(0, 7).split("-").reverse().join("/")} até {m.vigenciaFim ? m.vigenciaFim.slice(0, 7).split("-").reverse().join("/") : "hoje"}</Table.Td>
                    <Table.Td>{m.observacao ?? ""}</Table.Td>
                    <Table.Td align="right">
                      <Button variant="secondary" size="sm" onClick={() => void remover(m.id)} aria-label={`Remover meta ${m.escopo === "GERAL" ? "geral" : m.setorNome ?? ""} de ${m.vigenciaInicio.slice(0, 7)}`}>
                        <Trash2 size={14} aria-hidden /> Remover
                      </Button>
                    </Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )
        )}
      </div>
    </section>
  );
}
