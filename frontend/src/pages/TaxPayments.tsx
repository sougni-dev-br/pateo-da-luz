import { CheckCircle2, Plus, Search, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type AppUser, type TaxPanorama, type TaxPayment, type TaxPaymentFilters,
  deleteTaxPayment, getTaxPanorama, getTaxPayments,
} from "../api/client";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Notice, useNotice } from "../components/Notice";
import { Button, IconButton, Select, TextField } from "../design-system";
import { hojeIso } from "../lib/guia-imposto";
import { hasPermission } from "../lib/permissions";
import { ListaGuias } from "./tax-payments/ListaGuias";
import { ModalGuia, type GuiaSalva, type InicialDaGuia } from "./tax-payments/ModalGuia";
import { ModalImportacao } from "./tax-payments/ModalImportacao";
import { ResumoImpostos } from "./tax-payments/ResumoImpostos";
import { TIPOS_DE_GUIA } from "./tax-payments/formularioGuia";
import { competenciaDoMes, linkContasAPagar, rotuloMes, ultimoDiaDoMes } from "./tax-payments/regras";
import "./tax-payments/tax-payments.css";

type Situacao = "" | "OVERDUE" | "PENDING" | "PAID" | "CANCELED";

const TAMANHO_PAGINA = 30;

type JanelaAberta =
  | { tipo: "guia"; editId: string | null; duplicarDe: string | null; inicial?: InicialDaGuia }
  | { tipo: "importar" }
  | null;

type Props = { user: AppUser };

