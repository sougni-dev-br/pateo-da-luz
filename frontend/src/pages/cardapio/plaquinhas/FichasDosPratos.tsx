import { Link2, Link2Off, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  createPendingBuffetDish, linkBuffetPlateDish, searchBuffetDishes,
  type BuffetCostState, type BuffetDishCost, type BuffetDishHit,
} from "../../../api/client";
import { Alert, Button, Money } from "../../../design-system";

type Props = {
  pratos: Array<{ id: string; nome: string }>;
  custos: Record<string, BuffetDishCost>;
  /** Falso: a pessoa liga as fichas mas não vê valores em R$. */
  verCusto: boolean;
  /** Enquanto as fichas carregam ou se a busca falhou, a lista não aparece: "sem ficha" seria um estado falso. */
  status?: "carregando" | "ok" | "erro";
  podeCriar: boolean;
  podeEditar: boolean;
  aoMudar: () => void;
};

const ROTULO: Record<BuffetCostState, string> = {
  OK: "Custo calculado", SEM_FICHA: "Sem ficha", PENDENTE: "Ficha ainda não montada", INCOMPLETA: "Ficha incompleta", SEM_PESO: "Falta o rendimento em kg",
};

// Cada prato do dia precisa de uma ficha técnica para ter custo por kg. Aqui se liga o prato a uma ficha que já existe
// ou se cria a ficha (vazia, aguardando montagem na aba Buffet de Fichas Técnicas).
export function FichasDosPratos({ pratos, custos, verCusto, status = "ok", podeCriar, podeEditar, aoMudar }: Props) {
  const [ligando, setLigando] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [achados, setAchados] = useState<BuffetDishHit[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!ligando || texto.trim().length < 2) { setAchados([]); return undefined; }
    let ok = true;
    const t = window.setTimeout(() => {
      searchBuffetDishes(texto.trim()).then((r) => { if (ok) setAchados(r); }).catch(() => { if (ok) setErro("Não foi possível buscar as fichas."); });
    }, 250);
    return () => { ok = false; window.clearTimeout(t); };
  }, [ligando, texto]);

  const executar = async (acao: () => Promise<string | null>) => {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try { setAviso(await acao()); setLigando(null); setTexto(""); aoMudar(); } catch (x) { setErro(x instanceof Error ? x.message : "Não foi possível salvar."); } finally { setOcupado(false); }
  };

  const semCusto = pratos.filter((p) => custos[p.id]?.state !== "OK").length;
  return (
    <section className="plq-bloco" aria-labelledby="pes-fichas">
      <h3 className="plq-bloco-titulo" id="pes-fichas"><span>Fichas e custo dos pratos</span><span>{status !== "ok" ? "" : semCusto ? `${semCusto} sem custo` : "todos com custo"}</span></h3>
      <p className="plq-contagem">O custo por kg vem da ficha técnica ligada ao prato. Prato sem ficha pronta é pesado normalmente, mas fica fora do total em R$.</p>
      {erro && <Alert tone="error">{erro}</Alert>}
      {aviso && <Alert tone="success">{aviso}</Alert>}
      {status === "erro" && <Alert tone="error">Não foi possível carregar as fichas dos pratos. Recarregue a tela e tente de novo.</Alert>}
      {status === "carregando" && pratos.length > 0 && <p className="plq-contagem">Carregando as fichas…</p>}
      {status !== "ok" ? null : pratos.length === 0 ? <p className="plq-vazio">Escolha uma lista de plaquinhas ou pese um prato para ver as fichas.</p> : (
        <ul className="pes-fichas">
          {pratos.map((p) => {
            const c = custos[p.id];
            const estado = c?.state ?? "SEM_FICHA";
            return (
              <li key={p.id}>
                <div className="pes-ficha-linha">
                  <strong>{p.nome}</strong>
                  <span className="pes-ficha-estado" data-estado={estado}>
                    {ROTULO[estado]}
                    {estado === "OK" && verCusto && c?.costPerKg != null && <> · <Money value={c.costPerKg} />/kg</>}
                  </span>
                </div>
                {c?.dishName && <small className="pes-ficha-nome">Ficha: {c.dishName}</small>}
                {estado !== "OK" && c?.reason && <small className="pes-ficha-motivo">{c.reason}</small>}
                {podeEditar && (
                  <div className="pes-ficha-acoes">
                    <Button size="sm" variant="secondary" leadingIcon={<Link2 size={14} aria-hidden="true" />} disabled={ocupado}
                      onClick={() => { setLigando(ligando === p.id ? null : p.id); setTexto(""); setAchados([]); }}>{c?.dishId ? "Trocar ficha" : "Ligar a uma ficha"}</Button>
                    {podeCriar && !c?.dishId && (
                      <Button size="sm" variant="secondary" leadingIcon={<Plus size={14} aria-hidden="true" />} disabled={ocupado}
                        onClick={() => void executar(async () => {
                          const r = await createPendingBuffetDish(p.id);
                          return r.reused ? `“${p.nome}” foi ligado à ficha que já existia com esse nome.` : `Ficha de “${p.nome}” criada. Ela aguarda ser montada em Fichas Técnicas, na aba Buffet.`;
                        })}>Criar ficha</Button>
                    )}
                    {c?.dishId && (
                      <Button size="sm" variant="secondary" leadingIcon={<Link2Off size={14} aria-hidden="true" />} disabled={ocupado}
                        onClick={() => void executar(async () => { await linkBuffetPlateDish(p.id, null); return null; })}>Desligar</Button>
                    )}
                  </div>
                )}
                {ligando === p.id && (
                  <div className="pes-ficha-busca">
                    <label className="plq-busca">
                      <Search size={16} aria-hidden="true" />
                      <input autoFocus aria-label={`Buscar ficha para ${p.nome}`} value={texto} placeholder="Digite o nome da ficha" onChange={(e) => setTexto(e.target.value)} />
                    </label>
                    {achados.length > 0 && (
                      <ul className="pes-busca">
                        {achados.map((h) => (
                          <li key={h.id}>
                            <button type="button" disabled={ocupado} onClick={() => void executar(async () => { await linkBuffetPlateDish(p.id, h.id); return null; })}>
                              {h.name} <small>· rende em {h.unit.toLowerCase()}{h.pending ? " · ainda não montada" : ""}{h.production ? " · ficha de produção" : ""}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {texto.trim().length >= 2 && achados.length === 0 && <p className="plq-vazio">Nenhuma ficha com esse nome.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
