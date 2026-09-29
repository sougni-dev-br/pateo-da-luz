import { ChevronLeft, ChevronRight, LayoutGrid, Lightbulb, List, PartyPopper, Printer, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EmployeeBirthday, getEmployeeBirthdays } from "../../api/client";
import { Alert, Button, FormField, PanelEyebrow, Switch, TextField, Textarea } from "../../design-system";
import { A4_MM, FolhaAniversariantes, ModeloFolha, OpcoesFolha, Orientacao, nomeParaExibir } from "./FolhaAniversariantes";
import {
  FORMAS_NOME, MENSAGENS_SUGERIDAS, MESES, MODELOS, ORIENTACOES, PALETAS, TAMANHOS, lerPreferencias, salvarPreferencias
} from "./opcoesImpressao";
import "./ImpressaoAniversariantes.css";

const MM_EM_PX = 96 / 25.4;
const PADDING_PREVIA_PX = 40;
const ALTURA_RESERVADA_PX = 300; // topo, legenda e rodapé do modal
const CLASSE_IMPRIMINDO = "imprimindo-aniversariantes";
const ICONE_MODELO: Record<ModeloFolha, LucideIcon> = { CARTAZ: PartyPopper, CARTOES: LayoutGrid, LISTA: List };

type Props = { mesInicial: number; onClose: () => void };

