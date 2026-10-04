// Cardápio → Plaquinhas do buffet: a cozinha monta a lista do dia (ou do coffee break)
// a partir do catálogo e imprime as plaquinhas em português e inglês. A aba "Cardápio do
// evento" monta a placa de frente e verso do display de acrílico.
import { useCallback, useEffect, useState } from "react";
import {
  getBuffetMenus, getBuffetPlateItems, getBuffetPlateLists,
  type BuffetMenuSummary, type BuffetPlateItem, type BuffetPlateListSummary,
} from "../../../api/client";
import { useSession } from "../../../context/SessionContext";
import { Alert, Tabs } from "../../../design-system";
import { useNavigationGuard } from "../../../lib/navigationGuard";
import { hasPermission } from "../../../lib/permissions";
import { CardapioAcrilico } from "./CardapioAcrilico";
import { CatalogoPlaquinhas } from "./CatalogoPlaquinhas";
import { MontarFolha } from "./MontarFolha";
import "./plaquinhas-tela.css";

const MODULO = "buffet-plates";
// No celular as três abas dividem a linha; o rótulo encolhe para caber sem quebrar.
const rotulo = (longo: string, curto: string) => <><span className="plq-aba-longa">{longo}</span><span className="plq-aba-curta" aria-hidden="true">{curto}</span></>;
const ABAS = [
  { value: "montar", label: "Plaquinhas" },
  { value: "cardapio", label: rotulo("Cardápio do evento", "Cardápio") },
  { value: "catalogo", label: rotulo("Catálogo de pratos", "Catálogo") },
];

export function Plaquinhas() {
  const { user } = useSession();
  const podeCriar = hasPermission(user, MODULO, "create");
  const podeEditar = hasPermission(user, MODULO, "edit");
  const podeExcluir = hasPermission(user, MODULO, "delete");

  const [aba, setAba] = useState("montar");
  // Inclui os inativos: listas antigas ainda mostram pratos que saíram do catálogo.
  const [catalogo, setCatalogo] = useState<BuffetPlateItem[]>([]);
  const [listas, setListas] = useState<BuffetPlateListSummary[]>([]);
  const [cardapios, setCardapios] = useState<BuffetMenuSummary[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [folhaPendente, setFolhaPendente] = useState(false);
  const [cardapioPendente, setCardapioPendente] = useState(false);

  const carregarListas = useCallback(() => {
    getBuffetPlateLists().then(setListas).catch(() => setErro("Não foi possível carregar as listas salvas."));
  }, []);
  const carregarCardapios = useCallback(() => {
    getBuffetMenus().then(setCardapios).catch(() => setErro("Não foi possível carregar os cardápios salvos."));
  }, []);

  useEffect(() => {
    let ativo = true;
    // Cardápios carregam à parte: se essa rota falhar, as plaquinhas continuam funcionando.
    const menus = getBuffetMenus().catch(() => { if (ativo) setErro("Não foi possível carregar os cardápios salvos. As plaquinhas funcionam normalmente."); return []; });
    Promise.all([getBuffetPlateItems(true), getBuffetPlateLists(), menus])
      .then(([itens, ls, ms]) => { if (ativo) { setCatalogo(itens); setListas(ls); setCardapios(ms); } })
      .catch((x) => { if (ativo) setErro(x instanceof Error ? x.message : "Não foi possível carregar o catálogo."); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []);

  // Um aviso só para a página: sair pelo menu, pelo Sair ou fechando a aba com folha ou
  // cardápio não salvos pede confirmação.
  const pendente = folhaPendente || cardapioPendente;
  const oQue = folhaPendente && cardapioPendente ? "A folha de plaquinhas e o cardápio têm" : folhaPendente ? "A folha de plaquinhas tem" : "O cardápio tem";
  useNavigationGuard(pendente, `${oQue} mudanças não salvas. Sair desta tela e perder as mudanças?`);
  useEffect(() => {
    if (!pendente) return undefined;
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pendente]);

  const guardarPrato = useCallback((p: BuffetPlateItem) => {
    setCatalogo((atual) => {
      const sem = atual.filter((x) => x.id !== p.id);
      return [...sem, p].sort((a, b) => a.namePt.localeCompare(b.namePt, "pt-BR"));
    });
  }, []);

  if (carregando) return <p className="plq-contagem">Carregando o catálogo…</p>;

  return (
    <div className="plq-pagina">
      {erro && <Alert tone="error">{erro}</Alert>}
      <Tabs className="plq-abas" tabs={ABAS} value={aba} onChange={setAba} />
      {/* As abas ficam montadas: ir ao catálogo cadastrar um prato não apaga o que estava sendo montado. */}
      <div hidden={aba !== "montar"}>
        <MontarFolha ativa={aba === "montar"} catalogo={catalogo} listas={listas} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir}
          aoMudarListas={carregarListas} aoCadastrarPrato={guardarPrato} aoMudarPendencia={setFolhaPendente} />
      </div>
      <div hidden={aba !== "cardapio"}>
        <CardapioAcrilico ativa={aba === "cardapio"} catalogo={catalogo} cardapios={cardapios} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir}
          aoMudarCardapios={carregarCardapios} aoMudarPendencia={setCardapioPendente} />
      </div>
      <div hidden={aba !== "catalogo"}>
        <CatalogoPlaquinhas catalogo={catalogo} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir} aoMudar={guardarPrato} />
      </div>
    </div>
  );
}