export function TaxPayments({ user }: Props) {
  const podeLancar = hasPermission(user, "tax-payments", "create");
  const podeEditar = hasPermission(user, "tax-payments", "edit");
  const podeExcluir = hasPermission(user, "tax-payments", "delete");
  // Confirmar a importação é "approve" no servidor: sem isso o botão só levaria a um 403 depois de conferir tudo.
  const podeImportar = hasPermission(user, "tax-payments", "approve");
  const podeVerContasAPagar = hasPermission(user, "payables", "view");
  const navigate = useNavigate();
  const topoDaLista = useRef<HTMLDivElement>(null);

  const { notice, setNotice } = useNotice(7000);
  const [panorama, setPanorama] = useState<TaxPanorama | null>(null);
  const [guias, setGuias] = useState<TaxPayment[]>([]);
  const [paginacao, setPaginacao] = useState({ page: 1, totalPages: 1, total: 0 });
  const [carregando, setCarregando] = useState(true);

  const [situacao, setSituacao] = useState<Situacao>("");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [tipo, setTipo] = useState("");
  const [mes, setMes] = useState("");
  const [pagina, setPagina] = useState(1);

  const [janela, setJanela] = useState<JanelaAberta>(null);
  const [excluir, setExcluir] = useState<TaxPayment | null>(null);
  // Guia recém-lançada: a faixa de sucesso oferece "Lançar outra guia" já com o vencimento e a competência dela.
  const [sucesso, setSucesso] = useState<{ mensagem: string; guia: GuiaSalva } | null>(null);

  const hoje = panorama?.hoje ?? hojeIso();

  const filtros = useMemo<TaxPaymentFilters>(() => ({
    status: situacao || undefined,
    search: buscaAplicada || undefined,
    documentType: tipo || undefined,
    competenceStart: mes ? competenciaDoMes(mes) : undefined,
    competenceEnd: mes ? ultimoDiaDoMes(mes) : undefined,
    page: pagina,
    pageSize: TAMANHO_PAGINA,
  }), [situacao, buscaAplicada, tipo, mes, pagina]);

  // Só a resposta do último pedido vale: clicar rápido em duas pílulas não pode deixar a lista da primeira.
  const pedidoPanorama = useRef(0);
  const pedidoLista = useRef(0);

  const carregarPanorama = useCallback(() => {
    const meu = ++pedidoPanorama.current;
    getTaxPanorama()
      .then((p) => { if (meu === pedidoPanorama.current) setPanorama(p); })
      .catch(() => { if (meu === pedidoPanorama.current) setNotice({ tone: "error", message: "Não consegui carregar o painel de impostos." }); });
  }, [setNotice]);

  const carregarLista = useCallback(async () => {
    const meu = ++pedidoLista.current;
    setCarregando(true);
    try {
      const r = await getTaxPayments(filtros);
      if (meu !== pedidoLista.current) return;
      // Excluir ou pagar a última guia de uma página deixa a página inexistente: volta para a última que existe.
      if (r.data.length === 0 && r.pagination.page > 1 && r.pagination.totalPages >= 1 && r.pagination.page > r.pagination.totalPages) {
        setPagina(Math.max(1, r.pagination.totalPages));
        return;
      }
      setGuias(r.data);
      setPaginacao({ page: r.pagination.page, totalPages: r.pagination.totalPages, total: r.pagination.total });
    } catch (e) {
      if (meu === pedidoLista.current) setNotice({ tone: "error", message: e instanceof Error ? e.message : "Não consegui carregar as guias." });
    } finally {
      if (meu === pedidoLista.current) setCarregando(false);
    }
  }, [filtros, setNotice]);

  useEffect(() => { carregarPanorama(); }, [carregarPanorama]);
  useEffect(() => { void carregarLista(); }, [carregarLista]);

  // A busca por texto só dispara depois de uma pausa na digitação.
  useEffect(() => {
    if (busca.trim() === buscaAplicada) return undefined;
    const t = setTimeout(() => { setBuscaAplicada(busca.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [busca, buscaAplicada]);

  const recarregar = () => { carregarPanorama(); void carregarLista(); };

  function aposAcao(mensagem: string, guia?: GuiaSalva) {
    recarregar();
    setJanela(null);
    if (guia) {
      setNotice(null);
      setSucesso({ mensagem, guia });
      return;
    }
    setSucesso(null);
    setNotice({ tone: "success", message: mensagem });
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    try {
      await deleteTaxPayment(excluir.id);
      setNotice({ tone: "success", message: "Guia excluída. Ela saiu de Contas a Pagar e do DRE." });
      recarregar();
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : "Não foi possível excluir." });
    } finally {
      setExcluir(null);
    }
  }

  function filtrar(proximo: Partial<{ situacao: Situacao; tipo: string; mes: string }>) {
    if (proximo.situacao !== undefined) setSituacao(proximo.situacao);
    if (proximo.tipo !== undefined) setTipo(proximo.tipo);
    if (proximo.mes !== undefined) setMes(proximo.mes);
    setPagina(1);
  }

  function limparFiltros() {
    setSituacao(""); setBusca(""); setBuscaAplicada(""); setTipo(""); setMes(""); setPagina(1);
  }

  function verMes(m: string) {
    filtrar({ mes: m, situacao: "" });
    topoDaLista.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const filtrando = Boolean(situacao || buscaAplicada || tipo || mes);
  const contagens = panorama?.situacoes;
  const PILULAS: Array<{ valor: Situacao; rotulo: string; qtd: number | undefined; tom?: string }> = [
    { valor: "", rotulo: "Todas", qtd: contagens?.todas },
    { valor: "OVERDUE", rotulo: "Vencidas", qtd: contagens?.vencidas, tom: "danger" },
    { valor: "PENDING", rotulo: "A vencer", qtd: contagens?.aVencer },
    { valor: "PAID", rotulo: "Pagas", qtd: contagens?.pagas },
    { valor: "CANCELED", rotulo: "Canceladas", qtd: contagens?.canceladas },
  ];

  return (
    <div className="ip-pagina">
      <Notice notice={notice} />

      <div className="ip-cabecalho">
        <p className="ip-cabecalho-texto">
          Guias de impostos e tributos. Cada guia lançada aparece em <b>Contas a Pagar</b>, onde é feita a baixa, e entra no <b>DRE</b> pela competência.
        </p>
        {podeLancar && (
          <div className="ip-cabecalho-acoes">
            {podeImportar && <Button variant="secondary" leadingIcon={<Upload size={15} />} onClick={() => setJanela({ tipo: "importar" })}>Importar planilha</Button>}
            <Button leadingIcon={<Plus size={15} />} onClick={() => setJanela({ tipo: "guia", editId: null, duplicarDe: null })}>Lançar guia</Button>
          </div>
        )}
      </div>

      {sucesso && (
        <div className="ip-sucesso" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>{sucesso.mensagem}</span>
          {podeLancar && (
            <Button size="sm" variant="secondary" leadingIcon={<Plus size={14} />}
              onClick={() => setJanela({ tipo: "guia", editId: null, duplicarDe: null, inicial: { dueDate: sucesso.guia.dueDate, mes: sucesso.guia.mes } })}>
              Lançar outra guia
            </Button>
          )}
          <IconButton label="Dispensar aviso" icon={<X size={15} />} size="sm" onClick={() => setSucesso(null)} />
        </div>
      )}

      {panorama && (
        <ResumoImpostos
          panorama={panorama}
          podeLancar={podeLancar}
          onLancar={(inicial) => setJanela({ tipo: "guia", editId: null, duplicarDe: null, inicial })}
          onVerSituacao={(s) => { filtrar({ situacao: s }); topoDaLista.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          onVerMes={verMes}
        />
      )}

      <section className="ip-lista" ref={topoDaLista} aria-label="Guias">
        <div className="ip-pilulas" role="group" aria-label="Situação das guias">
          {PILULAS.map((p) => (
            <button
              key={p.valor || "todas"}
              type="button"
              className={`ip-pilula${p.tom ? ` ip-pilula--${p.tom}` : ""}`}
              aria-pressed={situacao === p.valor}
              onClick={() => filtrar({ situacao: p.valor })}
            >
              {p.rotulo}
              {p.qtd != null && <span className="ip-pilula-qtd">{p.qtd}</span>}
            </button>
          ))}
        </div>

        <div className="ip-filtros">
          <div className="ip-busca">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar guia"
              placeholder="Buscar por empresa, nº do documento ou CNPJ"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select
            aria-label="Tipo da guia"
            placeholder="Todos os tipos"
            value={tipo}
            onChange={(e) => filtrar({ tipo: e.target.value })}
            options={TIPOS_DE_GUIA.map((t) => ({ value: t, label: t }))}
          />
          <TextField type="month" aria-label="Competência" value={mes} onChange={(e) => filtrar({ mes: e.target.value })} />
          {filtrando && (
            <Button variant="secondary" size="sm" leadingIcon={<X size={14} />} onClick={limparFiltros}>Limpar</Button>
          )}
        </div>

        {mes && <p className="ip-filtro-ativo">Mostrando guias com competência em <b>{rotuloMes(mes)}</b>.</p>}

        <ListaGuias
          guias={guias}
          hoje={hoje}
          carregando={carregando}
          podeEditar={podeEditar}
          podeVerContasAPagar={podeVerContasAPagar}
          podeLancar={podeLancar}
          podeExcluir={podeExcluir}
          filtrando={filtrando}
          onLancar={podeLancar ? () => setJanela({ tipo: "guia", editId: null, duplicarDe: null }) : undefined}
          onLimparFiltros={limparFiltros}
          onEditar={(g) => setJanela({ tipo: "guia", editId: g.id, duplicarDe: null })}
          onDuplicar={(g) => setJanela({ tipo: "guia", editId: null, duplicarDe: g.id })}
          onExcluir={setExcluir}
          onContasAPagar={(g) => navigate(linkContasAPagar(g))}
        />

        {paginacao.totalPages > 1 && (
          <nav className="ip-paginacao" aria-label="Paginação">
            <span>{paginacao.total} guias</span>
            <div>
              <Button variant="secondary" size="sm" disabled={paginacao.page <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
              <span className="ip-paginacao-pos">{paginacao.page} / {paginacao.totalPages}</span>
              <Button variant="secondary" size="sm" disabled={paginacao.page >= paginacao.totalPages} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
            </div>
          </nav>
        )}
      </section>

      {janela?.tipo === "guia" && (
        <ModalGuia
          editId={janela.editId}
          duplicarDe={janela.duplicarDe}
          inicial={janela.inicial}
          onContasAPagar={podeVerContasAPagar ? (g) => navigate(linkContasAPagar(g)) : undefined}
          podeEditar={janela.editId ? podeEditar : podeLancar}
          podeCancelar={podeExcluir}
          onFechar={() => setJanela(null)}
          onSalvo={aposAcao}
        />
      )}
      {janela?.tipo === "importar" && <ModalImportacao onFechar={() => setJanela(null)} onImportado={aposAcao} />}

      <ConfirmDialog
        open={excluir != null}
        tone="danger"
        title="Excluir esta guia?"
        description={excluir && (
          <>
            <b>{excluir.documentType}</b>{excluir.competenceDate ? ` de ${rotuloMes(excluir.competenceDate.slice(0, 7))}` : ""}.
            Ela deixa de aparecer em Contas a Pagar e no DRE.{excluir.paymentDate ? " Como a guia está paga, o pagamento também sai do mês em que foi feito." : ""} A exclusão fica registrada na Auditoria, de onde a guia pode ser restaurada.
          </>
        )}
        confirmLabel="Excluir guia"
        onConfirm={() => void confirmarExclusao()}
        onCancel={() => setExcluir(null)}
      />
    </div>
  );
}
