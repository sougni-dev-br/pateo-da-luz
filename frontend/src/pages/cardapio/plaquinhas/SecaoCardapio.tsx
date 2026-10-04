import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { BuffetMenuItem, BuffetMenuSection, BuffetPlateItem, MenuFace } from "../../../api/client";
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
  porNome: Map<string, BuffetPlateItem>;
  idLista: string;
  mostrarErros: boolean;
  onMudar: (s: SecaoEdit) => void;
  onMover: (delta: number) => void;
  onRemover: () => void;
};

const falta = (s: string) => s.trim().length < 2;

export function SecaoCardapio({ secao, indice, total, porNome, idLista, mostrarErros, onMudar, onMover, onRemover }: Props) {
  const mudarItem = (chave: string, parcial: Partial<BuffetMenuItem>) =>
    onMudar({ ...secao, items: secao.items.map((it) => (it.chave === chave ? { ...it, ...parcial } : it)) });

  // Ao sair do campo: arruma o nome e, se for um prato do catálogo, traz o inglês (se ainda vazio).
  // Não é feito a cada tecla: "Arroz" puxaria o inglês de "Arroz" antes de terminar "Arroz de forno".
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
  return (
    <section className="cdp-ed-secao" aria-label={rotulo}>
      <div className="cdp-ed-secao-topo">
        <div className="cdp-ed-face" role="group" aria-label={`Em que face fica ${rotulo}`}>
          {(["front", "back"] as MenuFace[]).map((f) => (
            <button key={f} type="button" aria-pressed={secao.face === f} onClick={() => onMudar({ ...secao, face: f })}>{f === "front" ? "Frente" : "Verso"}</button>
          ))}
        </div>
        <span className="cdp-ed-acoes">
          <button type="button" aria-label={`Subir ${rotulo}`} disabled={indice === 0} onClick={() => onMover(-1)}><ArrowUp size={16} /></button>
          <button type="button" aria-label={`Descer ${rotulo}`} disabled={indice === total - 1} onClick={() => onMover(1)}><ArrowDown size={16} /></button>
          <button type="button" aria-label={`Apagar a seção ${rotulo}`} className="plq-tirar" onClick={onRemover}><Trash2 size={16} /></button>
        </span>
      </div>
      <div className="cdp-ed-dupla">
        <label>Título
          <input value={secao.titlePt} maxLength={60} onChange={(e) => onMudar({ ...secao, titlePt: e.target.value })}
            onBlur={() => onMudar({ ...secao, titlePt: arrumarNome(secao.titlePt) })} aria-invalid={mostrarErros && falta(secao.titlePt)} />
        </label>
        <label>Em inglês
          <input value={secao.titleEn} maxLength={60} lang="en" onChange={(e) => onMudar({ ...secao, titleEn: e.target.value })} aria-invalid={mostrarErros && falta(secao.titleEn)} />
        </label>
      </div>
      <ol className="cdp-ed-itens">
        {secao.items.map((it, i) => (
          <li key={it.chave}>
            <div className="cdp-ed-dupla">
              {/* Prato recém-criado (vazio) já recebe o cursor ao aparecer. */}
              <input value={it.namePt} maxLength={160} list={idLista} autoFocus={!it.namePt && !it.nameEn} placeholder="Prato, ex.: Risoto de funghi" aria-label={`Prato ${i + 1} de ${rotulo}`}
                onChange={(e) => mudarItem(it.chave, { namePt: e.target.value })} onBlur={() => aoSairDoPt(it)}
                aria-invalid={mostrarErros && falta(it.namePt)} />
              <input value={it.nameEn} maxLength={160} lang="en" placeholder="In English" aria-label={`Prato ${i + 1} de ${rotulo} em inglês`}
                onChange={(e) => mudarItem(it.chave, { nameEn: e.target.value })} aria-invalid={(mostrarErros || it.namePt.trim().length > 1) && falta(it.nameEn)} />
            </div>
            <span className="cdp-ed-acoes">
              <button type="button" aria-label={`Subir prato ${i + 1}`} disabled={i === 0} onClick={() => moverItem(i, -1)}><ArrowUp size={14} /></button>
              <button type="button" aria-label={`Descer prato ${i + 1}`} disabled={i === secao.items.length - 1} onClick={() => moverItem(i, 1)}><ArrowDown size={14} /></button>
              <button type="button" aria-label={`Tirar prato ${i + 1}`} className="plq-tirar" onClick={() => onMudar({ ...secao, items: secao.items.filter((x) => x.chave !== it.chave) })}><X size={14} /></button>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="plq-link" disabled={secao.items.length >= MAX_PRATOS_SECAO} onClick={() => onMudar({ ...secao, items: [...secao.items, itemVazio()] })}>
        <Plus size={14} aria-hidden="true" /> {secao.items.length >= MAX_PRATOS_SECAO ? `Limite de ${MAX_PRATOS_SECAO} pratos na seção` : `Prato em ${rotulo}`}
      </button>
    </section>
  );
}
