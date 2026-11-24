import { useEffect, useState } from "react";
import { createPlanejamentoCenario } from "../../api/client";
import { Dialog } from "../../components/ui/Dialog";
import { Alert, Button, FormGrid, TextField } from "../../design-system";
import { useDialogoAcessivel } from "./useDialogoAcessivel";
import { mensagemHumana } from "./erros";

// Cria um cenário vazio (premissas em 0%, linhas de gasto padrão). O erro do servidor (ex.: nome repetido) fica no
// diálogo, com o que foi digitado preservado.

const mensagemDe = (e: unknown) => mensagemHumana(e, "Não foi possível criar o cenário.");

type Props = { aberto: boolean; anoSugerido: number; onFechar: () => void; onCriado: (id: string) => Promise<void> };

export function NovoCenarioDialog({ aberto, anoSugerido, onFechar, onCriado }: Props) {
  useDialogoAcessivel(aberto);
  const [nome, setNome] = useState("");
  const [ano, setAno] = useState(String(anoSugerido));
  const [anoBase, setAnoBase] = useState(String(anoSugerido - 1));
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setNome("");
    setAno(String(anoSugerido));
    setAnoBase(String(anoSugerido - 1));
    setErro(null);
  }, [aberto, anoSugerido]);

  const baseDepoisDoAno = ano.length === 4 && anoBase.length === 4 && Number(anoBase) >= Number(ano);

  async function criar() {
    setGravando(true);
    setErro(null);
    try {
      const criado = await createPlanejamentoCenario({ ano: Number(ano), anoBase: Number(anoBase), nome: nome.trim() });
      await onCriado(criado.id);
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title="Novo cenário" description="Começa com todas as premissas em 0%: o resultado igual ao ano-base." size="sm">
      <form className="plan-form-dialogo" onSubmit={(e) => { e.preventDefault(); void criar(); }}>
        <FormGrid>
          <TextField label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} hint="Ex.: Conservador, Otimista" autoFocus required />
          <TextField label="Ano projetado" inputMode="numeric" value={ano} onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))} required />
          <TextField
            label="Ano-base (real)"
            inputMode="numeric"
            value={anoBase}
            onChange={(e) => setAnoBase(e.target.value.replace(/\D/g, "").slice(0, 4))}
            error={baseDepoisDoAno ? "O ano-base precisa ser anterior ao ano projetado." : undefined}
            required
          />
        </FormGrid>
        {erro && <Alert tone="error" role="alert">{erro}</Alert>}
        <div className="plan-dialogo-acoes">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={gravando || nome.trim() === "" || ano.length !== 4 || anoBase.length !== 4 || baseDepoisDoAno}>{gravando ? "Criando…" : "Criar cenário"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
