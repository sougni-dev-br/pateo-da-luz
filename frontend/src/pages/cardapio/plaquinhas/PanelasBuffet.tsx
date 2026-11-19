import { Power, Save } from "lucide-react";
import { useState } from "react";
import { saveBuffetPot, type BuffetPot } from "../../../api/client";
import { Alert, Button, TextField } from "../../../design-system";
import { kgCampo, kgTexto, lerKg } from "./pesagemFormato";

type Props = {
  panelas: BuffetPot[];
  podeCriar: boolean;
  podeEditar: boolean;
  aoMudar: () => void;
};

// Cadastro das panelas: código (o que está escrito nela) e o peso vazio. O sistema abate esse peso
// do que a balança mostrou, então ninguém precisa tarar. Mudar o peso não altera pesagens antigas.
export function PanelasBuffet({ panelas, podeCriar, podeEditar, aoMudar }: Props) {
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [peso, setPeso] = useState("");
  const [editando, setEditando] = useState<{ id: string; peso: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const executar = async (acao: () => Promise<unknown>) => {
    setOcupado(true);
    setErro(null);
    try { await acao(); aoMudar(); } catch (x) { setErro(x instanceof Error ? x.message : "Não foi possível salvar a panela."); } finally { setOcupado(false); }
  };

  const cadastrar = () => {
    const tareG = lerKg(peso);
    if (!codigo.trim()) return setErro("Informe o código da panela (o que está escrito nela).");
    if (!tareG) return setErro("Informe o peso da panela vazia em kg, por exemplo 2,35.");
    void executar(async () => {
      await saveBuffetPot({ code: codigo.trim(), name: nome.trim() || null, tareG });
      setCodigo(""); setNome(""); setPeso("");
    });
  };
  const salvarPeso = (p: BuffetPot) => {
    const tareG = lerKg(editando?.peso ?? "");
    if (!tareG) return setErro("Informe o peso da panela vazia em kg, por exemplo 2,35.");
    void executar(async () => { await saveBuffetPot({ tareG }, p.id); setEditando(null); });
  };

  return (
    <section className="plq-bloco" aria-labelledby="pes-panelas">
      <h3 className="plq-bloco-titulo" id="pes-panelas">Panelas e peso vazio</h3>
      <p className="plq-contagem">Pese cada panela vazia uma vez e escreva o código nela. Na pesagem, o sistema abate esse peso sozinho.</p>
      {erro && <Alert tone="error">{erro}</Alert>}
      {podeCriar && (
        <div className="plq-campos pes-nova-panela">
          <TextField label="Código" value={codigo} maxLength={20} placeholder="P01" onChange={(e) => { setCodigo(e.target.value); setErro(null); }} />
          <TextField label="Peso vazia (kg)" inputMode="decimal" value={peso} placeholder="2,35" onChange={(e) => { setPeso(e.target.value); setErro(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") cadastrar(); }} />
          <TextField label="Descrição (opcional)" value={nome} maxLength={80} placeholder="Ex.: inox 10 L" onChange={(e) => setNome(e.target.value)} />
          <Button disabled={ocupado} onClick={cadastrar}>Cadastrar panela</Button>
        </div>
      )}
      {panelas.length === 0 ? <p className="plq-vazio">Nenhuma panela cadastrada ainda.</p> : (
        <ul className="pes-panelas">
          {panelas.map((p) => (
            <li key={p.id} className={p.isActive ? "" : "pes-inativa"}>
              <strong>{p.code}</strong>
              <span className="pes-panela-nome">{p.name ?? ""}{p.isActive ? "" : " · inativa"}</span>
              {editando?.id === p.id ? (
                <>
                  <input aria-label={`Peso vazio da panela ${p.code} em kg`} inputMode="decimal" value={editando.peso} className="pes-peso-campo"
                    onChange={(e) => setEditando({ id: p.id, peso: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") salvarPeso(p); if (e.key === "Escape") setEditando(null); }} />
                  <Button size="sm" leadingIcon={<Save size={14} aria-hidden="true" />} disabled={ocupado} onClick={() => salvarPeso(p)}>Salvar</Button>
                </>
              ) : (
                <>
                  <span className="pes-peso">{kgTexto(p.tareG)}</span>
                  {podeEditar && <Button size="sm" variant="secondary" onClick={() => setEditando({ id: p.id, peso: kgCampo(p.tareG) })}>Re-pesar</Button>}
                </>
              )}
              {podeEditar && (
                <Button size="sm" variant="secondary" leadingIcon={<Power size={14} aria-hidden="true" />} disabled={ocupado}
                  onClick={() => void executar(() => saveBuffetPot({ isActive: !p.isActive }, p.id))}>{p.isActive ? "Inativar" : "Reativar"}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
