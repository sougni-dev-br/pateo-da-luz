// RH → Fichas cadastrais: gerar o link para a pessoa preencher, acompanhar quem já abriu,
// quem finalizou (para conferir) e o que foi concluído.
import { ChevronRight, Paperclip, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { criarFichaCadastral, getFichasCadastrais, type FichaCadastralLink, type FichaCadastralResumo } from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { useSession } from "../../../context/SessionContext";
import { Alert, Button, EmptyState, StatusBadge, Tabs, TextField } from "../../../design-system";
import { FichaCadastralDetalhe } from "./FichaCadastralDetalhe";
import { LinkFicha } from "./LinkFicha";
import { ROTA_FICHAS, dataBr, rotaFicha, situacao } from "./fichaFormato";
import "./fichas.css";

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

  const carregar = useCallback(() => {
    setErro(null);
    getFichasCadastrais({ status: filtro || undefined })
      .then(setFichas)
      .catch((e) => { setFichas([]); setErro(e instanceof Error ? e.message : "Não foi possível carregar as fichas."); });
  }, [filtro]);

  useEffect(() => { if (!id) carregar(); }, [carregar, id]);

  if (id) return <FichaCadastralDetalhe id={id} onVoltar={() => navigate(ROTA_FICHAS)} />;

  return (
    <div className="stack fc">
      <section className="panel fc-topo">
        <div className="fc-topo-texto">
          <p className="fc-descricao">
            Mande o link pelo WhatsApp: a pessoa preenche a ficha e manda as fotos dos documentos pelo celular.
            Quando ela finalizar, confira aqui, complete a parte da empresa, imprima para assinar e conclua.
          </p>
        </div>
        {podeCriar && <Button leadingIcon={<Plus size={16} />} onClick={() => setNovaAberta(true)}>Nova ficha de admissão</Button>}
      </section>

      <section className="panel">
        <Tabs tabs={FILTROS} value={filtro} onChange={setFiltro} aria-label="Situação das fichas" />
        {erro && <Alert tone="error">{erro}</Alert>}
        {fichas === null ? (
          <p className="fc-carregando">Carregando…</p>
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
                      <span className="fc-item-quando">
                        {f.status === "FINALIZADA" ? `Finalizada em ${dataBr(f.finalizadaEm)}`
                          : f.status === "CONCLUIDA" ? `Concluída em ${dataBr(f.concluidaEm)}`
                          : f.status === "CANCELADA" ? `Cancelada em ${dataBr(f.canceladaEm)}`
                          : f.primeiroAcessoEm ? `Aberta em ${dataBr(f.primeiroAcessoEm)}` : "Ainda não abriu"}
                      </span>
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
