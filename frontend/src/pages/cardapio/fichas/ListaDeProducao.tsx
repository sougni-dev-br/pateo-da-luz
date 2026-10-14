import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { DishListItem } from "../../../api/client";
import { Button, Money, StatusBadge, TextField } from "../../../design-system";
import { formatarQuantidade, normalizarBusca } from "../../../lib/fichaTecnica";

type Props = {
  fichas: DishListItem[];
  selecionadoId: string | null;
  carregando: boolean;
  /** A carga falhou: o aviso de erro já está na tela, então "nenhuma ficha" seria enganoso. */
  comErro?: boolean;
  canEdit: boolean;
  onSelecionar: (id: string) => void;
  onNova: () => void;
};

/** Situação do custo da ficha de produção: sem ingredientes, com custo parcial ou pronta para virar ingrediente de um prato. */
function situacaoDaProducao(ficha: DishListItem): { tom: "neutral" | "danger" | "success"; texto: string } {
  if (!ficha.isActive) return { tom: "neutral", texto: "Inativa" };
  if (ficha.itemsCount === 0) return { tom: "neutral", texto: "Sem ingredientes" };
  if (ficha.custoIncompleto) return { tom: "danger", texto: "Custo parcial" };
  return { tom: "success", texto: "Pronta" };
}

/**
 * As fichas de produção (a massa do nhoque, um molho base): preparos que não são vendidos e entram como ingrediente de
 * outras fichas. Sem preço, CMV nem margem: o que importa é o custo de uma unidade do que ela rende.
 */
export function ListaDeProducao({ fichas, selecionadoId, carregando, comErro = false, canEdit, onSelecionar, onNova }: Props) {
  const [busca, setBusca] = useState("");
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const inativas = useMemo(() => fichas.filter((ficha) => !ficha.isActive).length, [fichas]);
  const visiveis = useMemo(() => {
    const termo = normalizarBusca(busca);
    const dasAtivas = mostrarInativas ? fichas : fichas.filter((ficha) => ficha.isActive);
    return termo ? dasAtivas.filter((ficha) => normalizarBusca(ficha.name).includes(termo)) : dasAtivas;
  }, [fichas, busca, mostrarInativas]);

  return (
    <div className="ft-buffet">
      <div className="ft-preencher-barra">
        <TextField label="Buscar ficha de produção" type="search" value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Nome da ficha" autoComplete="off" />
        {canEdit && (
          <div className="ft-preencher-acoes">
            <Button leadingIcon={<Plus size={16} aria-hidden />} onClick={onNova}>Nova ficha de produção</Button>
          </div>
        )}
        {inativas > 0 && (
          <label className="ft-preencher-dica">
            <input type="checkbox" checked={mostrarInativas} onChange={(evento) => setMostrarInativas(evento.target.checked)} /> Mostrar inativas ({inativas})
          </label>
        )}
        <p className="ft-preencher-dica">
          Ficha de produção é o que se prepara e não se vende (a massa do nhoque, um molho base). Ela não tem preço nem CMV: o custo dela entra no CMV dos pratos que a usam como ingrediente.
        </p>
      </div>

      {carregando && fichas.length === 0 ? (
        <p className="ft-buffet-vazio" role="status">Carregando…</p>
      ) : comErro && fichas.length === 0 ? null : visiveis.length === 0 && fichas.length === 0 ? (
        <div className="ft-buffet-vazio">
          <h2>Nenhuma ficha de produção</h2>
          <p>Cadastre a massa, o molho base ou qualquer preparo que entra em mais de um prato.</p>
        </div>
      ) : visiveis.length === 0 ? (
        <p className="ft-buffet-vazio">Nenhuma ficha com esse nome.</p>
      ) : (
        <section className="ft-buffet-grupo" aria-label="Fichas de produção">
          <h3>Fichas de produção <span>{visiveis.length}</span></h3>
          <ul>
            {visiveis.map((ficha) => {
              const situacao = situacaoDaProducao(ficha);
              return (
                <li key={ficha.id}>
                  <button
                    type="button"
                    className={ficha.id === selecionadoId ? "ft-buffet-item ft-buffet-item--ativo" : "ft-buffet-item"}
                    aria-current={ficha.id === selecionadoId || undefined}
                    onClick={() => onSelecionar(ficha.id)}
                  >
                    <span className="ft-buffet-linha">
                      <strong>{ficha.name}</strong>
                      <StatusBadge tone={situacao.tom}>{situacao.texto}</StatusBadge>
                    </span>
                    <span className="ft-buffet-meta">
                      Rende {formatarQuantidade(ficha.yieldQty)} {ficha.yieldUnit}
                      {ficha.itemsCount > 0 && <> · <Money value={ficha.custoPorcao} /> por {ficha.yieldUnit.toLowerCase()}{ficha.custoIncompleto ? " (parcial)" : ""}</>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
