// RH → Brindes: registro de quem recebeu o brinde (Natal e outras datas). A lista é a dos
// funcionários ativos; marcar grava quem recebeu, o dia e quem marcou. Quem recebeu e depois
// saiu continua na lista. A campanha escolhida fica no endereço (?brinde=<id>).
import { FileDown, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  type DetalheBrinde, type ListaCampanhasBrinde, type PessoaBrinde,
  criarCampanhaBrinde, desfazerEntregaBrinde, getCampanhasBrinde, getDetalheBrinde,
  marcarEntregaBrinde, marcarEntregasBrindeEmLote,
} from "../../api/client";
import { Alert, Button, EmptyState } from "../../design-system";
import { gerarPdfBrinde } from "./brindes/pdfBrindes";
import { type FiltroBrinde, type QuemEntraNoPdf, agruparPorEmpresa, dataBr, filtrarPessoas } from "./brindes/brindeLista";
import "./brindes/brindes.css";

const mensagem = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);

function LinhaPessoa({ pessoa, ocupada, onMarcar, onData, onObservacao }: {
  pessoa: PessoaBrinde;
  ocupada: boolean;
  onMarcar: (p: PessoaBrinde) => void;
  onData: (p: PessoaBrinde, iso: string) => void;
  onObservacao: (p: PessoaBrinde, texto: string) => void;
}) {
  const e = pessoa.entrega;
  return (
    <div className={`br-linha${e ? " br-linha--entregue" : ""}`}>
      <button type="button" className="br-marca" aria-pressed={!!e} disabled={ocupada || (!e && !pessoa.ativo)} onClick={() => onMarcar(pessoa)}>
        {e ? "✓ Recebeu" : "Marcar como entregue"}
      </button>
      <div className="br-nome">
        <strong>{pessoa.nome}</strong>
        <span className="br-sub">{[pessoa.setor, pessoa.cargo].filter(Boolean).join(" · ") || "—"}</span>
        {!pessoa.ativo && <span className="br-aviso">Já saiu da empresa</span>}
        {pessoa.saidaEm && <span className="br-aviso">Saída lançada para {dataBr(pessoa.saidaEm)}</span>}
      </div>
      {e ? (
        <div>
          <input type="date" aria-label={`Data da entrega para ${pessoa.nome}`} defaultValue={e.entregueEm} disabled={ocupada}
            onBlur={(ev) => { if (ev.target.value && ev.target.value !== e.entregueEm) onData(pessoa, ev.target.value); }} />
          {e.registradoPor && <span className="br-quem">Marcado por {e.registradoPor}</span>}
        </div>
      ) : <span className="br-sub">Ainda não recebeu</span>}
      {e ? (
        <input type="text" aria-label={`Observação para ${pessoa.nome}`} placeholder="Observação (ex.: retirou o irmão)" maxLength={300}
          defaultValue={e.observacao ?? ""} disabled={ocupada}
          onBlur={(ev) => { if (ev.target.value.trim() !== (e.observacao ?? "")) onObservacao(pessoa, ev.target.value); }} />
      ) : <span />}
    </div>
  );
}

function NovaCampanha({ onCriada, onCancelar }: { onCriada: (id: string) => void; onCancelar?: () => void }) {
  const [nome, setNome] = useState("Brinde de Natal");
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const criar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const { id } = await criarCampanhaBrinde({ nome: nome.trim(), ano: Number(ano) });
      onCriada(id);
    } catch (e) {
      setErro(mensagem(e, "Não consegui criar o brinde."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="br-novo">
        <label>Nome do brinde<input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} /></label>
        <label>Ano<input type="number" value={ano} onChange={(e) => setAno(e.target.value)} style={{ width: 90 }} /></label>
        <Button size="sm" onClick={() => void criar()} disabled={salvando || nome.trim().length < 2}>Criar</Button>
        {onCancelar && <Button size="sm" variant="secondary" onClick={onCancelar}>Cancelar</Button>}
      </div>
      {erro && <Alert tone="error">{erro}</Alert>}
    </div>
  );
}

