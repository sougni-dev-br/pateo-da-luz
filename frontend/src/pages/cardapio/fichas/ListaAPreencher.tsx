import { Printer } from "lucide-react";
import { useMemo, useState } from "react";
import type { BuffetDish } from "../../../api/client";
import { Button, StatusBadge, TextField } from "../../../design-system";
import { filtrarAPreencher, type FilaAPreencher, type GrupoAPreencher, type ItemAPreencher } from "../../../lib/fichasAPreencher";
import type { FolhaDados } from "../../../lib/folhaDaFicha";

/** Quantos itens cada grupo mostra antes de "Mostrar todos": são centenas de pratos sem ficha. */
const LIMITE_POR_GRUPO = 40;

const TITULO: Record<GrupoAPreencher, string> = {
  aguardando: "Aguardando ficha (criados no lançamento de desperdício)",
  "sem-ficha": "Cadastrados sem ficha",
  incompleta: "Ficha incompleta (custo parcial)",
  "a-conferir": "Ficha montada, a conferir com a cozinha"
};

const ETIQUETA: Record<GrupoAPreencher, { tom: "warning" | "danger" | "neutral"; texto: string }> = {
  aguardando: { tom: "warning", texto: "Aguardando ficha" },
  "sem-ficha": { tom: "neutral", texto: "Sem ficha" },
  incompleta: { tom: "danger", texto: "Incompleta" },
  "a-conferir": { tom: "neutral", texto: "A conferir" }
};

type Props = {
  fila: FilaAPreencher;
  selecionadoId: string | null;
  carregando: boolean;
  onSelecionar: (id: string) => void;
  /** Imprime as folhas (uma por prato escolhido, com o nome já escrito). */
  onImprimir: (folhas: FolhaDados[]) => void;
  /** Folha sem prato nenhum: para o que ainda não tem cadastro. */
  onImprimirEmBranco: () => void;
};

/**
 * O que ainda falta preencher, num lugar só: o que o desperdício criou, os pratos que nunca tiveram ficha e as fichas
 * com custo parcial. Dá para escolher vários e imprimir a folha de cada um (já com o nome), ou imprimir a folha em
 * branco para o que ainda não existe no sistema.
 */
export function ListaAPreencher({ fila, selecionadoId, carregando, onSelecionar, onImprimir, onImprimirEmBranco }: Props) {
  const [busca, setBusca] = useState("");
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [expandidos, setExpandidos] = useState<Set<GrupoAPreencher>>(new Set());

  const grupos = useMemo(
    () => (["aguardando", "sem-ficha", "incompleta", "a-conferir"] as const).map((grupo) => ({ grupo, itens: filtrarAPreencher(fila[grupo], busca) })),
    [fila, busca]
  );
  const visiveis = useMemo(() => grupos.flatMap((g) => g.itens), [grupos]);
  const todosPorId = useMemo(() => new Map([...fila.aguardando, ...fila["sem-ficha"], ...fila.incompleta, ...fila["a-conferir"]].map((i) => [i.id, i])), [fila]);

  function alternar(id: string) {
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (!novo.delete(id)) novo.add(id);
      return novo;
    });
  }

  function imprimirEscolhidos() {
    const folhas = [...escolhidos].map((id) => todosPorId.get(id)?.folha).filter((f): f is FolhaDados => Boolean(f));
    if (folhas.length > 0) onImprimir(folhas);
  }

  if (fila.total === 0 && fila.buffetComFicha.length === 0) {
    return (
      <div className="ft-buffet-vazio">
        {carregando ? <p role="status">Carregando…</p> : (
          <>
            <h2>Nenhuma ficha por preencher</h2>
            <p>Os pratos sem ficha, as fichas incompletas e as preparações criadas no lançamento de desperdício aparecem aqui.</p>
            <Button variant="secondary" leadingIcon={<Printer size={16} aria-hidden />} onClick={onImprimirEmBranco}>Imprimir folha em branco</Button>
          </>
        )}
      </div>
    );
  }

  const linha = (item: ItemAPreencher) => (
    <li key={item.id} className="ft-preencher-linha">
      <input
        type="checkbox"
        className="ft-preencher-check"
        checked={escolhidos.has(item.id)}
        onChange={() => alternar(item.id)}
        aria-label={`Escolher ${item.nome} para imprimir`}
      />
      <button type="button" className={item.id === selecionadoId ? "ft-buffet-item ft-buffet-item--ativo" : "ft-buffet-item"} aria-current={item.id === selecionadoId || undefined} onClick={() => onSelecionar(item.id)}>
        <span className="ft-buffet-linha">
          <strong>{item.nome}</strong>
          <StatusBadge tone={ETIQUETA[item.grupo].tom}>{ETIQUETA[item.grupo].texto}</StatusBadge>
        </span>
        <span className="ft-buffet-meta">{item.detalhe}</span>
      </button>
    </li>
  );

  return (
    <div className="ft-buffet">
      <div className="ft-preencher-barra">
        <TextField label="Buscar prato" type="search" value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Nome do prato" autoComplete="off" />
        <div className="ft-preencher-acoes">
          <Button variant="secondary" size="sm" disabled={visiveis.length === 0} onClick={() => setEscolhidos(new Set(visiveis.map((i) => i.id)))}>Escolher todos ({visiveis.length})</Button>
          <Button variant="secondary" size="sm" disabled={escolhidos.size === 0} onClick={() => setEscolhidos(new Set())}>Limpar</Button>
        </div>
        <div className="ft-preencher-acoes">
          <Button leadingIcon={<Printer size={16} aria-hidden />} disabled={escolhidos.size === 0} onClick={imprimirEscolhidos}>
            Imprimir escolhidos{escolhidos.size > 0 ? ` (${escolhidos.size})` : ""}
          </Button>
          <Button variant="secondary" leadingIcon={<Printer size={16} aria-hidden />} onClick={onImprimirEmBranco}>Imprimir folha em branco</Button>
        </div>
        <p className="ft-preencher-dica">Escolhidos saem com o nome já escrito. A folha em branco serve para o que ainda não está cadastrado.</p>
      </div>

      {grupos.map(({ grupo, itens }) => {
        if (itens.length === 0) return null;
        const expandido = expandidos.has(grupo);
        const mostrados = expandido ? itens : itens.slice(0, LIMITE_POR_GRUPO);
        return (
          <section key={grupo} className="ft-buffet-grupo" aria-label={TITULO[grupo]}>
            <h3>{TITULO[grupo]} <span>{itens.length}</span></h3>
            <ul>{mostrados.map(linha)}</ul>
            {itens.length > mostrados.length && (
              <button type="button" className="ft-link" onClick={() => setExpandidos((atual) => new Set(atual).add(grupo))}>Mostrar todos ({itens.length})</button>
            )}
          </section>
        );
      })}

      {busca.trim() !== "" && visiveis.length === 0 && <p className="ft-buffet-vazio">Nenhum prato com esse nome na fila.</p>}

      {fila.buffetComFicha.length > 0 && (
        <details className="ft-buffet-grupo">
          <summary>Preparações do buffet já com ficha ({fila.buffetComFicha.length})</summary>
          <ul>
            {fila.buffetComFicha.map((p: BuffetDish) => (
              <li key={p.id}>
                <button type="button" className={p.id === selecionadoId ? "ft-buffet-item ft-buffet-item--ativo" : "ft-buffet-item"} onClick={() => onSelecionar(p.id)}>
                  <span className="ft-buffet-linha"><strong>{p.name}</strong><StatusBadge tone="success">Com ficha</StatusBadge></span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
