// Lançar vale: funcionário por busca, tipo em botões, descrição com sugestões
// prontas, e a conta de quanto a pessoa fica de gorjeta líquida depois.
import { Plus, Printer, Settings2 } from "lucide-react";
import { useState } from "react";
import type { TipValeDescricao, TipValeType } from "../../api/client";
import { Button } from "../../design-system";
import { DescricoesVale } from "./DescricoesVale";
import { VALE_LABELS, hojeLocal, money } from "./gorjetaUtils";
import { type PessoaSelecionavel, SeletorFuncionario } from "./SeletorFuncionario";

export type NovoVale = { participantId: string; type: TipValeType; amount: number; date: string; notes: string; imprimir: boolean };

type Props = {
  pessoas: PessoaSelecionavel[];
  descricoes: TipValeDescricao[];
  pessoaInicial: string;
  ocupado: boolean;
  onLancar: (v: NovoVale) => Promise<boolean>;
  onDescricoesMudaram: () => void;
  onErro: (e: unknown) => void;
};

const TIPOS: TipValeType[] = ["ADIANTAMENTO", "REFEICAO", "VALE_CONSUMO", "RETIRADA_CAIXA", "OUTRO", "CREDITO"];
const CHAVE_IMPRIMIR = "gorjeta-vales-imprimir";
const lerImprimir = () => { try { return window.localStorage.getItem(CHAVE_IMPRIMIR) === "sim"; } catch { return false; } };

export function FormLancarVale({ pessoas, descricoes, pessoaInicial, ocupado, onLancar, onDescricoesMudaram, onErro }: Props) {
  const [participantId, setParticipantId] = useState(pessoaInicial);
  const [type, setType] = useState<TipValeType>("ADIANTAMENTO");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(hojeLocal());
  const [notes, setNotes] = useState("");
  const [imprimir, setImprimirState] = useState(lerImprimir);
  const [gerenciar, setGerenciar] = useState(false);
  const setImprimir = (v: boolean) => { setImprimirState(v); try { window.localStorage.setItem(CHAVE_IMPRIMIR, v ? "sim" : "nao"); } catch { /* só não lembra */ } };

  const valor = Number(amount.replace(",", "."));
  const pessoa = pessoas.find((p) => p.participantId === participantId) ?? null;
  const depois = pessoa && valor > 0 ? pessoa.liquida + (type === "CREDITO" ? valor : -valor) : null;
  const termo = notes.trim().toLowerCase();
  const doTipo = descricoes.filter((d) => d.ativo && (d.tipo === type || d.tipo === null));
  // Escolhida uma sugestão, as outras continuam à vista; digitando outra coisa, filtra.
  const escolhida = doTipo.some((d) => d.texto.toLowerCase() === termo);
  const sugestoes = doTipo
    .filter((d) => !termo || escolhida || d.texto.toLowerCase().includes(termo))
    .slice(0, 8);
  const pronto = Boolean(participantId) && valor > 0;

  async function enviar() {
    if (!pronto) return;
    const ok = await onLancar({ participantId, type, amount: valor, date, notes: notes.trim(), imprimir: imprimir && type !== "CREDITO" });
    // Pessoa e tipo ficam: lançar vários seguidos é o caso comum.
    if (ok) { setAmount(""); setNotes(""); }
  }

  // O cadastro de descrições fica fora do formulário: formulário dentro de formulário
  // não existe em HTML (o botão dele enviaria o de fora e recarregaria a página).
  return (
    <div className="lancar-vale-bloco">
    <form className="lancar-vale" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      <div className="cabecalho-painel">
        <div className="cabecalho-painel-texto">
          <strong>Lançar vale</strong>
          <span>Depois de lançar, o funcionário e o tipo continuam escolhidos para o próximo.</span>
        </div>
        <button type="button" className="barra-lista-link" onClick={() => setGerenciar((g) => !g)} aria-expanded={gerenciar}>
          <Settings2 size={13} /> Descrições prontas
        </button>
      </div>

      <div className="lancar-vale-grade">
        <label className="lancar-vale-rotulo lancar-vale-pessoa">
          <span>Funcionário</span>
          <SeletorFuncionario pessoas={pessoas} valor={participantId} onEscolher={setParticipantId} autoFoco={!pessoaInicial} />
        </label>

        <div className="lancar-vale-rotulo lancar-vale-tipo">
          <span>Tipo</span>
          <div className="lancar-vale-tipos" role="radiogroup" aria-label="Tipo do vale">
            {TIPOS.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} className={t === "CREDITO" ? "credito" : undefined}
                onClick={() => setType(t)}>{VALE_LABELS[t].replace(" (soma)", "")}</button>
            ))}
          </div>
        </div>

        <label className="lancar-vale-rotulo">
          <span>Valor (R$)</span>
          <input type="number" step="0.01" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required />
        </label>
        <label className="lancar-vale-rotulo">
          <span>Data</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="lancar-vale-rotulo lancar-vale-descricao">
          <span>Descrição</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Escolha uma sugestão ou escreva" maxLength={300} />
        </label>
      </div>

      {sugestoes.length > 0 && (
        <div className="lancar-vale-sugestoes" aria-label="Descrições prontas">
          {sugestoes.map((d) => (
            <button key={d.id} type="button" aria-pressed={notes === d.texto} onClick={() => setNotes(d.texto)}>{d.texto}</button>
          ))}
        </div>
      )}

      <div className="lancar-vale-rodape">
        <span className="lancar-vale-conta" aria-live="polite">
          {pessoa ? (
            <>
              {pessoa.nome.split(" ")[0]}: gorjeta líquida {money(pessoa.liquida)}
              {depois != null && <> → <strong style={{ color: depois < 0 ? "var(--danger)" : undefined }}>{money(depois)}</strong> depois deste vale</>}
              {depois != null && depois < 0 && <em> · passa da gorjeta</em>}
            </>
          ) : "Escolha o funcionário."}
        </span>
        <label className="barra-lista-campo" title="Abre o recibo para imprimir logo depois de lançar">
          <input type="checkbox" checked={imprimir} disabled={type === "CREDITO"} onChange={(e) => setImprimir(e.target.checked)} />
          <Printer size={13} /> Imprimir recibo ao lançar
        </label>
        <Button type="submit" size="sm" leadingIcon={<Plus size={14} />} disabled={ocupado || !pronto}>Lançar vale</Button>
      </div>
    </form>
    {gerenciar && (
      <DescricoesVale descricoes={descricoes} tipoAtual={type} onMudou={onDescricoesMudaram} onFechar={() => setGerenciar(false)} onErro={onErro} />
    )}
    </div>
  );
}