export function ImpressaoAniversariantes({ mesInicial, onClose }: Props) {
  const [mes, setMes] = useState(mesInicial);
  const [pessoas, setPessoas] = useState<EmployeeBirthday[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [opcoes, setOpcoes] = useState<OpcoesFolha>(lerPreferencias);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    setExcluidos(new Set());
    getEmployeeBirthdays(mes)
      .then((rows) => { if (ativo) setPessoas(rows); })
      .catch((err) => {
        if (!ativo) return;
        setPessoas([]);
        setErro(err instanceof Error ? err.message : "Não foi possível carregar os aniversariantes.");
      })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [mes]);

  useEffect(() => { salvarPreferencias(opcoes); }, [opcoes]);

  const fecharRef = useRef(onClose);
  fecharRef.current = onClose;
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") fecharRef.current(); };
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      // Garante que a página volta ao normal se o modal fechar no meio de uma impressão.
      document.body.classList.remove(CLASSE_IMPRIMINDO);
    };
  }, []);

  const selecionados = pessoas.filter((p) => !excluidos.has(p.id));
  const nomeMes = MESES[mes - 1];

  function alterar<K extends keyof OpcoesFolha>(campo: K, valor: OpcoesFolha[K]) {
    setOpcoes((atual) => ({ ...atual, [campo]: valor }));
  }

  function mudarMes(delta: number) {
    setMes((atual) => ((atual - 1 + delta + 12) % 12) + 1);
  }

  function alternarPessoa(id: string) {
    setExcluidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }

  function imprimir() {
    const estiloPagina = document.createElement("style");
    estiloPagina.textContent = `@page { size: A4 ${opcoes.orientacao}; margin: 0; }`;
    document.head.appendChild(estiloPagina);
    document.body.classList.add(CLASSE_IMPRIMINDO);
    const limpar = () => {
      document.body.classList.remove(CLASSE_IMPRIMINDO);
      estiloPagina.remove();
      window.removeEventListener("afterprint", limpar);
    };
    window.addEventListener("afterprint", limpar);
    window.print();
  }

  const folha = <FolhaAniversariantes pessoas={selecionados} opcoes={opcoes} nomeMes={nomeMes} />;
  const resumo = carregando
    ? "Carregando…"
    : pessoas.length === 0
      ? `Nenhum funcionário ativo faz aniversário em ${nomeMes}.`
      : `${pessoas.length} ${pessoas.length === 1 ? "aniversariante ativo" : "aniversariantes ativos"} em ${nomeMes}`;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="panel modal-panel aniv-modal" role="dialog" aria-modal="true" aria-labelledby="aniv-titulo-modal">
        <header className="aniv-topo">
          <div>
            <PanelEyebrow>Mural de aniversariantes</PanelEyebrow>
            <h2 id="aniv-titulo-modal">Imprimir para o mural</h2>
            <p className="aniv-topo-sub">{resumo}</p>
          </div>
          <div className="aniv-topo-acoes">
            <div className="aniv-mes" role="group" aria-label="Mês">
              <button type="button" onClick={() => mudarMes(-1)} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
              <span className="aniv-mes-nome" aria-live="polite">{nomeMes}</span>
              <button type="button" onClick={() => mudarMes(1)} aria-label="Próximo mês"><ChevronRight size={18} /></button>
            </div>
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
          </div>
        </header>

        <div className="aniv-modal-corpo">
          <div className="aniv-opcoes">
            <section className="aniv-secao">
              <h3 className="aniv-secao-titulo">Modelo</h3>
              <div className="aniv-modelos">
                {MODELOS.map((m) => {
                  const Icone = ICONE_MODELO[m.value];
                  return (
                    <button key={m.value} type="button" className="aniv-modelo" aria-pressed={opcoes.modelo === m.value}
                      onClick={() => alterar("modelo", m.value)}>
                      <Icone size={20} aria-hidden="true" />
                      <strong>{m.label}</strong>
                      <span>{m.dica}</span>
                    </button>
                  );
                })}
              </div>
              <div className="aniv-linha">
                <span className="aniv-rotulo">Papel A4</span>
                <Segmentado rotulo="Papel" opcoes={ORIENTACOES} valor={opcoes.orientacao} aoMudar={(v) => alterar("orientacao", v)} />
              </div>
            </section>

            <section className="aniv-secao">
              <h3 className="aniv-secao-titulo">Cores</h3>
              <div className="aniv-cores">
                {PALETAS.map((p) => (
                  <button key={p.value} type="button" title={p.label} aria-label={p.label}
                    className={`aniv-cor${p.value === "PB" ? " aniv-cor--pb" : ""}`} style={{ background: p.amostra }}
                    aria-pressed={opcoes.paleta === p.value} onClick={() => alterar("paleta", p.value)} />
                ))}
                <span className="aniv-cor-nome">{PALETAS.find((p) => p.value === opcoes.paleta)?.label}</span>
              </div>
            </section>

            <section className="aniv-secao">
              <h3 className="aniv-secao-titulo">Texto</h3>
              <FormField label="Título" hint={`Em branco, mostra o mês em destaque: "${nomeMes}"`}>
                <TextField value={opcoes.titulo} maxLength={60} placeholder={nomeMes} onChange={(e) => alterar("titulo", e.target.value)} />
              </FormField>
              <FormField label="Mensagem de parabéns">
                <Textarea rows={3} value={opcoes.mensagem} maxLength={240} onChange={(e) => alterar("mensagem", e.target.value)} />
              </FormField>
              <div className="aniv-sugestoes" role="group" aria-label="Mensagens sugeridas">
                {MENSAGENS_SUGERIDAS.map((texto) => (
                  <button key={texto} type="button" className="aniv-sugestao" aria-pressed={opcoes.mensagem === texto}
                    onClick={() => alterar("mensagem", texto)}>
                    {texto}
                  </button>
                ))}
              </div>
              <FormField label="Assinatura">
                <TextField value={opcoes.assinatura} maxLength={60} onChange={(e) => alterar("assinatura", e.target.value)} />
              </FormField>
              <div className="aniv-linha">
                <span className="aniv-rotulo">Nome</span>
                <Segmentado rotulo="Nome" opcoes={FORMAS_NOME} valor={opcoes.formaNome} aoMudar={(v) => alterar("formaNome", v)} />
              </div>
              <div className="aniv-linha">
                <span className="aniv-rotulo">Letra</span>
                <Segmentado rotulo="Tamanho da letra" opcoes={TAMANHOS} valor={opcoes.tamanho} aoMudar={(v) => alterar("tamanho", v)} />
              </div>
              <div className="aniv-switches">
                <FormField label="Setor" inline><Switch checked={opcoes.mostrarSetor} onChange={(v) => alterar("mostrarSetor", v)} /></FormField>
                <FormField label="Cargo" inline><Switch checked={opcoes.mostrarCargo} onChange={(v) => alterar("mostrarCargo", v)} /></FormField>
                <FormField label="Logo" inline><Switch checked={opcoes.mostrarLogo} onChange={(v) => alterar("mostrarLogo", v)} /></FormField>
              </div>
            </section>

            {opcoes.orientacao === "landscape" && opcoes.modelo !== "LISTA" && selecionados.length > 10 && (
              <Alert tone="warning">Com {selecionados.length} pessoas, a letra fica pequena no papel deitado. Em pé cabe melhor.</Alert>
            )}

            <section className="aniv-secao">
              <div className="aniv-pessoas-cabeca">
                <h3 className="aniv-secao-titulo">Quem entra na folha · {selecionados.length} de {pessoas.length}</h3>
                {pessoas.length > 1 && (
                  excluidos.size > 0
                    ? <button type="button" className="aniv-link" onClick={() => setExcluidos(new Set())}>Marcar todos</button>
                    : <button type="button" className="aniv-link" onClick={() => setExcluidos(new Set(pessoas.map((p) => p.id)))}>Desmarcar todos</button>
                )}
              </div>
              <ListaPessoas pessoas={pessoas} excluidos={excluidos} carregando={carregando} erro={erro} nomeMes={nomeMes} aoAlternar={alternarPessoa} />
            </section>
          </div>

          <PreVisualizacao orientacao={opcoes.orientacao}>{folha}</PreVisualizacao>
        </div>

        <footer className="aniv-base">
          <p className="aniv-dica">
            <Lightbulb size={16} aria-hidden="true" />
            Na janela da impressora, marque “Gráficos de plano de fundo” para sair com as cores.
          </p>
          <div className="aniv-base-acoes">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={imprimir} disabled={carregando || selecionados.length === 0}>
              <Printer size={16} /> Imprimir
            </Button>
          </div>
        </footer>
      </section>

      {createPortal(<div className="aniv-area-impressao" aria-hidden="true">{folha}</div>, document.body)}
    </div>
  );
}

