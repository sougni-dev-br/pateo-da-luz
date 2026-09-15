import { Camera, FileUp, Sparkles, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getCompanies, getPaymentMethods, getProducts, getSuppliers, previewDocumentos,
  type Company, type DocIntakePreview, type DocIntakeProgresso, type PaymentMethod, type Product, type Supplier,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Alert, Button, FormGrid, SummaryCard } from "../design-system";
import { prepararArquivo } from "../lib/comprimir-imagem";
import { CapturaFoto } from "./CapturaFoto";
import { ProgressoLeitura, type ArquivoEmLeitura } from "./ProgressoLeitura";
import type { DocumentoVisivel } from "./VisualizadorDocumento";
import { DocIntakeTituloCard } from "./DocIntakeTitulo";

const MAX_ARQUIVOS = 5;
const TIPOS_ACEITOS = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Blob URL em vez de manter o data URL: o navegador carrega o arquivo por
 * referência, sem repassar megabytes de base64 a cada render do visualizador.
 * Quem cria precisa revogar — ver a limpeza no envio e no desmonte.
 */
function paraBlobUrl(dataUrl: string): { url: string; ehPdf: boolean } {
  const tipo = dataUrl.slice(5, dataUrl.indexOf(";"));
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return { url: URL.createObjectURL(new Blob([bytes], { type: tipo })), ehPdf: tipo === "application/pdf" };
}

