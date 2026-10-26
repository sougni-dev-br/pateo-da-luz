// Lançamentos obrigatórios por mês de um fornecedor no Fechamento Mensal.
//
// Quando o mesmo fornecedor tem mais de um lançamento por mês — o condomínio do
// shopping cobra o condomínio do mês E a parcela de um acordo de dívida —, "ter
// alguma compra" não prova que os dois entraram. Cada lançamento é cadastrado aqui
// com o PRODUTO que o identifica nas compras (todo lançamento tem itens com produto,
// então a tela de Compras não muda), e o fechamento cobra cada um por si. Quando o
// acordo acaba, "marcar como quitado" encerra a cobrança daquele lançamento.

import { Check, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSupplierClosingRequirement,
  deleteSupplierClosingRequirement,
  getProducts,
  getSupplierClosingRequirements,
  settleSupplierClosingRequirement,
  type Product,
  type SupplierClosingRequirement
} from "../../api/client";
import { Button, StatusBadge, TextField } from "../../design-system";
import { formatDate } from "../../utils/format";
import { ConfirmDialog } from "../ui";
import "./exigenciasDoFornecedor.css";

type Props = {
  /** Nulo enquanto o fornecedor ainda não foi salvo. */
  supplierId: string | null;
  canEdit: boolean;
};

const ATRASO_DA_BUSCA_MS = 300;
const MINIMO_PARA_BUSCAR = 2;
const RESULTADOS_NA_TELA = 8;

export function ExigenciasDoFornecedor({ supplierId, canEdit }: Props) {
  const [lista, setLista] = useState<SupplierClosingRequirement[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Product[]>([]);
  const [escolhido, setEscolhido] = useState<Product | null>(null);
  const [removendo, setRemovendo] = useState<SupplierClosingRequirement | null>(null);

  const carregar = useCallback(async () => {
    if (!supplierId) return;
    setCarregando(true);
    try {
      setLista(await getSupplierClosingRequirements(supplierId));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar os lançamentos obrigatórios.");
    } finally {
      setCarregando(false);
    }
  }, [supplierId]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Busca de produto com atraso: um produto por tecla seria uma consulta por tecla.
  useEffect(() => {
    const termo = busca.trim();
    if (escolhido || termo.length < MINIMO_PARA_BUSCAR) { setResultados([]); return; }
    let ativo = true;
    const espera = window.setTimeout(() => {
      getProducts({ search: termo, isActive: "true", page: 1, pageSize: RESULTADOS_NA_TELA })
        .then((pagina) => { if (ativo) setResultados(pagina.items); })
        .catch(() => { if (ativo) setResultados([]); });
    }, ATRASO_DA_BUSCA_MS);
    return () => { ativo = false; window.clearTimeout(espera); };
  }, [busca, escolhido]);

  // Um produto só pode identificar um lançamento do fornecedor.
  const produtosJaUsados = useMemo(() => new Set(lista.map((e) => e.productId)), [lista]);
  const disponiveis = resultados.filter((p) => !produtosJaUsados.has(p.id));

  async function executar(acao: () => Promise<unknown>) {
    setOcupado(true);
    try {
      await acao();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
    } finally {
      setOcupado(false);
    }
  }

  async function adicionar() {
    if (!supplierId || !escolhido) return;
    await executar(async () => {
      await createSupplierClosingRequirement(supplierId, { label: nome, productId: escolhido.id });
      setNome("");
      setBusca("");
      setEscolhido(null);
    });
  }

  if (!supplierId) {
    return (
      <p className="fex-aviso">
        Salve o fornecedor para cadastrar os lançamentos obrigatórios de cada mês (ex.: condomínio e parcela de acordo).
      </p>
    );
  }

  return (
    <div className="fex">
      <h4>Lançamentos obrigatórios por mês</h4>
      <p className="fex-ajuda">
        Use quando este fornecedor tem <strong>mais de um lançamento por mês</strong> — por exemplo, o condomínio do mês e a
        parcela de um acordo de dívida. Cada um é identificado pelo <strong>produto</strong> dos itens da compra, e o
        fechamento cobra os dois. Sem nenhum cadastrado, basta uma compra do fornecedor no mês.
      </p>

      {erro && <p className="fex-erro" role="alert">{erro}</p>}
      {carregando && lista.length === 0 && <p className="muted" role="status">Carregando…</p>}

      {lista.length > 0 && (
        <ul className="fex-lista">
          {lista.map((e) => (
            <li key={e.id} className={e.settledAt ? "fex-quitada" : undefined}>
              <div className="fex-texto">
                <strong>{e.label}</strong>
                <span>Produto: {e.productName}</span>
              </div>
              <StatusBadge tone={e.settledAt ? "neutral" : "warning"}>
                {e.settledAt ? `Quitado em ${formatDate(e.settledAt)}` : "Cobrado todo mês"}
              </StatusBadge>
              {canEdit && (
                <div className="fex-acoes">
                  <button
                    type="button"
                    className="link-btn"
                    disabled={ocupado}
                    onClick={() => executar(() => settleSupplierClosingRequirement(supplierId, e.id, !e.settledAt))}
                  >
                    {e.settledAt ? <><RotateCcw size={13} /> Voltar a cobrar</> : <><Check size={13} /> Marcar como quitado</>}
                  </button>
                  <button
                    type="button"
                    className="link-btn fex-remover"
                    disabled={ocupado}
                    onClick={() => setRemovendo(e)}
                    aria-label={`Remover o lançamento ${e.label}`}
                  >
                    <Trash2 size={13} /> Remover
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="fex-novo">
          <TextField
            label="Nome do lançamento"
            placeholder="Ex.: Parcelamento de dívida"
            value={nome}
            maxLength={80}
            onChange={(event) => setNome(event.target.value)}
          />

          <div className="fex-produto">
            {escolhido ? (
              <div className="fex-escolhido">
                <span className="fex-escolhido-rotulo">Produto</span>
                <span className="fex-chip">
                  {escolhido.name}
                  <button type="button" aria-label="Trocar o produto" onClick={() => { setEscolhido(null); setBusca(""); }}>
                    <X size={13} />
                  </button>
                </span>
              </div>
            ) : (
              <>
                <TextField
                  label="Produto que identifica o lançamento"
                  placeholder="Digite para buscar (ex.: parcelamento condomínio)"
                  value={busca}
                  onChange={(event) => setBusca(event.target.value)}
                  autoComplete="off"
                />
                {busca.trim().length >= MINIMO_PARA_BUSCAR && (
                  <ul className="fex-resultados" role="listbox" aria-label="Produtos encontrados">
                    {disponiveis.length === 0 ? (
                      <li className="fex-sem-resultado">Nenhum produto livre com esse nome.</li>
                    ) : disponiveis.map((p) => (
                      <li key={p.id} role="option" aria-selected={false}>
                        <button type="button" onClick={() => { setEscolhido(p); setBusca(""); setResultados([]); }}>{p.name}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <Button variant="secondary" onClick={adicionar} disabled={ocupado || !nome.trim() || !escolhido}>
            Adicionar
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={removendo !== null}
        title="Remover lançamento obrigatório?"
        description={removendo ? `"${removendo.label}" deixa de ser cobrado no fechamento. Se o acordo foi pago, prefira "Marcar como quitado": o histórico fica.` : ""}
        confirmLabel="Remover"
        onConfirm={() => {
          const alvo = removendo;
          setRemovendo(null);
          if (alvo) void executar(() => deleteSupplierClosingRequirement(supplierId, alvo.id));
        }}
        onCancel={() => setRemovendo(null)}
      />
    </div>
  );
}
