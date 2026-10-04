import { useEffect, useState, type FormEvent } from "react";
import { getEventSettings, saveEventSettings } from "../../../api/client";
import { Alert, Button, TextField } from "../../../design-system";

// Limites da sugestão de buffet e capacidade do salão. Mudar isso muda a sugestão de todos os dias.
export function ConfigEventos({ podeAlterar }: { podeAlterar: boolean }) {
  const [pequeno, setPequeno] = useState("");
  const [grande, setGrande] = useState("");
  const [capacidade, setCapacidade] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    getEventSettings()
      .then((c) => { setPequeno(String(c.smallMaxLunch)); setGrande(String(c.largeMinLunch)); setCapacidade(c.lunchCapacity ? String(c.lunchCapacity) : ""); })
      .catch((x) => setErro(x instanceof Error ? x.message : "Não foi possível carregar a configuração."));
  }, []);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const p = Number(pequeno);
    const g = Number(grande);
    if (!Number.isInteger(p) || !Number.isInteger(g) || p < 1 || g <= p) return setErro("O limite do Grande tem de ser maior que o do Pequeno.");
    setSalvando(true);
    setErro(null);
    setOk(false);
    try {
      await saveEventSettings({ smallMaxLunch: p, largeMinLunch: g, lunchCapacity: capacidade.trim() ? Number(capacidade) : null });
      setOk(true);
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="evt-bloco evt-form evt-config" onSubmit={salvar}>
      <h3 className="evt-secao">Tamanho do buffet pela previsão de almoços</h3>
      <div className="evt-form-linha">
        <TextField label="Pequeno: até" type="number" min={1} value={pequeno} disabled={!podeAlterar} onChange={(e) => setPequeno(e.target.value)} hint="almoços previstos" />
        <TextField label="Grande: acima de" type="number" min={1} value={grande} disabled={!podeAlterar} onChange={(e) => setGrande(e.target.value)} hint="almoços previstos" />
      </div>
      <p className="evt-base">Entre os dois limites, a sugestão é Médio.</p>
      <h3 className="evt-secao">Salão</h3>
      <TextField label="Lugares no almoço, contando o giro das mesas" type="number" min={1} value={capacidade} disabled={!podeAlterar}
        onChange={(e) => setCapacidade(e.target.value)} hint="Vai servir de base para a regra de aceitar reservas. Pode deixar em branco por enquanto." />
      {!podeAlterar && <Alert tone="info">Só quem administra o módulo muda a configuração.</Alert>}
      {erro && <Alert tone="error">{erro}</Alert>}
      {ok && <Alert tone="success">Configuração salva. A sugestão dos dias já usa os novos limites.</Alert>}
      {podeAlterar && <div className="evt-form-acoes"><Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button></div>}
    </form>
  );
}