export function DocIntake() {
  const { notice, setNotice } = useNotice();
  const [lendo, setLendo] = useState(false);
  const [preview, setPreview] = useState<DocIntakePreview | null>(null);
  const [fornecedores, setFornecedores] = useState<Supplier[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [formasPagamento, setFormasPagamento] = useState<PaymentMethod[]>([]);
  const [cameraAberta, setCameraAberta] = useState(false);
  const [arquivosVisiveis, setArquivosVisiveis] = useState<DocumentoVisivel[]>([]);
  const [emLeitura, setEmLeitura] = useState<ArquivoEmLeitura[]>([]);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [inicioLeitura, setInicioLeitura] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        // Produtos NAO entram aqui: sao mais de 800, e a escolha e feita por
        // busca no servidor conforme se digita (ver SeletorProduto), como na
        // tela de Compras. Carregar a lista inteira para montar um <select>
        // deixa a tela pesada e a lista impossivel de percorrer.
        const [listaFornecedores, listaEmpresas, listaFormas] = await Promise.all([
          getSuppliers({ activeOnly: true }),
          getCompanies(),
          getPaymentMethods(),
        ]);
        setFornecedores(listaFornecedores);
        setEmpresas(listaEmpresas);
        setFormasPagamento(listaFormas);
      } catch (erro) {
        setNotice({ tone: "error", message: `Não foi possível carregar os cadastros: ${(erro as Error).message}` });
      }
    })();
  }, [setNotice]);

  // Blob URL vaza se nao for revogada: limpa ao sair da tela.
  useEffect(() => () => {
    arquivosVisiveis.forEach((arquivo) => URL.revokeObjectURL(arquivo.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviar(arquivos: File[]) {
    if (arquivos.length === 0) return;
    if (arquivos.length > MAX_ARQUIVOS) {
      setNotice({ tone: "error", message: `Envie no máximo ${MAX_ARQUIVOS} arquivos por vez.` });
      return;
    }

    setLendo(true);
    setPreview(null);
    // Libera os arquivos da leitura anterior antes de abrir os novos.
    setArquivosVisiveis((anteriores) => {
      anteriores.forEach((arquivo) => URL.revokeObjectURL(arquivo.url));
      return [];
    });
    try {
      const preparados = await Promise.all(arquivos.map(prepararArquivo));
      setArquivosVisiveis(preparados.map((arquivo) => ({ nome: arquivo.nome, ...paraBlobUrl(arquivo.base64) })));
      const comprimidas = preparados.filter((arquivo) => arquivo.comprimida);
      if (comprimidas.length > 0) {
        const antes = comprimidas.reduce((soma, arquivo) => soma + arquivo.bytesOriginais, 0);
        const depois = comprimidas.reduce((soma, arquivo) => soma + arquivo.bytesEnviados, 0);
        setNotice({ tone: "info", message: `Preparando ${comprimidas.length} foto(s): ${mb(antes)} → ${mb(depois)}.` });
      }

      setEmLeitura(preparados.map((arquivo) => ({ nome: arquivo.nome, situacao: "aguardando" as const })));
      setEtapa(null);
      setInicioLeitura(Date.now());

      const resultado = await previewDocumentos(
        preparados.map((arquivo) => ({ nome: arquivo.nome, base64: arquivo.base64 })),
        (evento: DocIntakeProgresso) => {
          if (evento.tipo === "etapa") {
            setEtapa(evento.descricao);
            return;
          }
          if (evento.tipo === "arquivo") {
            setEmLeitura((atual) => atual.map((arquivo, indice) =>
              indice === evento.indice ? { ...arquivo, situacao: evento.situacao, erro: evento.erro } : arquivo,
            ));
          }
        },
      );
      setPreview(resultado);

      const titulos = resultado.titulos.length;
      setNotice({
        tone: resultado.falhas.length > 0 ? "warning" : "success",
        message: `${resultado.documentos.length} documento(s) lido(s) → ${titulos} título(s) para conferir.`
          + (resultado.falhas.length > 0 ? ` ${resultado.falhas.length} arquivo(s) não puderam ser lidos.` : ""),
      });
    } catch (erro) {
      setNotice({ tone: "error", message: (erro as Error).message });
    } finally {
      setLendo(false);
      setEtapa(null);
    }
  }

  const totalLido = preview?.titulos.reduce((soma, titulo) => soma + (titulo.valorTotal ?? 0), 0) ?? 0;
  const prontos = preview?.titulos.filter((titulo) => titulo.podeConfirmar).length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice notice={notice} />

      <CapturaFoto
        aberto={cameraAberta}
        maximo={MAX_ARQUIVOS}
        onFechar={() => setCameraAberta(false)}
        onConfirmar={(fotos) => { void enviar(fotos); }}
      />

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <strong style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={16} /> Leitura de documentos
        </strong>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Envie a nota fiscal, o boleto ou a fatura — <strong>em PDF ou foto</strong>. O sistema lê os campos e monta o
          rascunho do lançamento — <strong>nada é gravado até você conferir e confirmar</strong>. Nota e boleto do mesmo
          título são reconhecidos como um lançamento só; pode enviar os dois juntos.
        </span>
        <span className="doc-intro-secundaria" style={{ color: "var(--muted)", fontSize: 12 }}>
          Para foto sair legível: documento inteiro no quadro, sem sombra sobre os números, e de frente (não inclinado).
          Valor e vencimento lidos de foto <strong>sempre</strong> merecem uma segunda olhada antes de lançar.
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={inputRef}
            type="file"
            accept={TIPOS_ACEITOS}
            multiple
            style={{ display: "none" }}
            onChange={(event) => {
              const arquivos = Array.from(event.target.files ?? []);
              if (arquivos.length > 0) void enviar(arquivos);
              event.target.value = "";
            }}
          />
          <Button onClick={() => setCameraAberta(true)} disabled={lendo} leadingIcon={<Camera size={14} />}>
            Tirar foto
          </Button>
          <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={lendo} leadingIcon={<Upload size={14} />}>
            {lendo ? "Lendo o documento…" : "Escolher arquivo (até 5)"}
          </Button>
          <span style={{ color: "var(--muted)", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FileUp size={14} /> PDF ou foto de nota, boleto ou fatura
          </span>
        </div>
      </div>

      {lendo && emLeitura.length > 0 && (
        <ProgressoLeitura arquivos={emLeitura} etapa={etapa} inicioEm={inicioLeitura} />
      )}

      {preview && preview.falhas.length > 0 && (
        <Alert tone="warning">
          <strong>Não foi possível ler:</strong>{" "}
          {preview.falhas.map((falha) => `${falha.arquivo} — ${falha.erro}`).join(" · ")}
        </Alert>
      )}

      {preview && preview.titulos.length > 0 && (
        <>
          <FormGrid cols={3}>
            <SummaryCard compact label="Documentos lidos" value={String(preview.documentos.length)} />
            <SummaryCard compact label="Títulos a lançar" value={String(preview.titulos.length)} tone={prontos === preview.titulos.length ? "success" : "warning"} />
            <SummaryCard compact label="Total dos títulos" moneyValue={totalLido} />
          </FormGrid>

          {preview.titulos.map((titulo, indice) => (
            <DocIntakeTituloCard
              key={titulo.chave ?? indice}
              titulo={titulo}
              arquivos={arquivosVisiveis.filter((arquivo) => titulo.documentos.includes(arquivo.nome))}
              fornecedores={fornecedores}
              empresas={empresas}
              formasPagamento={formasPagamento}
              onLancado={(mensagem) => setNotice({ tone: "success", message: mensagem })}
              onErro={(mensagem) => setNotice({ tone: "error", message: mensagem })}
            />
          ))}
        </>
      )}

      {preview && preview.titulos.length === 0 && preview.falhas.length === 0 && (
        <Alert tone="warning">Nenhum título foi identificado nos arquivos enviados.</Alert>
      )}
    </div>
  );
}
