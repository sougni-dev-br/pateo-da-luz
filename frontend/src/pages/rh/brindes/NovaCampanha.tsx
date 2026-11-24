import { useState } from "react";
import { criarCampanhaBrinde } from "../../../api/client";
import { Alert, Button, TextField } from "../../../design-system";

const mensagem = (e: unknown) => (e instanceof Error ? e.message : "Não consegui criar o brinde.");

export function NovaCampanha({ onCriada, onCancelar }: { onCriada: (id: string) => void; onCancelar?: () => void }) {
  const [nome, setNome] = useState("Brinde de Natal");
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const criar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const { id } = await criarCampanhaBrinde({ nome: nome.trim(), ano: Number(ano) });
      onCriada(id);
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form className="br-novo" onSubmit={(ev) => { ev.preventDefault(); void criar(); }}>
      <div className="br-novo-campos">
        <TextField label="Nome do brinde" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} containerClassName="br-novo-nome" />
        <TextField label="Ano" type="number" value={ano} onChange={(e) => setAno(e.target.value)} containerClassName="br-novo-ano" />
      </div>
      <div className="br-novo-acoes">
        <Button size="sm" type="submit" disabled={salvando || nome.trim().length < 2}>{salvando ? "Criando…" : "Criar brinde"}</Button>
        {onCancelar && <Button size="sm" variant="secondary" onClick={onCancelar}>Cancelar</Button>}
      </div>
      {erro && <Alert tone="error">{erro}</Alert>}
    </form>
  );
}
