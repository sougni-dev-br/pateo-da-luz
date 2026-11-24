// RH → Brindes: registro de quem recebeu o brinde (Natal e outras datas). A lista é a dos
// funcionários ativos; marcar grava quem recebeu, o dia e quem marcou. Quem recebeu e depois
// saiu continua na lista. O PDF leva a linha de assinatura de quem retira. A campanha escolhida
// fica no endereço (?brinde=<id>).
import { FileDown, Gift, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  type DetalheBrinde, type ListaCampanhasBrinde, type PessoaBrinde,
  desfazerEntregaBrinde, getCampanhasBrinde, getDetalheBrinde, marcarEntregaBrinde, marcarEntregasBrindeEmLote,
} from "../../api/client";
import { Alert, Button, EmptyState, Select, TextField } from "../../design-system";
import { LinhaPessoa } from "./brindes/LinhaPessoa";
import { NovaCampanha } from "./brindes/NovaCampanha";
import { type FiltroBrinde, type QuemEntraNoPdf, agruparPorEmpresa, filtrarPessoas } from "./brindes/brindeLista";
import { gerarPdfBrinde } from "./brindes/pdfBrindes";
import "./brindes/brindes.css";

const mensagem = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
const OPCOES_PDF = [{ value: "FALTAM", label: "Só quem falta" }, { value: "TODOS", label: "Todos os ativos" }];

