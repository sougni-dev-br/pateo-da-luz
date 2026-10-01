// RH → Rescisões: a lista de quem saiu (ou está saindo) e o passo a passo de cada
// rescisão. O funcionário e o passo ficam no endereço (?funcionario=…&passo=…): voltar do
// navegador e o atalho vindo da gorjeta e de Funcionários abrem no lugar certo.
import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type ListaRescisoes as Lista, getRescisoes } from "../../api/client";
import { Alert, Button, EmptyState } from "../../design-system";
import { AssistenteRescisao, type NumeroPasso } from "./rescisoes/AssistenteRescisao";
import { FILTROS, type FiltroSituacao, ListaRescisoes, contarPorSituacao, linhasDaLista } from "./rescisoes/ListaRescisoes";
import "./rescisoes/rescisoes.css";

const PASSOS_VALIDOS: NumeroPasso[] = [1, 2, 3, 4];

export function Rescisoes() {
  const [params, setParams] = useSearchParams();
  const funcionario = params.get("funcionario");
  const nova = params.get("nova") === "1";
  const passoPedido = Number(params.get("passo"));
  const passo: NumeroPasso = PASSOS_VALIDOS.includes(passoPedido as NumeroPasso) ? (passoPedido as NumeroPasso) : funcionario ? 2 : 1;

  const [lista, setLista] = useState<Lista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<FiltroSituacao>("TODAS");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setLista(await getRescisoes());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar as rescisões.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const linhas = useMemo(() => (lista ? linhasDaLista(lista.pessoas, lista.hoje) : []), [lista]);
  const contagem = useMemo(() => contarPorSituacao(linhas), [linhas]);
  const visiveis = filtro === "TODAS" ? linhas : linhas.filter((l) => l.situacao.situacao === filtro);

  const abrir = (employeeId: string, novoPasso?: NumeroPasso) =>
    setParams(novoPasso ? { funcionario: employeeId, passo: String(novoPasso) } : { funcionario: employeeId });
  const irParaPasso = (n: NumeroPasso) => {
    const proximo = new URLSearchParams(params);
    proximo.set("passo", String(n));
    setParams(proximo);
  };
  const voltarParaLista = () => {
    setParams({});
    void carregar();
  };

  if (funcionario || nova) {
    return (
      <section className="panel rr-tela">
        <AssistenteRescisao
          employeeId={funcionario}
          passo={funcionario ? passo : 1}
          lista={lista}
          onEscolher={(id) => abrir(id, 1)}
          onPasso={irParaPasso}
          onVoltar={voltarParaLista}
          onMudou={() => void carregar()}
        />
      </section>
    );
  }

  return (
    <section className="panel rr-tela" aria-labelledby="rr-titulo">
      <div className="rr-topo">
        <div>
          <h2 id="rr-titulo">Quem saiu ou está saindo</h2>
          <p>Saídas dos últimos 90 dias, quem vai sair e rescisões com parcela em aberto.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} />} onClick={() => void carregar()} disabled={carregando}>
            Atualizar
          </Button>
          <Button size="sm" leadingIcon={<Plus size={14} />} onClick={() => setParams({ nova: "1" })}>Nova rescisão</Button>
        </div>
      </div>

      {erro && <Alert tone="error">{erro}</Alert>}

      {lista && linhas.length > 0 && (
        <div className="rr-filtros" role="group" aria-label="Filtrar por situação">
          {FILTROS.filter((f) => f.id === "TODAS" || contagem[f.id] > 0).map((f) => (
            <button key={f.id} type="button" className={`rr-filtro rr-filtro--${f.tom}`} aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
              <strong>{contagem[f.id]}</strong> {f.rotulo}
            </button>
          ))}
        </div>
      )}

      {carregando && !lista && <p className="rr-ajuda">Carregando rescisões…</p>}

      {lista && linhas.length === 0 && (
        <EmptyState title="Ninguém saindo" description="Nenhuma saída nos últimos 90 dias e nenhuma rescisão em aberto. Para começar uma, use Nova rescisão." />
      )}

      {visiveis.length > 0 && <ListaRescisoes linhas={visiveis} onAbrir={(id) => abrir(id)} />}
    </section>
  );
}
