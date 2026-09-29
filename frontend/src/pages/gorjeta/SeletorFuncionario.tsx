// Escolha do funcionário por busca: digita parte do nome (ou da função), setas
// e Enter. Mostra função, empresa e quanto ainda tem de gorjeta líquida.
// Os usados por último aparecem primeiro.
import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { money } from "./gorjetaUtils";

export type PessoaSelecionavel = {
  participantId: string;
  nome: string;
  funcao: string | null;
  empresa: string | null;
  semRegistro: boolean;
  liquida: number;
};

type Props = {
  pessoas: PessoaSelecionavel[];
  valor: string;
  onEscolher: (participantId: string) => void;
  autoFoco?: boolean;
};

const CHAVE_RECENTES = "gorjeta-vales-recentes";
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function lerRecentes(): string[] {
  try { return JSON.parse(window.localStorage.getItem(CHAVE_RECENTES) ?? "[]") as string[]; } catch { return []; }
}
function gravarRecente(id: string) {
  try { window.localStorage.setItem(CHAVE_RECENTES, JSON.stringify([id, ...lerRecentes().filter((x) => x !== id)].slice(0, 6))); } catch { /* só não lembra */ }
}

export function SeletorFuncionario({ pessoas, valor, onEscolher, autoFoco }: Props) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  // Foco automático ao abrir a aba não abre a lista: ela abre ao digitar, clicar ou seta para baixo.
  const focoAutomatico = useRef(Boolean(autoFoco));
  const idLista = useId();
  const escolhida = pessoas.find((p) => p.participantId === valor) ?? null;

  const lista = useMemo(() => {
    const termo = semAcento(busca.trim());
    // Várias palavras, em qualquer ordem: "ana ros" acha "Maria Rosana".
    const palavras = termo.split(/\s+/).filter(Boolean);
    const recentes = lerRecentes();
    const filtradas = pessoas.filter((p) => {
      const texto = semAcento(`${p.nome} ${p.funcao ?? ""}`);
      return palavras.every((w) => texto.includes(w));
    });
    const posicao = (p: PessoaSelecionavel) => { const i = recentes.indexOf(p.participantId); return i < 0 ? 99 : i; };
    return termo ? filtradas : [...filtradas].sort((a, b) => posicao(a) - posicao(b) || a.nome.localeCompare(b.nome, "pt-BR"));
    // Recalcula ao abrir, para os recentes subirem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoas, busca, aberto]);
  const recentes = lerRecentes();

  function escolher(p: PessoaSelecionavel) {
    gravarRecente(p.participantId);
    onEscolher(p.participantId);
    setBusca("");
    setAberto(false);
  }

  function tecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAberto(true); setAtivo((i) => Math.min(i + 1, lista.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && aberto && lista[ativo]) { e.preventDefault(); escolher(lista[ativo]); }
    else if (e.key === "Escape") { setAberto(false); setBusca(""); }
  }

  return (
    <div className="seletor-funcionario">
      <div className={`seletor-funcionario-campo${escolhida && !aberto ? " tem-escolha" : ""}`}>
        <Search size={14} aria-hidden />
        <input
          ref={entrada}
          autoFocus={autoFoco}
          role="combobox"
          aria-expanded={aberto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-label="Funcionário"
          value={aberto ? busca : escolhida?.nome ?? busca}
          placeholder="Digite o nome ou a função…"
          onFocus={() => { if (focoAutomatico.current) { focoAutomatico.current = false; return; } setAberto(true); setAtivo(0); }}
          onClick={() => setAberto(true)}
          onBlur={() => window.setTimeout(() => setAberto(false), 220)}
          onChange={(e) => { setBusca(e.target.value); setAberto(true); setAtivo(0); }}
          onKeyDown={tecla}
        />
        {escolhida && !aberto && (
          <button type="button" className="seletor-funcionario-limpar" aria-label="Trocar funcionário"
            onClick={() => { onEscolher(""); setBusca(""); entrada.current?.focus(); }}><X size={13} /></button>
        )}
      </div>
      {escolhida && !aberto && (
        <span className="seletor-funcionario-resumo">
          {[escolhida.funcao, escolhida.semRegistro ? "sem registro" : escolhida.empresa].filter(Boolean).join(" · ")}
          {" · "}<strong style={{ color: escolhida.liquida <= 0 ? "var(--danger)" : undefined }}>{money(escolhida.liquida)}</strong> de gorjeta líquida
        </span>
      )}
      {aberto && (
        <ul id={idLista} role="listbox" className="seletor-funcionario-lista">
          {lista.length === 0 && <li className="seletor-funcionario-vazio">Ninguém com esse nome na apuração.</li>}
          {lista.map((p, i) => (
            <li key={p.participantId} role="option" aria-selected={i === ativo}
              className={i === ativo ? "ativo" : undefined}
              onMouseDown={(e) => { e.preventDefault(); escolher(p); }}
              onMouseEnter={() => setAtivo(i)}>
              <span className="seletor-funcionario-nome">
                {p.nome}
                {!busca && recentes.includes(p.participantId) && <em>recente</em>}
              </span>
              <span className="seletor-funcionario-info">
                {[p.funcao, p.semRegistro ? "sem registro" : p.empresa].filter(Boolean).join(" · ") || "—"}
              </span>
              <span className="seletor-funcionario-valor" style={{ color: p.liquida <= 0 ? "var(--danger)" : undefined }}>{money(p.liquida)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
