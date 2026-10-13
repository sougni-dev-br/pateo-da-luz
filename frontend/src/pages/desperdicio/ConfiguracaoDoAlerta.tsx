import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getWasteSettings, saveWasteSettings, type WasteSettings } from "../../api/client";
import { Button, TextField } from "../../design-system";
import { pareceMilhar } from "./motivos";

const formatoLimite = (valor: number | null) => (valor == null ? "" : valor.toFixed(2).replace(".", ","));
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Limite diário do aviso por WhatsApp. Só aparece para quem administra o módulo. */
export function ConfiguracaoDoAlerta() {
  const [config, setConfig] = useState<WasteSettings | null>(null);
  const [falhouAoLer, setFalhouAoLer] = useState(false);
  const [limite, setLimite] = useState("");
  const [erroDoCampo, setErroDoCampo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // O resultado fica aqui, junto do campo: o aviso global rolaria a página para o topo, longe de onde o admin está.
  const [resultado, setResultado] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(() => {
    let atual = true;
    setFalhouAoLer(false);
    getWasteSettings()
      .then((c) => { if (atual) { setConfig(c); setLimite(formatoLimite(c.dailyAlertValue)); } })
      .catch(() => { if (atual) setFalhouAoLer(true); });
    return () => { atual = false; };
  }, []);

  useEffect(() => carregar(), [carregar]);

  // Quem administra precisa saber que a configuração não carregou: sumir daria a entender que o aviso não existe.
  if (falhouAoLer) {
    return (
      <div className="waste-config waste-config-erro" role="alert">
        <span>Não foi possível carregar a configuração do aviso por WhatsApp.</span>
        <Button variant="secondary" onClick={() => carregar()}>Tentar de novo</Button>
      </div>
    );
  }
  if (!config) return null;

  async function salvar(event: React.FormEvent) {
    event.preventDefault();
    // "1.500" seria gravado como R$ 1,50 e a confirmação diria que deu certo.
    if (pareceMilhar(limite)) {
      setErroDoCampo("Use vírgula para os centavos (1500 ou 1500,50). \"1.500\" é ambíguo.");
      return;
    }
    setErroDoCampo(null);
    setResultado(null);
    setSalvando(true);
    try {
      const salvo = await saveWasteSettings(limite);
      setConfig((atual) => (atual ? { ...atual, dailyAlertValue: salvo.dailyAlertValue } : atual));
      setLimite(formatoLimite(salvo.dailyAlertValue));
      setResultado({ tom: "ok", texto: salvo.dailyAlertValue == null ? "Aviso de desperdício desligado." : `Limite do aviso salvo: ${reais.format(salvo.dailyAlertValue)} por dia.` });
    } catch (falha) {
      setResultado({ tom: "erro", texto: falha instanceof Error ? falha.message : "Não foi possível salvar o limite." });
    } finally {
      setSalvando(false);
    }
  }

  const semDestinatario = config.dailyAlertValue != null && config.activeRecipients === 0;
  return (
    <details className="waste-config">
      <summary>Aviso por WhatsApp {config.dailyAlertValue != null ? `· limite diário ${reais.format(config.dailyAlertValue)}` : "· desligado"}</summary>
      <form onSubmit={salvar} noValidate>
        <TextField
          label="Avisar quando o desperdício do dia chegar a (R$)"
          inputMode="decimal"
          value={limite}
          onChange={(event) => setLimite(event.target.value)}
          placeholder="Vazio = não avisar"
          hint="Um aviso por dia, para os destinatários ativos das notificações. Só conta lançamentos com custo conhecido."
          error={erroDoCampo ?? undefined}
          autoComplete="off"
        />
        {semDestinatario && (
          <p className="waste-error" role="alert">
            Nenhum destinatário ativo: o aviso não terá para quem ir. Cadastre em <Link to="/configuracoes/notificacoes">Notificações WhatsApp</Link>.
          </p>
        )}
        <Button type="submit" variant="secondary" disabled={salvando}>{salvando ? "Salvando…" : "Salvar limite"}</Button>
        {resultado && <p className={resultado.tom === "erro" ? "waste-error" : "waste-ok"} role={resultado.tom === "erro" ? "alert" : "status"}>{resultado.texto}</p>}
      </form>
    </details>
  );
}
