import { ExternalLink, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, criarFichaCadastral, getFichaCadastral, getFichasCadastrais, type FichaCadastralDetalhe, type FichaCadastralLink, type FichaCadastralResumo } from "../../api/client";
import { useSession } from "../../context/SessionContext";
import { Alert, Button, FormSection, StatusBadge } from "../../design-system";
import { DocumentosFicha } from "../../pages/rh/fichas/DadosPessoa";
import { LinkFicha } from "../../pages/rh/fichas/LinkFicha";
import { dataBr, rotaFicha, situacao } from "../../pages/rh/fichas/fichaFormato";
import "../../pages/rh/fichas/fichas.css";

type Props = { employeeId: string; nome: string; celular: string | null };

/**
 * Seção do cadastro: fichas cadastrais da pessoa (admissão e atualizações), as fotos dos
 * documentos que ela mandou e o botão para pedir atualização.
 */
export function FichasDoFuncionario({ employeeId, nome, celular }: Props) {
  const navigate = useNavigate();
  const { hasPermission } = useSession();
  const [fichas, setFichas] = useState<FichaCadastralResumo[] | null>(null);
  const [comDocumentos, setComDocumentos] = useState<FichaCadastralDetalhe[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [link, setLink] = useState<FichaCadastralLink | null>(null);
  const [gerando, setGerando] = useState(false);
  // Recarrega a lista depois de criar uma ficha — não ao abrir/fechar a janela do link (cada
  // recarga baixava todas as fotos de novo e cada download vira um registro de "arquivo aberto").
  const [recarga, setRecarga] = useState(0);

  const podeVer = hasPermission("employee-forms", "view");

  useEffect(() => {
    if (!podeVer) return undefined;
    let vivo = true;
    setFichas(null);
    setComDocumentos([]);
    setErro(null);
    getFichasCadastrais({ employeeId })
      .then(async (lista) => {
        if (!vivo) return;
        setFichas(lista);
        const detalhes = await Promise.all(lista.filter((f) => f.arquivos > 0).map((f) => getFichaCadastral(f.id)));
        if (vivo) setComDocumentos(detalhes);
      })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : "Não foi possível carregar as fichas."); });
    return () => { vivo = false; };
  }, [employeeId, recarga, podeVer]);

  if (!podeVer) return null;

  async function pedirAtualizacao() {
    setErro(null);
    setGerando(true);
    try {
      setLink(await criarFichaCadastral({ tipo: "ATUALIZACAO", employeeId }));
      setRecarga((n) => n + 1);
    } catch (e) {
      const existente = e instanceof ApiError ? e.body?.fichaId : null;
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o link.");
      if (typeof existente === "string") navigate(rotaFicha(existente));
    } finally {
      setGerando(false);
    }
  }

  return (
    <FormSection title="Ficha cadastral e documentos">
      <div className="fc-func">
        <p className="fc-descricao">Mande um link para {nome.split(" ")[0]} conferir e corrigir os próprios dados pelo celular e enviar fotos de documentos.</p>
        {hasPermission("employee-forms", "create") && hasPermission("employees", "view") && (
          <Button variant="secondary" leadingIcon={<Send size={15} />} disabled={gerando} onClick={pedirAtualizacao}>Pedir atualização de dados</Button>
        )}
      </div>
      {erro && <Alert tone="error">{erro}</Alert>}
      {fichas && fichas.length > 0 && (
        <ul className="fc-lista">
          {fichas.map((f) => {
            const s = situacao(f);
            return (
              <li key={f.id}>
                <button type="button" className="fc-item" onClick={() => navigate(rotaFicha(f.id))}>
                  <span className="fc-item-nome">
                    <strong>{f.tipo === "ADMISSAO" ? "Ficha de admissão" : "Atualização de dados"}</strong>
                    <small>criada em {dataBr(f.createdAt)}{f.arquivos ? ` · ${f.arquivos} arquivo(s)` : ""}</small>
                  </span>
                  <span className="fc-item-meta"><StatusBadge tone={s.tom}>{s.rotulo}</StatusBadge><ExternalLink size={15} aria-hidden="true" /></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {comDocumentos.map((f) => (
        <div key={f.id} className="fc-func-docs">
          <p className="fc-subtitulo">Documentos enviados em {dataBr(f.finalizadaEm ?? f.createdAt)}</p>
          <DocumentosFicha fichaId={f.id} arquivos={f.arquivos} tipos={f.opcoes.tiposArquivo} podeAbrir={hasPermission("employees", "view")} />
        </div>
      ))}
      {link && <LinkFicha aberto onFechar={() => setLink(null)} nome={nome} tipo="ATUALIZACAO" codigo={link.codigo} expiraEm={link.expiraEm} celular={celular} />}
    </FormSection>
  );
}
