// Pesagem do buffet: a cozinha pesa a panela cheia e anota o peso bruto; o ERP abate o peso da panela
// (cadastrado uma vez) e soma o que foi para o buffet. A sobra no fim do serviço é pesada do mesmo jeito.
import { Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createBuffetWeighing, deleteBuffetWeighing, getBuffetItemCosts, getBuffetPlateList, getBuffetPots, getBuffetWeighings,
  type BuffetDishCost, type BuffetPlateItem, type BuffetPlateListSummary, type BuffetPot, type BuffetWeighingDay, type PlateListKind, type WeighingPhase,
} from "../../../api/client";
import { Alert, Button, EmptyState, Money, Select, TextField } from "../../../design-system";
import { FichasDosPratos } from "./FichasDosPratos";
import { FolhaPesagem } from "./FolhaPesagem";
import { PanelasBuffet } from "./PanelasBuffet";
import { kgTexto, lerKg } from "./pesagemFormato";
import { TIPOS_LISTA } from "./plaquinhasFormato";

type Props = {
  ativa: boolean;
  catalogo: BuffetPlateItem[];
  listas: BuffetPlateListSummary[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
};

const hojeSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const FASES: Array<{ value: WeighingPhase; label: string }> = [{ value: "PRODUCAO", label: "Produção / reposição" }, { value: "SOBRA", label: "Sobra" }];

export function PesagemBuffet({ ativa, catalogo, listas, podeCriar, podeEditar, podeExcluir }: Props) {
  const [data, setData] = useState(hojeSaoPaulo);
  const [tipo, setTipo] = useState<PlateListKind>("BUFFET");
  const [listaId, setListaId] = useState("");
  const [idsDaLista, setIdsDaLista] = useState<string[]>([]);
  const [panelas, setPanelas] = useState<BuffetPot[]>([]);
  const [dia, setDia] = useState<BuffetWeighingDay | null>(null);
  const [itemId, setItemId] = useState("");
  const [potId, setPotId] = useState("");
  const [fase, setFase] = useState<WeighingPhase>("PRODUCAO");
  const [bruto, setBruto] = useState("");
  const [busca, setBusca] = useState("");
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [imprimindo, setImprimindo] = useState(0);
  const [custos, setCustos] = useState<Record<string, BuffetDishCost>>({});
  // "carregando" e "erro" não podem aparecer como "sem ficha": a tela ofereceria criar ficha para prato que já tem.
  const [custosStatus, setCustosStatus] = useState<"carregando" | "ok" | "erro">("carregando");
  // Trava síncrona: dois Enters seguidos chegam antes de o estado "ocupado" renderizar.
  const enviando = useRef(false);

  const porId = useMemo(() => new Map(catalogo.map((p) => [p.id, p])), [catalogo]);
  const panelasAtivas = useMemo(() => panelas.filter((p) => p.isActive), [panelas]);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  // Listas do tipo escolhido; a do dia (mesma data) vem selecionada sozinha.
  const listasDoTipo = useMemo(() => listas.filter((l) => l.kind === tipo), [listas, tipo]);
  useEffect(() => {
    const doDia = listasDoTipo.find((l) => l.eventDate === data);
    setListaId((atual) => (listasDoTipo.some((l) => l.id === atual) && !doDia ? atual : doDia?.id ?? ""));
  }, [listasDoTipo, data]);
  useEffect(() => {
    if (!listaId) { setIdsDaLista([]); return undefined; }
    let ok = true;
    getBuffetPlateList(listaId).then((l) => { if (ok) setIdsDaLista([...new Set(l.items.map((i) => i.itemId))]); }).catch(() => { if (ok) setIdsDaLista([]); });
    return () => { ok = false; };
  }, [listaId]);

  useEffect(() => {
    let ok = true;
    getBuffetPots(true).then((p) => { if (ok) setPanelas(p); }).catch(() => { if (ok) setErro("Não foi possível carregar as panelas."); });
    return () => { ok = false; };
  }, [versao]);
  useEffect(() => {
    if (!ativa) return undefined;
    let ok = true;
    // Limpa antes de buscar: senão o resumo do dia anterior fica na tela com a data nova.
    setDia(null);
    setErro(null);
    getBuffetWeighings(data, tipo).then((d) => { if (ok) setDia(d); }).catch((x) => { if (ok) setErro(x instanceof Error ? x.message : "Não foi possível carregar as pesagens."); });
    return () => { ok = false; };
  }, [ativa, data, tipo, versao]);
  // Panela escolhida que foi inativada (ou sumiu) não vale mais: volta para a primeira ativa.
  useEffect(() => {
    if (panelasAtivas.some((p) => p.id === potId)) return;
    setPotId(panelasAtivas[0]?.id ?? "");
  }, [panelasAtivas, potId]);

  // Pratos do dia: os da lista e, além deles, qualquer prato que já tenha pesagem.
  const pratosDoDia = useMemo(() => {
    const ids = [...idsDaLista];
    for (const r of dia?.rows ?? []) if (!ids.includes(r.itemId)) ids.push(r.itemId);
    return ids.map((id) => ({ id, nome: porId.get(id)?.namePt ?? dia?.rows.find((r) => r.itemId === id)?.itemName ?? "Prato removido" }));
  }, [idsDaLista, dia, porId]);
  // Estado da ficha (e custo por kg, para quem pode ver) de cada prato do dia, inclusive os ainda sem pesagem.
  const chaveDosPratos = pratosDoDia.map((p) => p.id).join(",");
  useEffect(() => {
    if (!ativa) return undefined;
    if (!chaveDosPratos) { setCustos({}); setCustosStatus("ok"); return undefined; }
    let ok = true;
    setCustosStatus("carregando");
    getBuffetItemCosts(chaveDosPratos.split(",")).then((c) => { if (ok) { setCustos(c); setCustosStatus("ok"); } }).catch(() => { if (ok) setCustosStatus("erro"); });
    return () => { ok = false; };
  }, [ativa, chaveDosPratos, versao]);
  const resultadoBusca = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return t.length < 2 ? [] : catalogo.filter((p) => p.isActive && p.namePt.toLowerCase().includes(t)).slice(0, 8);
  }, [busca, catalogo]);

  const panelaEscolhida = panelasAtivas.find((p) => p.id === potId);
  const brutoG = lerKg(bruto);
  const liquidoG = brutoG !== null && panelaEscolhida ? brutoG - panelaEscolhida.tareG : null;
  const abaixoDaPanela = liquidoG !== null && liquidoG < 0;
  const nomeDoPrato = itemId ? (porId.get(itemId)?.namePt ?? "") : "";

  const lancar = async () => {
    if (enviando.current) return;
    if (!itemId) return setErro("Escolha o prato.");
    if (!panelaEscolhida) return setErro("Escolha a panela.");
    if (brutoG === null) return setErro("Informe o peso bruto da balança em kg, por exemplo 10,4.");
    if (abaixoDaPanela) return setErro(`O peso informado é menor que o da panela ${panelaEscolhida.code} vazia (${kgTexto(panelaEscolhida.tareG)}). Confira a panela e a balança.`);
    enviando.current = true;
    setOcupado(true);
    setErro(null);
    try {
      await createBuffetWeighing({ servedOn: data, kind: tipo, itemId, potId: panelaEscolhida.id, phase: fase, grossG: brutoG });
      setBruto("");
      recarregar();
    } catch (x) { setErro(x instanceof Error ? x.message : "Não foi possível lançar a pesagem."); } finally { enviando.current = false; setOcupado(false); }
  };
  const apagar = async (id: string) => {
    setOcupado(true);
    setErro(null);
    try { await deleteBuffetWeighing(id); recarregar(); } catch (x) { setErro(x instanceof Error ? x.message : "Não foi possível apagar."); } finally { setOcupado(false); }
  };

  // Folha impressa: portal só durante a impressão, A4 deitado.
  useEffect(() => {
    if (!imprimindo) return undefined;
    const estilo = document.createElement("style");
    estilo.textContent = "@page { size: A4 landscape; margin: 10mm; }";
    document.head.appendChild(estilo);
    document.body.classList.add("imprimindo-pesagem");
    let vivo = true;
    const terminar = () => { if (vivo) setImprimindo(0); };
    window.addEventListener("afterprint", terminar);
    const espera = window.setTimeout(() => {
      window.print();
      window.setTimeout(() => { if (vivo) window.addEventListener("focus", terminar, { once: true }); }, 1000);
    }, 0);
    return () => {
      vivo = false;
      window.clearTimeout(espera);
      window.removeEventListener("afterprint", terminar);
      window.removeEventListener("focus", terminar);
      document.body.classList.remove("imprimindo-pesagem");
      estilo.remove();
    };
  }, [imprimindo]);

  const resumoPorPrato = useMemo(() => new Map((dia?.summary.items ?? []).map((i) => [i.itemId, i])), [dia]);
  const valorPorPrato = useMemo(() => new Map((dia?.value?.items ?? []).map((i) => [i.itemId, i])), [dia]);
  const nomeTipo = TIPOS_LISTA.find((t) => t.value === tipo)?.label ?? "";
  const listaNome = listasDoTipo.find((l) => l.id === listaId)?.name ?? null;
  const podeLancar = podeCriar && panelasAtivas.length > 0;

  return (
    <div className="pes">
      {erro && <Alert tone="error">{erro}</Alert>}

      <section className="plq-bloco" aria-labelledby="pes-dia">
        <h3 className="plq-bloco-titulo" id="pes-dia">Dia da pesagem</h3>
        <div className="plq-campos pes-filtros">
          <TextField label="Data" type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} />
          <Select label="Tipo" value={tipo} options={TIPOS_LISTA} onChange={(e) => setTipo(e.target.value as PlateListKind)} />
          <Select label="Lista de plaquinhas do dia" value={listaId} onChange={(e) => setListaId(e.target.value)}
            options={[{ value: "", label: listasDoTipo.length ? "Sem lista (só os pratos pesados)" : "Nenhuma lista salva deste tipo" }, ...listasDoTipo.map((l) => ({ value: l.id, label: l.eventDate ? `${l.name} · ${dataBr(l.eventDate)}` : l.name }))]} />
        </div>
        <div className="plq-linha">
          <Button variant="secondary" leadingIcon={<Printer size={16} aria-hidden="true" />} disabled={!pratosDoDia.length || !panelasAtivas.length}
            title={!panelasAtivas.length ? "Cadastre as panelas primeiro" : !pratosDoDia.length ? "Escolha uma lista de plaquinhas" : undefined}
            onClick={() => setImprimindo((n) => n + 1)}>Imprimir folha de pesagem</Button>
        </div>
      </section>

      {podeLancar ? (
        <section className="plq-bloco" aria-labelledby="pes-lancar">
          <h3 className="plq-bloco-titulo" id="pes-lancar">Lançar peso</h3>
          <div className="pes-chips" role="group" aria-label="Pratos do dia">
            {pratosDoDia.length === 0 && <p className="plq-vazio">Escolha uma lista de plaquinhas acima, ou busque o prato abaixo.</p>}
            {pratosDoDia.map((p) => (
              <button key={p.id} type="button" className="pes-chip" aria-pressed={itemId === p.id} onClick={() => setItemId(p.id)}>{p.nome}</button>
            ))}
          </div>
          <TextField label="Outro prato do catálogo" value={busca} placeholder="Digite parte do nome" onChange={(e) => setBusca(e.target.value)} />
          {resultadoBusca.length > 0 && (
            <ul className="pes-busca">
              {resultadoBusca.map((p) => <li key={p.id}><button type="button" onClick={() => { setItemId(p.id); setBusca(""); }}>{p.namePt}</button></li>)}
            </ul>
          )}
          <p className="pes-escolhido" aria-live="polite">{nomeDoPrato ? <>Prato: <strong>{nomeDoPrato}</strong></> : "Nenhum prato escolhido."}</p>
          <div className="plq-campos">
            <Select label="Panela" value={potId} onChange={(e) => setPotId(e.target.value)}
              options={panelasAtivas.map((p) => ({ value: p.id, label: `${p.code} · vazia ${kgTexto(p.tareG)}` }))} />
            <TextField label="Peso bruto da balança (kg)" inputMode="decimal" value={bruto} placeholder="10,4" onChange={(e) => setBruto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !ocupado) void lancar(); }}
              error={abaixoDaPanela && panelaEscolhida ? `Menor que a panela vazia (${kgTexto(panelaEscolhida.tareG)})` : undefined}
              hint={liquidoG !== null && !abaixoDaPanela ? `Líquido: ${kgTexto(liquidoG)}` : "Panela cheia na balança, sem tarar"} />
          </div>
          <div className="plq-segmento" role="group" aria-label="Etapa">
            {FASES.map((f) => <button key={f.value} type="button" aria-pressed={fase === f.value} onClick={() => setFase(f.value)}>{f.label}</button>)}
          </div>
          <Button disabled={ocupado || abaixoDaPanela} onClick={() => void lancar()}>Lançar</Button>
        </section>
      ) : podeCriar && <Alert tone="info">Cadastre ao menos uma panela (com o peso vazio) para lançar pesagens.</Alert>}

      <section className="plq-bloco" aria-labelledby="pes-resumo">
        <h3 className="plq-bloco-titulo" id="pes-resumo"><span>Resumo de {dataBr(data)}</span><span>{nomeTipo}</span></h3>
        {!dia || dia.rows.length === 0 ? (
          <EmptyState title="Nenhuma pesagem neste dia" description="Pese as panelas cheias, anote o peso bruto e lance aqui. Depois pese a sobra no fim do serviço." />
        ) : (
          <>
            <p className="pes-total">
              Produzido <strong>{kgTexto(dia.summary.producedG)}</strong> · Sobra <strong>{kgTexto(dia.summary.leftoverG)}</strong> · Consumido <strong>{kgTexto(dia.summary.consumedG)}</strong>
            </p>
            {dia.value && dia.value.itemsWithCost === 0 && (
              <p className="pes-total pes-aviso-custo" data-testid="pes-valor-dia">Nenhum prato pesado tem ficha pronta, então ainda não há custo do dia. Ligue as fichas no bloco abaixo.</p>
            )}
            {dia.value && dia.value.itemsWithCost > 0 && (
              <p className="pes-total" data-testid="pes-valor-dia">
                Investido (produzido) <strong><Money value={dia.value.producedCost} /></strong> · Sobra <strong><Money value={dia.value.leftoverCost} /></strong> · Consumido <strong><Money value={dia.value.consumedCost} /></strong>
                {dia.value.itemsWithCost < dia.value.itemsTotal && (
                  <small className="pes-aviso-custo"> — só {dia.value.itemsWithCost} de {dia.value.itemsTotal} pratos têm custo; os demais ficam fora destes totais</small>
                )}
              </p>
            )}
            <div className="pes-tabela-rolagem">
              <table className="pes-tabela">
                <thead><tr><th>Prato</th><th>Produzido</th><th>Sobra</th><th>Consumido</th>{dia.value && <th>Custo produzido</th>}</tr></thead>
                <tbody>
                  {pratosDoDia.filter((p) => resumoPorPrato.has(p.id)).map((p) => {
                    const r = resumoPorPrato.get(p.id);
                    if (!r) return null;
                    return (
                      <tr key={p.id} className={r.inconsistent ? "pes-alerta" : ""}>
                        <td>{p.nome}{r.inconsistent && <small> — sobra maior que o produzido: confira as pesagens</small>}</td>
                        <td>{kgTexto(r.producedG)}</td><td>{kgTexto(r.leftoverG)}</td><td>{r.consumedG === null ? "—" : kgTexto(r.consumedG)}</td>
                        {dia.value && <td>{valorPorPrato.get(p.id)?.producedCost == null ? <small title="Sem ficha pronta">sem custo</small> : <Money value={valorPorPrato.get(p.id)?.producedCost} />}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="pes-lancamentos">
              <summary>{dia.rows.length} lançamento{dia.rows.length === 1 ? "" : "s"}</summary>
              <ul>
                {dia.rows.map((r) => (
                  <li key={r.id}>
                    <span>{r.itemName} · {r.phase === "SOBRA" ? "sobra" : "produção"} · {r.potCode}</span>
                    <span>{kgTexto(r.grossG)} − {kgTexto(r.tareG)} = <strong>{kgTexto(r.netG)}</strong></span>
                    {podeExcluir && (
                      <Button size="sm" variant="secondary" aria-label={`Apagar lançamento de ${r.itemName}`} leadingIcon={<Trash2 size={14} aria-hidden="true" />}
                        disabled={ocupado} onClick={() => void apagar(r.id)}>Apagar</Button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>

      <FichasDosPratos pratos={pratosDoDia} custos={custos} verCusto={dia?.costVisible ?? false} status={custosStatus} podeCriar={podeCriar} podeEditar={podeEditar} aoMudar={recarregar} />

      <PanelasBuffet panelas={panelas} podeCriar={podeCriar} podeEditar={podeEditar} aoMudar={recarregar} />

      {imprimindo > 0 && createPortal(
        <div className="pes-area-impressao" aria-hidden="true">
          <FolhaPesagem dataTexto={dataBr(data)} tipoTexto={nomeTipo} listaNome={listaNome} pratos={pratosDoDia} panelas={panelasAtivas} />
        </div>, document.body)}
    </div>
  );
}
