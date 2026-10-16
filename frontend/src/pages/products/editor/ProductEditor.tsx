import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Notice } from "../../../components/Notice";
import { useSession } from "../../../context/SessionContext";
import { useNavigationGuard } from "../../../lib/navigationGuard";
import { hasPermission } from "../../../lib/permissions";
import { STEP_LABELS, type StepId } from "../natureza";
import { ClassificationStep } from "./ClassificationStep";
import { IdentificationStep } from "./IdentificationStep";
import { NatureStep } from "./NatureStep";
import { ReviewStep } from "./ReviewStep";
import { StockPurchaseStep } from "./StockPurchaseStep";
import { useProductEditor } from "./useProductEditor";
import "./product-editor.css";

const SAIR_SEM_SALVAR = "Existem alterações não salvas. Deseja descartá-las?";
export const ROTA_DA_LISTA = "/estoque/produtos";

export function ProductEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useSession();
  const canEdit = hasPermission(user, "products", "edit");
  const canCreateMasterData = hasPermission(user, "master-data", "create");
  const editor = useProductEditor(id);
  const { cadastroNovo, carregando, salvando, erro, passo, setPasso, passos, pendencias, podeSalvar, sujo, form, opcaoDaNatureza } = editor;
  const topo = useRef<HTMLDivElement | null>(null);

  // Troca de passo leva o olhar e o foco para o título do passo novo (leitor de tela anuncia a mudança).
  const primeiroPasso = useRef(true);
  useEffect(() => {
    if (primeiroPasso.current) { primeiroPasso.current = false; return; }
    topo.current?.scrollIntoView({ block: "start" });
    const titulo = topo.current?.parentElement?.querySelector<HTMLElement>("section[aria-labelledby] h3");
    if (titulo) {
      titulo.tabIndex = -1;
      titulo.focus({ preventScroll: true });
    }
  }, [passo]);

  // Menu lateral e demais saídas do app passam pela mesma confirmação do botão Voltar.
  useNavigationGuard(sujo, SAIR_SEM_SALVAR);

  // Fechar a aba com alteração pendente.
  useEffect(() => {
    if (!sujo) return undefined;
    const avisar = (evento: BeforeUnloadEvent) => { evento.preventDefault(); };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  function voltar() {
    if (sujo && !window.confirm(SAIR_SEM_SALVAR)) return;
    navigate(ROTA_DA_LISTA);
  }

  async function aoSalvar() {
    const resultado = await editor.salvar();
    if (resultado.ok) {
      navigate(ROTA_DA_LISTA, { state: { notice: { tone: resultado.tom, message: resultado.mensagem } } });
    }
  }

  const passoAtual: StepId = passos.includes(passo) ? passo : passos[0];
  const indice = passos.indexOf(passoAtual);
  const proximo = passos[indice + 1];
  const anterior = passos[indice - 1];
  const bloqueiaAvanco = passoAtual === "natureza" && cadastroNovo && !form.nature;
  const pendentesPorPasso = new Set(pendencias.map((pendencia) => pendencia.step));
  const conferido = pendencias.length === 0 && Boolean(form.nature);
  const situacao = pendencias.length > 0
    ? `${pendencias.length} pendência${pendencias.length > 1 ? "s" : ""}`
    : conferido ? "✓ Conferido" : "Natureza não definida";
  const titulo = cadastroNovo ? "Novo produto" : `Editar: ${form.externalCode || "-"} — ${form.name || "sem nome"}`;

  if (carregando) return <div className="stack"><p className="muted">Abrindo o cadastro…</p></div>;

  if (editor.falhaDeCarga) {
    return (
      <div className="stack produto-editor">
        <section className="panel">
          <div className="alert error prominent-alert" role="alert">{erro}</div>
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => navigate(ROTA_DA_LISTA)}>Voltar para a lista</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="stack produto-editor">
      <div ref={topo} />
      {!canEdit && <Notice notice={{ tone: "warning", message: "Você pode ver este cadastro, mas não tem permissão para salvar." }} />}
      <section className="panel">
        <div className="section-heading produto-editor-header">
          <div>
            <p>Produtos</p>
            <h2>{titulo}</h2>
            <div className="produto-editor-contexto">
              {opcaoDaNatureza && <span>{opcaoDaNatureza.label}</span>}
              <span className={conferido ? "contexto-ok" : "contexto-pendente"}>{situacao}</span>
              {sujo && <span>Alterações não salvas</span>}
            </div>
          </div>
          <div className="actions-cell">
            <button type="button" className="secondary-button" onClick={voltar}>Voltar</button>
            <button type="button" className="primary-button" disabled={!podeSalvar || !canEdit} onClick={aoSalvar}>
              {salvando ? "Salvando..." : cadastroNovo ? "Salvar produto" : "Salvar alterações"}
            </button>
          </div>
        </div>

        {erro && <div className="alert error prominent-alert" role="alert">{erro}</div>}

        <nav className="produto-passos" aria-label="Passos do cadastro">
          {passos.map((passoId, posicao) => (
            <button
              key={passoId}
              type="button"
              className={`produto-passo${passoId === passoAtual ? " active" : ""}${pendentesPorPasso.has(passoId) ? " has-pending" : ""}`}
              aria-current={passoId === passoAtual ? "step" : undefined}
              onClick={() => setPasso(passoId)}
            >
              <span className="produto-passo-numero">{posicao + 1}</span>
              {STEP_LABELS[passoId]}
              {pendentesPorPasso.has(passoId) && <span className="sr-only"> (falta preencher)</span>}
            </button>
          ))}
        </nav>

        {passoAtual === "natureza" && <NatureStep editor={editor} canCreateMasterData={canCreateMasterData} />}
        {passoAtual === "identificacao" && <IdentificationStep editor={editor} canCreateMasterData={canCreateMasterData} />}
        {passoAtual === "classificacao" && <ClassificationStep editor={editor} canCreateMasterData={canCreateMasterData} />}
        {passoAtual === "estoque" && <StockPurchaseStep editor={editor} canCreateMasterData={canCreateMasterData} />}
        {passoAtual === "conferencia" && <ReviewStep editor={editor} canCreateMasterData={canCreateMasterData} />}

        <div className="form-actions sticky-form-actions">
          <button type="button" className="secondary-button" disabled={!anterior} onClick={() => anterior && setPasso(anterior)}>
            Voltar um passo
          </button>
          {proximo || bloqueiaAvanco ? (
            <button type="button" className="primary-button" disabled={bloqueiaAvanco} onClick={() => proximo && setPasso(proximo)}>
              Continuar
            </button>
          ) : (
            <button type="button" className="primary-button" disabled={!podeSalvar || !canEdit} onClick={aoSalvar}>
              {salvando ? "Salvando..." : cadastroNovo ? "Salvar produto" : "Salvar alterações"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