export function Brindes() {
  const [params, setParams] = useSearchParams();
  const brindeId = params.get("brinde");
  const [lista, setLista] = useState<ListaCampanhasBrinde | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheBrinde | null>(null);
  const [erro, setErro] = useState<string | null>(null);
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

  const executar = async (chave: string, acao: () => Promise<unknown>) => {
    setOcupada(chave);
    setErro(null);
    try {
      await acao();
      if (detalhe) setDetalhe(await getDetalheBrinde(detalhe.campanha.id));
      setLista(await getCampanhasBrinde());
    } catch (e) {
      setErro(mensagem(e, "Não consegui gravar."));
    } finally {
      setOcupada(null);
    }
  };

  const id = detalhe?.campanha.id;
  const marcar = (p: PessoaBrinde) => id && void executar(p.employeeId, () => (p.entrega ? desfazerEntregaBrinde(id, p.employeeId) : marcarEntregaBrinde(id, p.employeeId)));
  const mudarData = (p: PessoaBrinde, iso: string) => id && void executar(p.employeeId, () => marcarEntregaBrinde(id, p.employeeId, { entregueEm: iso }));
  const mudarObservacao = (p: PessoaBrinde, texto: string) => id && void executar(p.employeeId, () => marcarEntregaBrinde(id, p.employeeId, { observacao: texto.trim() || null }));

  const faltam = useMemo(() => detalhe?.pessoas.filter((p) => p.ativo && !p.entrega) ?? [], [detalhe]);
  const marcarTodos = () => {
    if (!id || faltam.length === 0) return;
    if (!window.confirm(`Marcar ${faltam.length} ${faltam.length === 1 ? "pessoa" : "pessoas"} como entregue hoje? Só use se todas já receberam o brinde.`)) return;
    void executar("lote", () => marcarEntregasBrindeEmLote(id, { employeeIds: faltam.map((p) => p.employeeId) }));
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

  return (
    <section className="panel br-tela" aria-labelledby="br-titulo">
      <div className="br-topo">
        <div>
          <h2 id="br-titulo">Brindes aos colaboradores</h2>
          <p>Funcionários ativos e quem já recebeu. Fica registrado quem, quando e quem marcou.</p>
        </div>
        <div className="br-acoes">
          {lista && lista.campanhas.length > 1 && (
            <select aria-label="Escolher brinde" value={detalhe?.campanha.id ?? ""} onChange={(e) => setParams({ brinde: e.target.value })}>
              {lista.campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome} {c.ano}</option>)}
            </select>
          )}
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} />} onClick={() => void carregar()}>Atualizar</Button>
          {detalhe && (
            <select aria-label="Quem entra no PDF" value={quemNoPdf} onChange={(e) => setQuemNoPdf(e.target.value as QuemEntraNoPdf)}>
              <option value="FALTAM">PDF: só quem falta</option>
              <option value="TODOS">PDF: todos os ativos</option>
            </select>
          )}
          {detalhe && <Button variant="secondary" size="sm" leadingIcon={<FileDown size={14} />} onClick={() => void gerarPdf()} disabled={gerandoPdf}>{gerandoPdf ? "Gerando…" : "Gerar PDF para assinatura"}</Button>}
          {detalhe && <Button size="sm" leadingIcon={<Plus size={14} />} onClick={() => setCriando(true)}>Novo brinde</Button>}
        </div>
      </div>

      {erro && <Alert tone="error">{erro}</Alert>}
      {carregando && !lista && <p className="br-sub">Carregando…</p>}

      {(criando || (lista && lista.campanhas.length === 0)) && (
        <NovaCampanha
          onCancelar={criando ? () => setCriando(false) : undefined}
          onCriada={(novo) => { setCriando(false); setParams({ brinde: novo }); }}
        />
      )}
      {lista && lista.campanhas.length === 0 && !criando && (
        <EmptyState title="Nenhum brinde registrado" description="Crie o brinde de Natal acima para listar os funcionários ativos e marcar quem recebeu." />
      )}

      {detalhe && resumo && (
        <>
          <div className="br-progresso">
            <div className="br-barra" role="progressbar" aria-valuenow={percentual} aria-valuemin={0} aria-valuemax={100} aria-label="Andamento das entregas">
              <span style={{ width: `${percentual}%` }} />
            </div>
            <small>
              <strong>{detalhe.campanha.nome} {detalhe.campanha.ano}</strong>: {resumo.entregues} de {resumo.ativos} funcionários ativos já receberam
              {resumo.entreguesDeInativos > 0 && ` · ${resumo.entreguesDeInativos} que receberam e já saíram`}.
            </small>
          </div>

          <div className="br-filtros" role="group" aria-label="Filtrar lista">
            <button type="button" className="br-filtro" aria-pressed={filtro === "TODOS"} onClick={() => setFiltro("TODOS")}><strong>{detalhe.pessoas.length}</strong> Todos</button>
            <button type="button" className="br-filtro" aria-pressed={filtro === "FALTAM"} onClick={() => setFiltro("FALTAM")}><strong>{resumo.faltam}</strong> Faltam</button>
            <button type="button" className="br-filtro" aria-pressed={filtro === "RECEBERAM"} onClick={() => setFiltro("RECEBERAM")}><strong>{resumo.entregues + resumo.entreguesDeInativos}</strong> Receberam</button>
            {faltam.length > 0 && <Button size="sm" variant="secondary" onClick={marcarTodos} disabled={ocupada !== null}>Marcar todos que faltam</Button>}
            <input className="br-busca" type="search" placeholder="Buscar nome ou setor" aria-label="Buscar funcionário" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>

          {grupos.length === 0 && <EmptyState title="Ninguém nesta lista" description="Troque o filtro ou a busca." />}
          {grupos.map((g) => (
            <div key={g.empresa} className="br-grupo">
              <h3>{g.empresa} · {g.pessoas.length}</h3>
              {g.pessoas.map((p) => (
                <LinhaPessoa key={`${p.employeeId}:${p.entrega?.entregueEm ?? ""}:${p.entrega?.observacao ?? ""}`} pessoa={p}
                  ocupada={ocupada === p.employeeId || ocupada === "lote"} onMarcar={marcar} onData={mudarData} onObservacao={mudarObservacao} />
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