type SegmentadoProps<T extends string> = {
  rotulo: string;
  opcoes: Array<{ value: T; label: string }>;
  valor: T;
  aoMudar: (valor: T) => void;
};

function Segmentado<T extends string>({ rotulo, opcoes, valor, aoMudar }: SegmentadoProps<T>) {
  return (
    <div className="aniv-segmentado" role="group" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button key={o.value} type="button" aria-pressed={valor === o.value} onClick={() => aoMudar(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

type ListaPessoasProps = {
  pessoas: EmployeeBirthday[];
  excluidos: Set<string>;
  carregando: boolean;
  erro: string | null;
  nomeMes: string;
  aoAlternar: (id: string) => void;
};

function ListaPessoas({ pessoas, excluidos, carregando, erro, nomeMes, aoAlternar }: ListaPessoasProps) {
  if (carregando) return <div className="aniv-pessoas"><span className="aniv-pessoas-info">Carregando…</span></div>;
  if (erro) return <Alert tone="error">{erro}</Alert>;
  if (pessoas.length === 0) {
    return <div className="aniv-pessoas"><span className="aniv-pessoas-info">Nenhum funcionário ativo faz aniversário em {nomeMes}.</span></div>;
  }
  return (
    <div className="aniv-pessoas">
      {pessoas.map((p) => {
        const fora = excluidos.has(p.id);
        return (
          <label key={p.id} className={`aniv-pessoa${fora ? " aniv-pessoa--fora" : ""}`}>
            <input type="checkbox" checked={!fora} onChange={() => aoAlternar(p.id)} />
            <span className="aniv-pessoa-dia">{p.birthDate.slice(8, 10)}</span>
            <span className="aniv-pessoa-nomes">
              <strong>{nomeParaExibir(p, "APELIDO")}</strong>
              <span>{nomeParaExibir(p, "COMPLETO")}{p.sector ? ` · ${p.sector}` : ""}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

// Mostra a folha A4 real reduzida para caber na coluna e na altura da tela — o que se vê é o que sai na impressora.
function PreVisualizacao({ orientacao, children }: { orientacao: Orientacao; children: ReactNode }) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(0.5);
  const dim = A4_MM[orientacao];

  useLayoutEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const medir = () => {
      const porLargura = (caixa.clientWidth - PADDING_PREVIA_PX) / (dim.w * MM_EM_PX);
      const porAltura = Math.max(window.innerHeight - ALTURA_RESERVADA_PX, 240) / (dim.h * MM_EM_PX);
      setEscala(Math.min(1, porLargura, porAltura));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caixa);
    window.addEventListener("resize", medir);
    return () => {
      observador.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [dim.w, dim.h]);

  return (
    <div className="aniv-previa" ref={caixaRef}>
      <span className="aniv-previa-legenda">Prévia · A4 {orientacao === "portrait" ? "em pé" : "deitado"}</span>
      <div className="aniv-previa-papel" style={{ width: dim.w * MM_EM_PX * escala, height: dim.h * MM_EM_PX * escala }}>
        <div style={{ transform: `scale(${escala})`, transformOrigin: "top left" }}>{children}</div>
      </div>
    </div>
  );
}
