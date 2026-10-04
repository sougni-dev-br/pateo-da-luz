// Cardápio → Plaquinhas do buffet: a cozinha monta a lista do dia (ou do coffee break)
// a partir do catálogo e imprime as plaquinhas em português e inglês.
import { useCallback, useEffect, useState } from "react";
import { getBuffetPlateItems, getBuffetPlateLists, type BuffetPlateItem, type BuffetPlateListSummary } from "../../../api/client";
import { useSession } from "../../../context/SessionContext";
import { Alert, Tabs } from "../../../design-system";
import { hasPermission } from "../../../lib/permissions";
import { CatalogoPlaquinhas } from "./CatalogoPlaquinhas";
import { MontarFolha } from "./MontarFolha";
import "./plaquinhas-tela.css";

const MODULO = "buffet-plates";
const ABAS = [{ value: "montar", label: "Montar folha" }, { value: "catalogo", label: "Catálogo de pratos" }];

export function Plaquinhas() {
  const { user } = useSession();
  const podeCriar = hasPermission(user, MODULO, "create");
  const podeEditar = hasPermission(user, MODULO, "edit");
  const podeExcluir = hasPermission(user, MODULO, "delete");

  const [aba, setAba] = useState("montar");
  // Inclui os inativos: listas antigas ainda mostram pratos que saíram do catálogo.
  const [catalogo, setCatalogo] = useState<BuffetPlateItem[]>([]);
  const [listas, setListas] = useState<BuffetPlateListSummary[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregarListas = useCallback(() => {
    getBuffetPlateLists().then(setListas).catch(() => setErro("Não foi possível carregar as listas salvas."));
  }, []);

  useEffect(() => {
    let ativo = true;
    Promise.all([getBuffetPlateItems(true), getBuffetPlateLists()])
      .then(([itens, ls]) => { if (ativo) { setCatalogo(itens); setListas(ls); } })
      .catch((x) => { if (ativo) setErro(x instanceof Error ? x.message : "Não foi possível carregar o catálogo."); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []);

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
      <Tabs tabs={ABAS} value={aba} onChange={setAba} />
      {/* As duas abas ficam montadas: ir ao catálogo cadastrar um prato não apaga a folha em montagem. */}
      <div hidden={aba !== "montar"}>
        <MontarFolha ativa={aba === "montar"} catalogo={catalogo} listas={listas} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir}
          aoMudarListas={carregarListas} aoCadastrarPrato={guardarPrato} />
      </div>
      <div hidden={aba !== "catalogo"}>
        <CatalogoPlaquinhas catalogo={catalogo} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir} aoMudar={guardarPrato} />
      </div>
    </div>
  );
}