export function Brindes() {
  const [params, setParams] = useSearchParams();
  const brindeId = params.get("brinde");
  const [lista, setLista] = useState<ListaCampanhasBrinde | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheBrinde | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroBrinde>("TODOS");
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [quemNoPdf, setQuemNoPdf] = useState<QuemEntraNoPdf>("FALTAM");
  const [gerandoPdf, setGerandoPdf] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const campanhas = await getCampanhasBrinde();
      setLista(campanhas);
      const escolhida = campanhas.campanhas.find((c) => c.id === brindeId) ?? campanhas.campanhas[0];
      setDetalhe(escolhida ? await getDetalheBrinde(escolhida.id) : null);
    } catch (e) {
      setErro(mensagem(e, "Não consegui carregar os brindes."));
    } finally {
      setCarregando(false);
    }
  }, [brindeId]);

  useEffect(() => { void carregar(); }, [carregar]);

  // `avisoFinal` vai para a região de status: quem usa leitor de tela ouve o resultado de cada clique.
  const executar = async (chave: string, acao: () => Promise<unknown>, avisoFinal: string) => {
    setOcupada(chave);
    setErro(null);
    try {
      await acao();
      if (detalhe) setDetalhe(await getDetalheBrinde(detalhe.campanha.id));
      setLista(await getCampanhasBrinde());
      setAviso(avisoFinal);
    } catch (e) {
      setErro(mensagem(e, "Não consegui gravar."));
    } finally {
      setOcupada(null);
    }
  };

  const id = detalhe?.campanha.id;
  const alternar = (p: PessoaBrinde) => {
    if (!id) return;
    if (!p.entrega) return void executar(p.employeeId, () => marcarEntregaBrinde(id, p.employeeId), `${p.nome} marcado como entregue.`);
    if (!window.confirm(`Desfazer a entrega do brinde para ${p.nome}?`)) return;
    void executar(p.employeeId, () => desfazerEntregaBrinde(id, p.employeeId), `Entrega de ${p.nome} desfeita.`);
  };
  const mudarData = (p: PessoaBrinde, iso: string) => id && void executar(p.employeeId, () => marcarEntregaBrinde(id, p.employeeId, { entregueEm: iso }), `Data de ${p.nome} corrigida.`);
  const mudarObservacao = (p: PessoaBrinde, texto: string) => id && void executar(p.employeeId, () => marcarEntregaBrinde(id, p.employeeId, { observacao: texto.trim() || null }), `Observação de ${p.nome} salva.`);

  const faltam = useMemo(() => detalhe?.pessoas.filter((p) => p.ativo && !p.entrega) ?? [], [detalhe]);
  const marcarTodos = () => {
    if (!id || faltam.length === 0) return;
    if (!window.confirm(`Marcar ${faltam.length} ${faltam.length === 1 ? "pessoa" : "pessoas"} como entregue hoje? Só use se todas já receberam o brinde.`)) return;
    void executar("lote", () => marcarEntregasBrindeEmLote(id, { employeeIds: faltam.map((p) => p.employeeId) }), `${faltam.length} marcadas como entregue.`);
  };

  const gerarPdf = async () => {
    if (!detalhe) return;
    setGerandoPdf(true);
    setErro(null);
    try {
      await gerarPdfBrinde(detalhe, quemNoPdf);
    } catch (e) {
      setErro(mensagem(e, "Não consegui gerar o PDF."));
    } finally {
      setGerandoPdf(false);
    }
  };

  const grupos = useMemo(() => agruparPorEmpresa(filtrarPessoas(detalhe?.pessoas ?? [], filtro, busca)), [detalhe, filtro, busca]);
  const resumo = detalhe?.resumo;
  const percentual = resumo && resumo.ativos > 0 ? Math.min(100, Math.round((resumo.entregues / resumo.ativos) * 100)) : 0;
  const titulo = detalhe ? `${detalhe.campanha.nome} ${detalhe.campanha.ano}` : "Brinde aos colaboradores";
  const semCampanha = !!lista && lista.campanhas.length === 0;

  const filtros: Array<{ id: FiltroBrinde; numero: number; rotulo: string; ajuda: string; tom: "neutral" | "warning" | "success" }> = resumo && detalhe ? [
    { id: "TODOS", numero: detalhe.pessoas.length, rotulo: "Todos", ajuda: "ativos e quem já saiu e recebeu", tom: "neutral" },
    { id: "FALTAM", numero: resumo.faltam, rotulo: "Faltam", ajuda: "ativos que ainda não receberam", tom: "warning" },
    { id: "RECEBERAM", numero: resumo.entregues + resumo.entreguesDeInativos, rotulo: "Receberam", ajuda: "com data e quem marcou", tom: "success" },
  ] : [];

  return (
    <section className="panel br-tela" aria-labelledby="br-titulo" aria-busy={carregando}>
      <div className="br-topo">
        <div>
          <h2 id="br-titulo">{titulo}</h2>
          <p>Funcionários ativos e quem já recebeu o brinde. Fica registrado quem recebeu, quando e quem marcou.</p>
        </div>
        <div className="br-topo-acoes">
          {lista && lista.campanhas.length > 1 && (
            <Select label="Brinde" value={detalhe?.campanha.id ?? ""} onChange={(e) => setParams({ brinde: e.target.value })}
              options={lista.campanhas.map((c) => ({ value: c.id, label: `${c.nome} ${c.ano}` }))} />
          )}
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} aria-hidden="true" />} onClick={() => void carregar()}>Atualizar</Button>
          {detalhe && <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => setCriando(true)}>Novo brinde</Button>}
        </div>
      </div>

      <p className="br-sr" role="status" aria-live="polite">{aviso}</p>
      {erro && <Alert tone="error">{erro}</Alert>}
      {carregando && !lista && <p className="br-ajuda">Carregando…</p>}

      {(criando || semCampanha) && (
        <div className="br-cartao">
          <h3>{semCampanha ? "Abrir o primeiro brinde" : "Novo brinde"}</h3>
          <NovaCampanha onCancelar={criando ? () => setCriando(false) : undefined} onCriada={(novo) => { setCriando(false); setParams({ brinde: novo }); }} />
        </div>
      )}
      {semCampanha && !criando && (
        <EmptyState title="Nenhum brinde registrado" description="Crie o brinde de Natal para listar os funcionários ativos e marcar quem recebeu." />
      )}

      {detalhe && resumo && (
        <>
          <div className="br-resumo">
            <div className="br-resumo-numero">
              <strong>{resumo.entregues}<span> de {resumo.ativos}</span></strong>
              <small>funcionários ativos já receberam{resumo.entreguesDeInativos > 0 && ` · mais ${resumo.entreguesDeInativos} que receberam e já saíram`}</small>
              <div className="br-barra" role="progressbar" aria-valuenow={percentual} aria-valuemin={0} aria-valuemax={100} aria-label="Andamento das entregas">
                <span style={{ width: `${percentual}%` }} />
              </div>
            </div>
            <div className="br-pdf">
              <Select label="No PDF" value={quemNoPdf} onChange={(e) => setQuemNoPdf(e.target.value as QuemEntraNoPdf)} options={OPCOES_PDF} />
              <Button size="sm" leadingIcon={<FileDown size={14} aria-hidden="true" />} onClick={() => void gerarPdf()} disabled={gerandoPdf}>
                {gerandoPdf ? "Gerando…" : "Gerar PDF para assinatura"}
              </Button>
            </div>
          </div>

          <div className="br-filtros-bloco">
            <div className="br-filtros" role="group" aria-label="Filtrar a lista">
              {filtros.map((f) => (
                <button key={f.id} type="button" className={`br-filtro br-filtro--${f.tom}`} aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
                  <strong>{f.numero}</strong>
                  <span className="br-filtro-texto">{f.rotulo}<small>{f.ajuda}</small></span>
                </button>
              ))}
            </div>
            <div className="br-barra-ferramentas">
              <TextField type="search" aria-label="Buscar funcionário" placeholder="Buscar por nome, setor ou cargo" value={busca} onChange={(e) => setBusca(e.target.value)} containerClassName="br-busca" />
              {faltam.length > 0 && <Button size="sm" variant="secondary" leadingIcon={<Gift size={14} aria-hidden="true" />} onClick={marcarTodos} disabled={ocupada !== null}>Marcar todos que faltam</Button>}
            </div>
          </div>

          {grupos.length === 0 && <EmptyState title="Ninguém nesta lista" description="Troque o filtro ou limpe a busca." />}
          {grupos.map((g) => {
            const ativos = g.pessoas.filter((p) => p.ativo);
            const receberam = ativos.filter((p) => p.entrega).length;
            return (
              <section key={g.empresa} className="br-grupo" aria-label={g.empresa}>
                <h3>{g.empresa}<span>{receberam} de {ativos.length} receberam</span></h3>
                <ul className="br-lista">
                  {g.pessoas.map((p) => (
                    <LinhaPessoa key={p.employeeId} pessoa={p} ocupada={ocupada === p.employeeId || ocupada === "lote"}
                      onAlternar={alternar} onData={mudarData} onObservacao={mudarObservacao} />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}
