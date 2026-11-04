// Ponto → Importar relógio: lê o arquivo AFD do REP-P (Portaria 671) exportado pelo RHiD.
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { type ResultadoImportacaoAfd, importarAfdPonto } from "../../../api/client";
import { Alert, Button } from "../../../design-system";
import { MESES } from "./pontoFormato";

const LIMITE_BYTES = 5_000_000;

type Props = {
  onImportou: () => void;
  onVerMes: (year: number, month: number) => void;
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function ImportarRelogio({ onImportou, onVerMes }: Props) {
  const campo = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacaoAfd | null>(null);

  const enviar = async (arquivo: File) => {
    setErro(null);
    setResultado(null);
    if (arquivo.name.toLowerCase().endsWith(".zip")) {
      setErro("Esse arquivo está compactado. Extraia o .zip e escolha o arquivo .txt de dentro.");
      return;
    }
    if (arquivo.size > LIMITE_BYTES) {
      setErro("Arquivo grande demais para importar de uma vez. Exporte um período menor.");
      return;
    }
    setEnviando(true);
    try {
      setResultado(await importarAfdPonto(await arquivo.text()));
      onImportou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui importar o arquivo.");
    } finally {
      setEnviando(false);
      if (campo.current) campo.current.value = "";
    }
  };

  const nadaLido = resultado !== null && resultado.pessoas === 0 && resultado.diasGravados === 0 && resultado.diasIguais === 0;
  const mesDoArquivo = resultado?.de ? { year: Number(resultado.de.slice(0, 4)), month: Number(resultado.de.slice(5, 7)) } : null;

  return (
    <div className="po-importar">
      <ol className="po-passos">
        <li>No RHiD, abra <strong>Fiscalização → Exportar AFDT</strong> (recomendado: já traz as batidas incluídas à mão e descarta as duplicadas), escolha o período e gere o arquivo. O <strong>Exportar AFD</strong> também funciona, mas traz só as batidas brutas do relógio.</li>
        <li>O download vem compactado: extraia o <strong>.txt</strong> de dentro.</li>
        <li>Envie o .txt aqui. Pode enviar o mesmo arquivo de novo: nada é duplicado.</li>
      </ol>
      <p className="po-ajuda">Dias digitados à mão ou lançados no papel não são sobrescritos pelo relógio.</p>

      <input
        ref={campo}
        type="file"
        accept=".txt,text/plain"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviar(f); }}
      />
      <Button leadingIcon={<Upload size={16} />} aria-disabled={enviando || undefined} aria-busy={enviando} onClick={() => { if (!enviando) campo.current?.click(); }}>
        {enviando ? "Importando…" : "Escolher o arquivo do relógio (.txt)"}
      </Button>

      {erro ? <Alert tone="error" role="alert">{erro}</Alert> : null}
      {resultado ? (
        <div className="po-resultado">
          <Alert tone={nadaLido ? "error" : resultado.conflitos > 0 || resultado.cpfsSemCadastro > 0 || resultado.avisos.length > 0 ? "warning" : "success"} title={nadaLido ? "Nada foi importado" : "Importação concluída"}>
            {nadaLido
              ? "Não encontrei marcações de pessoas cadastradas. Confira se é o arquivo AFDT (ou AFD) do RHiD e se o PIS (AFDT) ou o CPF (AFD) das pessoas está no cadastro."
              : `${plural(resultado.pessoas, "pessoa", "pessoas")}, ${plural(resultado.diasGravados, "dia gravado", "dias gravados")}, ${plural(resultado.diasIguais, "dia que já estava igual", "dias que já estavam iguais")}.`}
          </Alert>
          <ul className="po-lista-resultado">
            {resultado.conflitos > 0 ? <li>{plural(resultado.conflitos, "dia mantido", "dias mantidos")} porque já tinham lançamento de papel ou correção manual.</li> : null}
            {resultado.mesesFechados > 0 ? <li>{plural(resultado.mesesFechados, "dia ignorado", "dias ignorados")} por estarem em mês fechado.</li> : null}
            {resultado.cpfsSemCadastro > 0 ? <li>{resultado.cpfsSemCadastro === 1 ? "1 CPF do relógio não está" : `${resultado.cpfsSemCadastro} CPFs do relógio não estão`} no cadastro de funcionários.</li> : null}
            {resultado.avisos.map((a) => <li key={a}>{a}</li>)}
          </ul>
          {mesDoArquivo && !nadaLido ? (
            <Button variant="secondary" onClick={() => onVerMes(mesDoArquivo.year, mesDoArquivo.month)}>
              Ver o fechamento de {MESES[mesDoArquivo.month - 1]} de {mesDoArquivo.year}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
