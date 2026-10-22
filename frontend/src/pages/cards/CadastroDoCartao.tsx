import { useEffect, useState } from "react";
import { History, Plus, Trash2 } from "lucide-react";
import { getCardHistory, saveCard, type CardHistoryEntry, type CreditCard } from "../../api/client";
import { Button, FormField, StatusBadge } from "../../design-system";
import { Dialog } from "../../components/ui/Dialog";
import {
  errosDoFormulario,
  formDoCartao,
  melhorDiaDeCompra,
  paraPayload,
  type FormDoCartao,
  type VirtualDoForm
} from "./cadastro-do-cartao";
import "./cadastro-do-cartao.css";

type Props = {
  /** undefined = cartão novo. */
  cartao?: CreditCard;
  onFechar: () => void;
  onSalvo: (cartao: CreditCard, novo: boolean) => void;
};

const formatarDataEHora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

let sequencia = 0;
const novaChave = () => `novo-${++sequencia}`;

export function CadastroDoCartao({ cartao, onFechar, onSalvo }: Props) {
  const [form, setForm] = useState<FormDoCartao>(() => formDoCartao(cartao));
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroDoServidor, setErroDoServidor] = useState("");
  const [historico, setHistorico] = useState<CardHistoryEntry[] | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const erros = errosDoFormulario(form);
  const mostrar = (campo: string) => (tentou ? erros[campo] : undefined);
  const fechamento = Number(form.closingDay);
  const vencimento = Number(form.dueDay);
  const datasPreenchidas = Number.isInteger(fechamento) && fechamento >= 1 && fechamento <= 31 && Number.isInteger(vencimento) && vencimento >= 1 && vencimento <= 31;

  useEffect(() => {
    if (!cartao || !historicoAberto || historico) return;
    getCardHistory(cartao.id).then(setHistorico).catch(() => setHistorico([]));
  }, [cartao, historicoAberto, historico]);

  function atualizarVirtual(chave: string, mudanca: Partial<VirtualDoForm>) {
    setForm((atual) => ({
      ...atual,
      virtuais: atual.virtuais.map((virtual) => (virtual.key === chave ? { ...virtual, ...mudanca } : virtual))
    }));
  }

  async function salvar() {
    setTentou(true);
    setErroDoServidor("");
    if (Object.keys(erros).length > 0) return;
    setSalvando(true);
    try {
      const salvo = await saveCard(paraPayload(form));
      onSalvo(salvo, !cartao);
    } catch (error) {
      setErroDoServidor(error instanceof Error ? error.message : "Não foi possível salvar o cartão.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(aberto) => { if (!aberto) onFechar(); }}
      title={cartao ? "Editar cartão" : "Novo cartão"}
      description="A fatura do banco é uma só. Cadastre o cartão físico e, se houver, os cartões virtuais vinculados a ele."
      size="lg"
    >
      <div className="cadastro-cartao">
        <section className="cadastro-cartao-secao" aria-labelledby="cc-identificacao">
          <h3 id="cc-identificacao"><span>1</span> Identificação</h3>
          <div className="cadastro-cartao-grade">
            <FormField label="Nome do cartão" required error={mostrar("name")}>
              <input value={form.name} placeholder="Ex.: Cartão Sicredi" onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </FormField>
            <FormField label="Banco" required error={mostrar("bankName")}>
              <input value={form.bankName} placeholder="Ex.: Sicredi" onChange={(event) => setForm({ ...form, bankName: event.target.value })} />
            </FormField>
          </div>
        </section>

        <section className="cadastro-cartao-secao" aria-labelledby="cc-fatura">
          <h3 id="cc-fatura"><span>2</span> Fatura</h3>
          <div className="cadastro-cartao-grade">
            <FormField label="Dia de fechamento" required hint="Compras feitas até este dia entram na fatura do mês." error={mostrar("closingDay")}>
              <input type="number" min={1} max={31} inputMode="numeric" value={form.closingDay} onChange={(event) => setForm({ ...form, closingDay: event.target.value })} />
            </FormField>
            <FormField label="Dia de vencimento" required hint="Dia em que a fatura é paga, no mês seguinte ao fechamento." error={mostrar("dueDay")}>
              <input type="number" min={1} max={31} inputMode="numeric" value={form.dueDay} onChange={(event) => setForm({ ...form, dueDay: event.target.value })} />
            </FormField>
          </div>
          {datasPreenchidas && (
            <p className="cadastro-cartao-explica" role="note">
              Melhor dia de compra: <strong>dia {melhorDiaDeCompra(fechamento)}</strong>. A fatura fecha no dia {fechamento} e vence no dia {vencimento}.
            </p>
          )}
        </section>

        <section className="cadastro-cartao-secao" aria-labelledby="cc-cartoes">
          <h3 id="cc-cartoes"><span>3</span> Cartões desta conta</h3>
          <FormField label="Cartão físico — 4 últimos dígitos" required error={mostrar("fisico")}>
            <input
              className="cadastro-cartao-final"
              value={form.fisico.last4Digits}
              inputMode="numeric"
              maxLength={4}
              placeholder="0000"
              onChange={(event) => setForm({ ...form, fisico: { ...form.fisico, last4Digits: event.target.value.replace(/\D/g, "") } })}
            />
          </FormField>

          <div className="cadastro-cartao-virtuais">
            <div className="cadastro-cartao-virtuais-topo">
              <strong>Cartões virtuais vinculados</strong>
              <span>Compras online, carteiras digitais ou cartões gerados no app</span>
            </div>
            {form.virtuais.length === 0 && <p className="cadastro-cartao-vazio">Nenhum cartão virtual cadastrado.</p>}
            {form.virtuais.map((virtual) => (
              <div key={virtual.key} className={`cadastro-cartao-virtual${virtual.isActive ? "" : " inativo"}`}>
                <FormField label="Apelido (opcional)">
                  <input value={virtual.label} placeholder="Ex.: Compras online" disabled={!virtual.isActive} onChange={(event) => atualizarVirtual(virtual.key, { label: event.target.value })} />
                </FormField>
                <FormField label="4 últimos dígitos">
                  <input
                    className="cadastro-cartao-final"
                    value={virtual.last4Digits}
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="0000"
                    disabled={!virtual.isActive}
                    onChange={(event) => atualizarVirtual(virtual.key, { last4Digits: event.target.value.replace(/\D/g, "") })}
                  />
                </FormField>
                <div className="cadastro-cartao-virtual-acao">
                  {virtual.id ? (
                    <>
                      {!virtual.isActive && <StatusBadge tone="neutral">Inativo</StatusBadge>}
                      <Button variant="secondary" size="sm" onClick={() => atualizarVirtual(virtual.key, { isActive: !virtual.isActive })}>
                        {virtual.isActive ? "Inativar" : "Reativar"}
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" size="sm" leadingIcon={<Trash2 size={14} />} onClick={() => setForm({ ...form, virtuais: form.virtuais.filter((item) => item.key !== virtual.key) })}>
                      Remover
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {mostrar("virtuais") && <p className="cadastro-cartao-erro" role="alert">{erros.virtuais}</p>}
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus size={14} />}
              onClick={() => setForm({ ...form, virtuais: [...form.virtuais, { key: novaChave(), label: "", last4Digits: "", isActive: true }] })}
            >
              Adicionar cartão virtual
            </Button>
            {form.virtuais.some((virtual) => virtual.id) && (
              <p className="cadastro-cartao-dica">Cartão que já teve compras não é apagado: inative. Assim o histórico das faturas continua certo.</p>
            )}
          </div>
        </section>

        <section className="cadastro-cartao-secao" aria-labelledby="cc-extra">
          <h3 id="cc-extra"><span>4</span> Observações</h3>
          <FormField label="Observações (opcional)">
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </FormField>
          {cartao && (
            <label className="cadastro-cartao-ativo">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              Conta ativa para novas faturas
            </label>
          )}
        </section>

        {cartao && (
          <section className="cadastro-cartao-historico">
            <button type="button" aria-expanded={historicoAberto} onClick={() => setHistoricoAberto(!historicoAberto)}>
              <History size={15} /> Histórico de alterações
            </button>
            {historicoAberto && (
              historico === null ? <p className="cadastro-cartao-dica">Carregando…</p> : historico.length === 0 ? (
                <p className="cadastro-cartao-dica">Nenhuma alteração registrada ainda.</p>
              ) : (
                <ol>
                  {historico.map((registro) => (
                    <li key={registro.id}>
                      <time>{formatarDataEHora(registro.createdAt)}</time> <span>{registro.usuario}</span>
                      <ul>{registro.resumo.map((linha) => <li key={linha}>{linha}</li>)}</ul>
                    </li>
                  ))}
                </ol>
              )
            )}
          </section>
        )}

        {erroDoServidor && <p className="cadastro-cartao-erro" role="alert">{erroDoServidor}</p>}

        <div className="cadastro-cartao-rodape">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar cartão"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
