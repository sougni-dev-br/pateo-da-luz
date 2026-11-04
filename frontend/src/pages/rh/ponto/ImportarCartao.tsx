// Ponto → Importar relógio → Cartão de Ponto (CSV do RHiD): traz as batidas de quem bate ponto no relógio e aponta onde
// folga, banco, feriado, falta e batida divergem da Escala do ERP. A Escala nunca é alterada aqui; só grava depois de confirmar.
import { FileSpreadsheet } from "lucide-react";
import { useRef, useState } from "react";
import { type ResultadoCartaoPonto, importarCartaoPonto } from "../../../api/client";
import { Alert, Button } from "../../../design-system";

const LIMITE_BYTES = 5_000_000;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const NOME_DO_TIPO: Record<string, string> = {
  FOLGA: "folga",
  FOLGA_FERIADO: "folga de feriado",
  FOLGA_BANCO_HORAS: "folga do banco",
  FALTA: "falta",
  TURNO: "turno",
  EVENTO: "evento",
  TRABALHOU: "trabalhou (tem batida)",
  FERIAS: "férias",
  ATESTADO: "atestado",
  AFASTAMENTO: "afastamento",
};
const tipo = (t: string | null) => (t ? (NOME_DO_TIPO[t] ?? t.toLowerCase()) : "sem marca");
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function ImportarCartao({ onImportou }: { onImportou: () => void }) {
  const campo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoCartaoPonto | null>(null);

  const limpar = () => {
    setTexto(null);
    setResultado(null);
    setErro(null);
    if (campo.current) campo.current.value = "";
  };

  const rodar = async (conteudo: string, confirmar: boolean) => {
    setErro(null);
    setOcupado(true);
    try {
      const r = await importarCartaoPonto(conteudo, confirmar);
      setResultado(r);
      if (confirmar) {
        setTexto(null);
        onImportou();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui ler o arquivo.");
    } finally {
      setOcupado(false);
    }
  };

  const escolher = async (arquivo: File) => {
    setResultado(null);
    if (arquivo.size > LIMITE_BYTES) {
      setErro("Arquivo grande demais para importar de uma vez. Exporte um período menor.");
      return;
    }
    const conteudo = await arquivo.text();
    setTexto(conteudo);
    await rodar(conteudo, false);
  };

  const r = resultado;
  const previa = r !== null && !r.gravado;
  const nadaALer = r !== null && r.pessoas === 0;
  const mudaAlgo = r !== null && r.batidas.gravar > 0;

  return (
    <section className="po-importar po-importar--cartao" aria-labelledby="po-cartao-titulo">
      <h3 id="po-cartao-titulo">Cartão de Ponto do RHiD (CSV): folga, banco, feriado e falta</h3>
      <p className="po-ajuda">
        No RHiD, em <strong>Apuração de Ponto</strong>, busque o mês com <strong>todos</strong> os funcionários, clique em <strong>Imprimir</strong>, escolha{" "}
        <strong>Cartão de Ponto</strong>, <strong>Todos os funcionários</strong> e formato <strong>CSV</strong>. Vale só para quem bate ponto no relógio; quem lança papel segue pela Escala.
        Antes de gravar, você vê o que vai mudar.
      </p>

      <input ref={campo} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void escolher(f); }} />
      <Button variant="secondary" leadingIcon={<FileSpreadsheet size={16} />} aria-disabled={ocupado || undefined} aria-busy={ocupado} onClick={() => { if (!ocupado) campo.current?.click(); }}>
        {ocupado && !r ? "Lendo…" : "Escolher o Cartão de Ponto (.csv)"}
      </Button>

      {erro ? <Alert tone="error" role="alert">{erro}</Alert> : null}

      {r ? (
        <div className="po-resultado">
          <Alert
            tone={nadaALer ? "error" : previa ? "info" : "success"}
            title={nadaALer ? "Nada para importar" : previa ? "Prévia: nada foi gravado ainda" : "Importação concluída"}
          >
            {nadaALer
              ? "Não encontrei pessoas do arquivo no cadastro (o CPF precisa bater e a pessoa precisa estar marcada como “Bate ponto”)."
              : `${plural(r.pessoas, "pessoa", "pessoas")}, ${plural(r.batidas.gravar, "dia de batidas", "dias de batidas")} ${previa ? "para gravar" : "gravados"}, ${plural(r.escala.divergentes, "dia diferente da Escala", "dias diferentes da Escala")}.`}
          </Alert>

          {!nadaALer ? (
            <ul className="po-lista-resultado">
              <li>Batidas: {r.batidas.gravar} a gravar, {r.batidas.iguais} já iguais{r.batidas.conflitos > 0 ? `, ${r.batidas.conflitos} mantidas (papel ou correção manual)` : ""}.</li>
              <li>Escala: {r.escala.divergentes} diferentes do RHiD, {r.escala.iguais} iguais. A Escala não é alterada por esta importação.</li>
              {r.mesesFechados > 0 ? <li>{plural(r.mesesFechados, "dia ignorado", "dias ignorados")} por estarem em mês com ponto fechado.</li> : null}
              {r.cpfsSemCadastro.length > 0 ? <li>Fora do cadastro ou sem “Bate ponto”: {r.cpfsSemCadastro.join(", ")}.</li> : null}
              {r.desconhecidos.length > 0 ? <li>Rótulos que o ERP não sabe traduzir (nada é gravado neles): {r.desconhecidos.join("; ")}.</li> : null}
              {r.avisos.map((a) => <li key={a}>{a}</li>)}
            </ul>
          ) : null}

          {r.divergencias.length > 0 ? (
            <>
              <Alert tone="warning" title="Diferenças entre a Escala e o RHiD (confira)">
                A Escala do ERP não foi alterada. Corrija a Escala ou o RHiD, o que estiver errado, e importe de novo. Enquanto isso, o Ponto usa o que está na Escala.
              </Alert>
              <div className="po-tabela-rolagem" role="region" aria-label="Dias diferentes da Escala" tabIndex={0}>
                <table className="po-tabela">
                  <caption className="po-sr">Dias em que o RHiD e a Escala do ERP dizem coisas diferentes</caption>
                  <thead>
                    <tr><th scope="col">Pessoa</th><th scope="col">Dia</th><th scope="col">Escala do ERP</th><th scope="col">RHiD</th></tr>
                  </thead>
                  <tbody>
                    {r.divergencias.map((m) => (
                      <tr key={`${m.nome}|${m.data}`}>
                        <th scope="row">{m.nome}</th>
                        <td>{dataCurta(m.data)}</td>
                        <td>{tipo(m.escala)}</td>
                        <td>{tipo(m.rhid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {previa && !nadaALer ? (
            <div className="po-acoes">
              <Button disabled={!mudaAlgo || ocupado || texto === null} aria-busy={ocupado} onClick={() => { if (texto) void rodar(texto, true); }}>
                {ocupado ? "Gravando…" : "Confirmar e gravar"}
              </Button>
              <Button variant="secondary" onClick={limpar}>Cancelar</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
