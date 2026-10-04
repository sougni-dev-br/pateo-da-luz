// Lê as fotos dos documentos no próprio navegador e compara com o que a pessoa digitou.
// O RH decide: cada divergência vem marcada e só vai para a ficha o que ele aplicar.
import { CheckCircle2, ScanText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { corrigirFichaPelaLeitura, type FichaCadastralDetalhe } from "../../../api/client";
import { useToast } from "../../../components/ui";
import { Alert, Button } from "../../../design-system";
import { conferirDocumentos, type Conferencia } from "./conferenciaDocumentos";
import { diaBr, formatarCpf } from "./fichaFormato";
import { lerDocumentos, TIPOS_LIDOS, type Progresso } from "./leitorDocumentos";

type Props = { ficha: FichaCadastralDetalhe; onCorrigida: () => void };

function mostrar(campo: string, valor: string): string {
  if (campo === "dataNascimento") return diaBr(valor) || valor;
  if (campo === "cpf") return formatarCpf(valor);
  if (campo === "cep" && /^\d{8}$/.test(valor)) return `${valor.slice(0, 5)}-${valor.slice(5)}`;
  return valor;
}

export function LeituraDocumentos({ ficha, onCorrigida }: Props) {
  const { toast } = useToast();
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [resultado, setResultado] = useState<{ itens: Conferencia[]; falhas: string[] } | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);
  // Saiu da tela no meio da leitura: para de ler e solta o leitor.
  const cancelado = useRef(false);
  useEffect(() => { cancelado.current = false; return () => { cancelado.current = true; }; }, []);

  const legiveis = ficha.arquivos.filter((a) => TIPOS_LIDOS.has(a.tipo));
  const lendo = progresso !== null && progresso.atual !== null;

  async function ler() {
    setErro(null);
    setResultado(null);
    setProgresso({ feitos: 0, total: legiveis.length, atual: "preparando a leitura" });
    try {
      const { textos, falhas } = await lerDocumentos(ficha.id, ficha.arquivos, ficha.opcoes.tiposArquivo, setProgresso, () => cancelado.current);
      if (cancelado.current) return;
      const itens = conferirDocumentos(ficha.dados, textos);
      setResultado({ itens, falhas });
      // Só vem marcado o número que o dígito verificador confirma; nome, data e RG o RH confere na foto.
      setMarcados(new Set(itens.filter((c) => c.situacao === "diverge" && c.seguro).map((c) => c.campo)));
    } catch (e) {
      if (!cancelado.current) setErro(e instanceof Error ? `Não foi possível ler os documentos: ${e.message}` : "Não foi possível ler os documentos.");
    } finally {
      if (!cancelado.current) setProgresso(null);
    }
  }

  async function aplicar() {
    if (!resultado) return;
    const valores = Object.fromEntries(resultado.itens.filter((c) => c.situacao === "diverge" && c.lido && marcados.has(c.campo)).map((c) => [c.campo, c.lido!]));
    setAplicando(true);
    try {
      const r = await corrigirFichaPelaLeitura(ficha.id, valores);
      toast(`${r.corrigidos.length} campo(s) corrigido(s) pelo documento.`, "success");
      setResultado(null);
      onCorrigida();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Não foi possível aplicar as correções.", "error", 6000);
    } finally {
      setAplicando(false);
    }
  }

  function alternar(campo: string) {
    setMarcados((atual) => { const novo = new Set(atual); if (novo.has(campo)) novo.delete(campo); else novo.add(campo); return novo; });
  }

  const diverge = resultado?.itens.filter((c) => c.situacao === "diverge") ?? [];
  const confere = resultado?.itens.filter((c) => c.situacao === "confere") ?? [];
  const naoLido = resultado?.itens.filter((c) => c.situacao === "nao_lido") ?? [];
  const rotuloDoc = (tipo: string | null) => (tipo ? ficha.opcoes.tiposArquivo[tipo] ?? tipo : "");

  return (
    <section className="panel fc-leitura" aria-labelledby="fc-leitura-titulo">
      <div className="fc-secao-topo">
        <h2 className="fc-secao-titulo" id="fc-leitura-titulo">Conferir com os documentos</h2>
        <Button variant="secondary" size="sm" leadingIcon={<ScanText size={15} />} disabled={lendo || aplicando || legiveis.length === 0} onClick={ler}>
          {resultado ? "Ler de novo" : "Ler documentos"}
        </Button>
      </div>
      {legiveis.length === 0 ? (
        <p className="fc-vazio">A pessoa não mandou foto de documento que dê para ler.</p>
      ) : !resultado && !lendo && (
        <p className="fc-leitura-ajuda">
          Lê as {legiveis.length} foto(s) de documento aqui mesmo, neste computador (as imagens não saem do sistema), e aponta o que foi digitado diferente.
          A primeira leitura baixa o leitor de português e demora um pouco mais.
        </p>
      )}

      {lendo && progresso && (
        <div className="fc-leitura-progresso" role="status" aria-live="polite">
          <progress max={Math.max(progresso.total, 1)} value={progresso.feitos} />
          <span>{progresso.feitos === 0 && progresso.atual === "preparando a leitura" ? "Preparando a leitura…" : `Lendo ${progresso.atual}… (${progresso.feitos} de ${progresso.total})`}</span>
        </div>
      )}
      {erro && <Alert tone="error">{erro}</Alert>}

      {resultado && (
        <div className="fc-leitura-resultado">
          {resultado.falhas.length > 0 && <Alert tone="warning">Não deu para abrir: {resultado.falhas.join(", ")}.</Alert>}
          {diverge.length > 0 ? (
            <>
              <p className="fc-leitura-chamada">O documento mostra outro valor em {diverge.length} campo(s). Olhe a foto e marque só o que a leitura acertou.</p>
              <ul className="fc-diferencas">
                {diverge.map((c) => (
                  <li key={c.campo}>
                    <label>
                      <input type="checkbox" checked={marcados.has(c.campo)} onChange={() => alternar(c.campo)} />
                      <span className="fc-dif-rotulo">
                        {c.rotulo}
                        <small className={c.seguro ? "fc-leitura-selo fc-leitura-selo--ok" : "fc-leitura-selo"}>{c.seguro ? "dígito verificador confere" : "confira na foto"}</small>
                      </span>
                      <span className="fc-dif-de">{mostrar(c.campo, c.digitado)}</span>
                      <span className="fc-dif-seta" aria-hidden="true">→</span>
                      <span className="fc-dif-para">{mostrar(c.campo, c.lido!)} <small className="fc-leitura-fonte">· {rotuloDoc(c.documento)}</small></span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="fc-form-acoes">
                <Button disabled={marcados.size === 0 || aplicando} onClick={aplicar}>
                  {aplicando ? "Aplicando…" : `Corrigir ${marcados.size} campo(s) na ficha`}
                </Button>
              </div>
            </>
          ) : (
            <Alert tone="success">Nenhuma divergência encontrada nos campos que deu para ler.</Alert>
          )}
          {confere.length > 0 && (
            <p className="fc-leitura-ok"><CheckCircle2 size={15} aria-hidden="true" /> Conferem com o documento: {confere.map((c) => c.rotulo).join(", ")}.</p>
          )}
          {naoLido.length > 0 && (
            <p className="fc-leitura-nao-lido">Não deu para ler com segurança (confira na foto): {naoLido.map((c) => c.rotulo).join(", ")}.</p>
          )}
        </div>
      )}
    </section>
  );
}
