// RH → Fichas cadastrais: gerar o link para a pessoa preencher, acompanhar quem já abriu,
// quem finalizou (para conferir) e o que foi concluído.
import { ChevronRight, Paperclip, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { criarFichaCadastral, getFichasCadastrais, type FichaCadastralLink, type FichaCadastralResumo } from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { useSession } from "../../../context/SessionContext";
import { Alert, Button, EmptyState, StatusBadge, Tabs, TextField } from "../../../design-system";
import { AtualizacaoEmLote } from "./AtualizacaoEmLote";
import { FichaCadastralDetalhe } from "./FichaCadastralDetalhe";
import { LinkFicha } from "./LinkFicha";
import { ROTA_FICHAS, dataBr, rotaFicha, situacao } from "./fichaFormato";
import "./fichas.css";

const PASSOS: Array<[string, string]> = [
  ["Gere o link", "e envie pelo WhatsApp"],
  ["A pessoa preenche", "e manda as fotos dos documentos"],
  ["Confira", "e complete a parte da empresa"],
  ["Imprima, assine", "e conclua: vira o cadastro"],
];

// O que dizer na lista sobre o andamento de cada ficha.
function andamento(f: FichaCadastralResumo): string {
  if (f.status === "FINALIZADA") return `Enviada em ${dataBr(f.finalizadaEm)}`;
  if (f.status === "CONCLUIDA") return `Concluída em ${dataBr(f.concluidaEm)}`;
  if (f.status === "CANCELADA") return `Cancelada em ${dataBr(f.canceladaEm)}`;
  if (f.vencida) return `Link venceu em ${dataBr(f.expiraEm)}`;
  const prazo = `link vale até ${dataBr(f.expiraEm)}`;
  if (f.status === "PREENCHENDO") return `Em preenchimento · ${prazo}`;
  return f.primeiroAcessoEm ? `Abriu em ${dataBr(f.primeiroAcessoEm)} · ${prazo}` : `Ainda não abriu · ${prazo}`;
}

const FILTROS = [
  { value: "ABERTAS", label: "Em andamento" },
  { value: "CONCLUIDA", label: "Concluídas" },
  { value: "CANCELADA", label: "Canceladas" },
  { value: "", label: "Todas" },
];

function NovaFicha({ aberto, onFechar, onCriada }: { aberto: boolean; onFechar: () => void; onCriada: (l: FichaCadastralLink, nome: string, celular: string) => void }) {
  const [nome, setNome] = useState("");
  const [celular, setCelular] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCriando(true);
    try {
      const link = await criarFichaCadastral({ tipo: "ADMISSAO", nomeReferencia: nome });
      onCriada(link, nome.trim(), celular);
      setNome("");
      setCelular("");
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível gerar o link.");
    } finally {
      setCriando(false);
    }
  }
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar(); }} title="Nova ficha de admissão"
      description="Gera um link para a pessoa preencher os dados e mandar as fotos dos documentos pelo celular.">
      <form className="fc-form" onSubmit={criar}>
        <TextField label="Nome da pessoa" hint="Como você a chama — ela escreve o nome completo na ficha." value={nome} onChange={(e) => setNome(e.target.value)} autoFocus required />
        <TextField label="Celular (opcional)" hint="Para abrir a conversa dela no WhatsApp." inputMode="numeric" value={celular} onChange={(e) => setCelular(e.target.value)} />
        {erro && <Alert tone="error">{erro}</Alert>}
        <div className="fc-form-acoes">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={criando || nome.trim().length < 2}>{criando ? "Gerando…" : "Gerar link"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function FichasCadastrais() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useSession();
  const podeCriar = hasPermission("employee-forms", "create");
  const [filtro, setFiltro] = useState("ABERTAS");
  const [fichas, setFichas] = useState<FichaCadastralResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novaAberta, setNovaAberta] = useState(false);
  const [link, setLink] = useState<{ dados: FichaCadastralLink; nome: string; celular: string } | null>(null);

  // Resposta de um filtro antigo que chega depois não sobrescreve a do filtro atual.
  const pedido = useRef(0);
  const carregar = useCallback(() => {
    const meu = ++pedido.current;
    setErro(null);
    getFichasCadastrais({ status: filtro || undefined })
      .then((lista) => { if (meu === pedido.current) setFichas(lista); })
      .catch((e) => {
        if (meu !== pedido.current) return;
        setFichas(null);
        setErro(e instanceof Error ? e.message : "Não foi possível carregar as fichas.");
      });
  }, [filtro]);

  useEffect(() => { if (!id) { setFichas(null); carregar(); } }, [carregar, id]);

  if (id) return <FichaCadastralDetalhe key={id} id={id} onVoltar={() => navigate(ROTA_FICHAS)} />;

  return (
    <div className="stack fc">
      <section className="panel fc-topo">
        <ol className="fc-passos" aria-label="Como funciona">
          {PASSOS.map(([titulo, texto], i) => (
            <li key={titulo}><span className="fc-passo-num" aria-hidden="true">{i + 1}</span><span><strong>{titulo}</strong>{texto}</span></li>
          ))}
        </ol>
        {podeCriar && (
          <div className="fc-topo-acoes">
            <AtualizacaoEmLote onGeradas={carregar} />
            <Button leadingIcon={<Plus size={16} />} onClick={() => setNovaAberta(true)}>Nova ficha de admissão</Button>
          </div>
        )}
      </section>

      <section className="panel">
        <Tabs tabs={FILTROS} value={filtro} onChange={setFiltro} aria-label="Situação das fichas" />
        {erro && <Alert tone="error">{erro}</Alert>}
        {fichas === null ? (
          !erro && <p className="fc-carregando" role="status">Carregando…</p>
        ) : fichas.length === 0 ? (
          <EmptyState title="Nenhuma ficha aqui"
            description={filtro === "ABERTAS" ? "Gere um link em “Nova ficha de admissão”, ou peça atualização no cadastro de um funcionário." : "Nada nesta situação."} />
        ) : (
          <ul className="fc-lista">
            {fichas.map((f) => {
              const s = situacao(f);
              const nome = f.employee ? `${f.employee.firstName} ${f.employee.lastName}` : f.nomeReferencia;
              return (
                <li key={f.id}>
                  <button type="button" className={`fc-item${f.status === "FINALIZADA" ? " fc-item--destaque" : ""}`} onClick={() => navigate(rotaFicha(f.id))}>
                    <span className="fc-item-nome">
                      <strong>{nome}</strong>
                      <small>{f.tipo === "ADMISSAO" ? "Admissão" : "Atualização de dados"} · criada em {dataBr(f.createdAt)}</small>
                    </span>
                    <span className="fc-item-meta">
                      {f.arquivos > 0 && <span className="fc-item-anexos" title="Arquivos enviados"><Paperclip size={14} aria-hidden="true" /> {f.arquivos}</span>}
                      <span className="fc-item-quando">{andamento(f)}</span>
                      <StatusBadge tone={s.tom}>{s.rotulo}</StatusBadge>
                      <ChevronRight size={18} aria-hidden="true" className="fc-item-seta" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <NovaFicha aberto={novaAberta} onFechar={() => setNovaAberta(false)}
        onCriada={(dados, nome, celular) => { setNovaAberta(false); setLink({ dados, nome, celular }); carregar(); }} />
      {link && (
        <LinkFicha aberto onFechar={() => setLink(null)} nome={link.nome} tipo="ADMISSAO" codigo={link.dados.codigo}
          expiraEm={link.dados.expiraEm} celular={link.celular} />
      )}
    </div>
  );
}

export default FichasCadastrais;
