import { ArrowDown, ArrowUp, BookPlus, ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { BuffetMenuItem, BuffetMenuSection, BuffetPlateItem, MenuFace } from "../../../api/client";
import { BuscaPratoCardapio } from "./BuscaPratoCardapio";
import { arrumarNome, semAcento } from "./plaquinhasFormato";

// Seção em edição: chaves estáveis para o React não trocar o campo de lugar ao reordenar.
export type ItemEdit = BuffetMenuItem & { chave: string };
export type SecaoEdit = Omit<BuffetMenuSection, "items"> & { chave: string; items: ItemEdit[] };

export const MAX_PRATOS_SECAO = 20;

let seq = 0;
export const chaveNova = () => `c${++seq}`;
export const itemVazio = (): ItemEdit => ({ chave: chaveNova(), namePt: "", nameEn: "" });

type Props = {
  secao: SecaoEdit;
  indice: number;
  total: number;
  catalogo: BuffetPlateItem[];
  porNome: Map<string, BuffetPlateItem>;
  podeCadastrar: boolean;
  mostrarErros: boolean;
  /** No "um display por seção/prato" a seção ocupa as duas faces: não há frente ou verso a escolher. */
  mostrarFace: boolean;
  /** Número do primeiro display desta seção (um por seção ou um por prato). */
  primeiroDisplay: number;
  umPorPrato: boolean;
  /** Cardápio aberto do salvo começa com as seções resumidas; seção nova já abre para editar. */
  abertaNoInicio: boolean;
  onMudar: (s: SecaoEdit) => void;
  onMover: (delta: number) => void;
  onRemover: () => void;
  /** Abre o cadastro do catálogo; o prato salvo volta para esta seção. */
  onCadastrar: (pedido: { namePt: string; nameEn: string; substituir?: string }) => void;
};

const falta = (s: string) => s.trim().length < 2;

export function SecaoCardapio(props: Props) {
  const { secao, indice, total, catalogo, porNome, podeCadastrar, mostrarErros, mostrarFace, primeiroDisplay, umPorPrato, abertaNoInicio, onMudar, onMover, onRemover, onCadastrar } = props;
  const [abertaLocal, setAberta] = useState(abertaNoInicio);
  // Com erro para corrigir, a seção abre sozinha: não dá para consertar o que não se vê.
  const temErro = mostrarErros && (falta(secao.titlePt) || falta(secao.titleEn) || !secao.items.length || secao.items.some((i) => falta(i.namePt) || falta(i.nameEn)));
  const aberta = abertaLocal || temErro;
  const mudarItem = (chave: string, parcial: Partial<BuffetMenuItem>) =>
    onMudar({ ...secao, items: secao.items.map((it) => (it.chave === chave ? { ...it, ...parcial } : it)) });
  const jaNaSecao = useMemo(() => new Set(secao.items.map((i) => semAcento(i.namePt.trim()))), [secao.items]);
  const cheia = secao.items.length >= MAX_PRATOS_SECAO;

  // Ao sair do campo: arruma o nome e, se for um prato do catálogo, traz o inglês (se ainda vazio).
  function aoSairDoPt(it: ItemEdit) {
    if (!it.namePt.trim()) return;
    const nome = arrumarNome(it.namePt);
    const doCatalogo = porNome.get(semAcento(nome));
    mudarItem(it.chave, { namePt: nome, ...(doCatalogo && falta(it.nameEn) ? { nameEn: doCatalogo.nameEn } : {}) });
  }

  const moverItem = (i: number, delta: number) => {
    const alvo = i + delta;
    if (alvo < 0 || alvo >= secao.items.length) return;
    const copia = [...secao.items];
    [copia[i], copia[alvo]] = [copia[alvo], copia[i]];
    onMudar({ ...secao, items: copia });
  };

  const rotulo = secao.titlePt.trim() || `Seção ${indice + 1}`;
  const ultimoDisplay = primeiroDisplay + Math.max(secao.items.length, 1) - 1;
  const qualDisplay = umPorPrato && ultimoDisplay > primeiroDisplay ? `Displays ${primeiroDisplay} a ${ultimoDisplay}` : `Display ${primeiroDisplay}`;

  return (
    <section className="cdp-ed-secao" aria-label={rotulo}>
      <div className="cdp-ed-secao-topo">
        {mostrarFace ? (
          <div className="cdp-ed-face" role="group" aria-label={`Em que face fica ${rotulo}`}>
            {(["front", "back"] as MenuFace[]).map((f) => (
              <button key={f} type="button" aria-pressed={secao.face === f} onClick={() => onMudar({ ...secao, face: f })}>{f === "front" ? "Frente" : "Verso"}</button>
            ))}
          </div>
        ) : <span className="cdp-ed-display">{qualDisplay}</span>}
        <span className="cdp-ed-acoes">
          <button type="button" aria-expanded={aberta} aria-label={aberta ? `Recolher ${rotulo}` : `Abrir ${rotulo} para editar`} title={aberta ? "Recolher" : "Editar"}
            onClick={() => setAberta(!aberta)} disabled={temErro}>{aberta ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
          <button type="button" aria-label={`Subir ${rotulo}`} title="Subir a seção" disabled={indice === 0} onClick={() => onMover(-1)}><ArrowUp size={16} /></button>
          <button type="button" aria-label={`Descer ${rotulo}`} title="Descer a seção" disabled={indice === total - 1} onClick={() => onMover(1)}><ArrowDown size={16} /></button>
          <button type="button" aria-label={`Apagar a seção ${rotulo}`} title="Apagar a seção" className="plq-tirar" onClick={onRemover}><Trash2 size={16} /></button>
        </span>
      </div>
      {!aberta && (
        <button type="button" className="cdp-ed-resumo" onClick={() => setAberta(true)}>
          <strong>{rotulo}</strong> <em>{secao.titleEn}</em> · {secao.items.length} {secao.items.length === 1 ? "prato" : "pratos"}
          <span>{secao.items.map((i) => i.namePt).join(", ")}</span>
        </button>
      )}
      {aberta && <>
      <div className="cdp-ed-dupla">
        <label>Título
          <input value={secao.titlePt} maxLength={60} placeholder="Ex.: Bebidas" onChange={(e) => onMudar({ ...secao, titlePt: e.target.value })}
            onBlur={() => onMudar({ ...secao, titlePt: arrumarNome(secao.titlePt) })} aria-invalid={mostrarErros && falta(secao.titlePt)} />
        </label>
        <label>Em inglês
          <input value={secao.titleEn} maxLength={60} lang="en" placeholder="Ex.: Drinks" onChange={(e) => onMudar({ ...secao, titleEn: e.target.value })} aria-invalid={mostrarErros && falta(secao.titleEn)} />
        </label>
      </div>

      {secao.items.length > 0 && (
        <ol className="cdp-ed-itens">
          {secao.items.map((it, i) => {
            const semIngles = (mostrarErros || it.namePt.trim().length > 1) && falta(it.nameEn);
            const foraDoCatalogo = podeCadastrar && it.namePt.trim().length > 1 && !porNome.has(semAcento(it.namePt.trim()));
            return (
              <li key={it.chave} className="cdp-ed-item">
                <div className="cdp-ed-nomes">
                  {/* Prato recém-criado (vazio) já recebe o cursor ao aparecer. */}
                  <input value={it.namePt} maxLength={160} autoFocus={!it.namePt && !it.nameEn} placeholder="Nome do prato" aria-label={`Prato ${i + 1} de ${rotulo}`}
                    onChange={(e) => mudarItem(it.chave, { namePt: e.target.value })} onBlur={() => aoSairDoPt(it)} aria-invalid={mostrarErros && falta(it.namePt)} />
                  <input value={it.nameEn} maxLength={160} lang="en" autoFocus={Boolean(it.namePt) && !it.nameEn} placeholder="Em inglês (obrigatório)"
                    aria-label={`Prato ${i + 1} de ${rotulo} em inglês`} onChange={(e) => mudarItem(it.chave, { nameEn: e.target.value })} aria-invalid={semIngles} />
                </div>
                <span className="cdp-ed-acoes">
                  {foraDoCatalogo && (
                    <button type="button" aria-label={`Cadastrar ${it.namePt.trim()} no catálogo`} title="Cadastrar no catálogo, para usar nas plaquinhas e nos próximos cardápios"
                      onClick={() => onCadastrar({ namePt: it.namePt, nameEn: it.nameEn, substituir: it.chave })}><BookPlus size={15} /></button>
                  )}
                  <button type="button" aria-label={`Subir prato ${i + 1}`} disabled={i === 0} onClick={() => moverItem(i, -1)}><ArrowUp size={14} /></button>
                  <button type="button" aria-label={`Descer prato ${i + 1}`} disabled={i === secao.items.length - 1} onClick={() => moverItem(i, 1)}><ArrowDown size={14} /></button>
                  <button type="button" aria-label={`Tirar prato ${i + 1}`} className="plq-tirar" onClick={() => onMudar({ ...secao, items: secao.items.filter((x) => x.chave !== it.chave) })}><X size={14} /></button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {cheia
        ? <p className="plq-contagem">Limite de {MAX_PRATOS_SECAO} pratos na seção.</p>
        : <BuscaPratoCardapio catalogo={catalogo} jaNaSecao={jaNaSecao} podeCadastrar={podeCadastrar} rotuloSecao={rotulo}
            onEscolher={(p) => onMudar({ ...secao, items: [...secao.items, { chave: chaveNova(), ...p }] })}
            onCadastrar={(texto) => onCadastrar({ namePt: texto, nameEn: "" })} />}
      {mostrarErros && secao.items.length === 0 && <p className="cdp-ed-erro">Procure ou escreva pelo menos um prato.</p>}
      </>}
    </section>
  );
}
