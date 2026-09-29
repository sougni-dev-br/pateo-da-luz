// Cadastro das descrições prontas dos vales (por tipo ou para todos os tipos).
// Desativar não apaga: some das sugestões e pode voltar depois.
import { Plus, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { type TipValeDescricao, type TipValeType, ativarTipValeDescricao, criarTipValeDescricao } from "../../api/client";
import { Button } from "../../design-system";
import { VALE_LABELS, mutedStyle } from "./gorjetaUtils";

type Props = {
  descricoes: TipValeDescricao[];
  tipoAtual: TipValeType;
  onMudou: () => void;
  onFechar: () => void;
  onErro: (e: unknown) => void;
};

const TIPOS: TipValeType[] = ["ADIANTAMENTO", "REFEICAO", "VALE_CONSUMO", "RETIRADA_CAIXA", "OUTRO", "CREDITO"];

export function DescricoesVale({ descricoes, tipoAtual, onMudou, onFechar, onErro }: Props) {
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState<TipValeType | "">(tipoAtual);
  const [ocupado, setOcupado] = useState(false);

  async function executar(acao: () => Promise<unknown>) {
    setOcupado(true);
    try { await acao(); onMudou(); } catch (e) { onErro(e); } finally { setOcupado(false); }
  }

  const grupos: Array<[TipValeType | null, TipValeDescricao[]]> = [
    ...TIPOS.map((t) => [t, descricoes.filter((d) => d.tipo === t)] as [TipValeType, TipValeDescricao[]]),
    [null, descricoes.filter((d) => d.tipo === null)],
  ];

  return (
    <div className="descricoes-vale" role="region" aria-label="Descrições prontas">
      <div className="cabecalho-painel">
        <div className="cabecalho-painel-texto">
          <strong>Descrições prontas</strong>
          <span>Aparecem como sugestão ao lançar um vale do mesmo tipo. Desativar tira da sugestão sem apagar.</span>
        </div>
        <button type="button" className="botao-desfazer" aria-label="Fechar descrições prontas" onClick={onFechar}><X size={15} /></button>
      </div>
      <form className="descricoes-vale-nova" onSubmit={(e) => {
        e.preventDefault();
        void executar(() => criarTipValeDescricao(texto.trim(), tipo || null)).then(() => setTexto(""));
      }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nova descrição (ex.: Adiantamento para transporte)" maxLength={120} aria-label="Nova descrição" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipValeType | "")} aria-label="Tipo da descrição">
          {TIPOS.map((t) => <option key={t} value={t}>{VALE_LABELS[t]}</option>)}
          <option value="">Todos os tipos</option>
        </select>
        <Button type="submit" size="sm" leadingIcon={<Plus size={14} />} disabled={ocupado || texto.trim().length < 3}>Cadastrar</Button>
      </form>
      <div className="descricoes-vale-grupos">
        {grupos.filter(([, lista]) => lista.length > 0).map(([t, lista]) => (
          <div key={t ?? "todos"}>
            <span style={{ ...mutedStyle, fontWeight: 600 }}>{t ? VALE_LABELS[t] : "Todos os tipos"}</span>
            <ul>
              {lista.map((d) => (
                <li key={d.id} className={d.ativo ? undefined : "inativa"}>
                  <span>{d.texto}</span>
                  <button type="button" className="botao-desfazer" disabled={ocupado}
                    aria-label={d.ativo ? `Desativar ${d.texto}` : `Reativar ${d.texto}`} title={d.ativo ? "Desativar" : "Reativar"}
                    onClick={() => void executar(() => ativarTipValeDescricao(d.id, !d.ativo))}>
                    {d.ativo ? <X size={13} /> : <RotateCcw size={13} />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
