// Conferência de uma ficha: dados que a pessoa mandou, fotos dos documentos, parte da
// empresa, impressão para assinar e a conclusão (cria o funcionário ou grava a atualização).
import { ArrowLeft, Ban, CheckCircle2, Link2, Printer, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getArquivoFichaCadastral,
  cancelarFichaCadastral, concluirFichaCadastral, devolverFichaCadastral, getFichaCadastral, novoLinkFichaCadastral,
  salvarEmpresaFichaCadastral, type FichaCadastralDetalhe as Detalhe, type FichaCadastralEmpresa, type FichaCadastralLink,
} from "../../../api/client";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Dialog } from "../../../components/ui/Dialog";
import { useToast } from "../../../components/ui";
import { useSession } from "../../../context/SessionContext";
import { Alert, Button, StatusBadge, Textarea } from "../../../design-system";
import { ROTAS_RH } from "../rotasRh";
import { DadosPessoa, DocumentosFicha } from "./DadosPessoa";
import { EmpresaFicha } from "./EmpresaFicha";
import { FichaImpressao, imprimirFicha } from "./FichaImpressao";
import { LeituraDocumentos } from "./LeituraDocumentos";
import { LinkFicha } from "./LinkFicha";
import { apagaEm, dataBr, diaBr, empresaParaEnvio, formatarCpf, situacao } from "./fichaFormato";

// Trocar CPF ou chave PIX é a mudança que um link vazado faria (desviar pagamento): só com marcação explícita.
const SENSIVEIS = new Set(["cpf", "pixChave"]);

type Props = { id: string; onVoltar: () => void };

export function FichaCadastralDetalhe({ id, onVoltar }: Props) {
  const navigate = useNavigate();
  const { hasPermission } = useSession();
  const { toast } = useToast();
  const [ficha, setFicha] = useState<Detalhe | null>(null);
  const [empresa, setEmpresa] = useState<FichaCadastralEmpresa>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [link, setLink] = useState<FichaCadastralLink | null>(null);
  const [devolvendo, setDevolvendo] = useState(false);
  const [erroDevolver, setErroDevolver] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState<"cancelar" | "concluir" | null>(null);
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  // As caixas do "O que muda" começam marcadas só na primeira carga: recarregar depois de salvar
  // a parte da empresa não pode remarcar o que o RH desmarcou (iria para o cadastro).
  const caixasIniciadas = useRef<string | null>(null);

  const pedido = useRef(0);
  const carregar = useCallback(() => {
    const meu = ++pedido.current;
    getFichaCadastral(id)
      .then((f) => {
        if (meu !== pedido.current) return;
        setFicha(f);
        // Só na primeira carga: recarregar depois de uma ação não apaga o que o RH digitou na
        // parte da empresa nem remarca o que ele desmarcou.
        if (caixasIniciadas.current !== f.id) {
          caixasIniciadas.current = f.id;
          setEmpresa(f.dadosEmpresa ?? {});
          setEscolhidos(new Set([
            ...f.diferencas.map((d) => d.campo).filter((c) => !SENSIVEIS.has(c)),
            ...(f.filhosNovos.length ? ["filhosNovos"] : []),
            ...(f.filhosAlterados.length ? ["filhosAlterados"] : []),
          ]));
        }
      })
      .catch((e) => setErro(e instanceof Error ? e.message : "Não foi possível abrir a ficha."));
  }, [id]);
  useEffect(carregar, [carregar]);

  // Foto da pessoa para a ficha impressa (baixada uma vez por ficha/arquivo).
  // A foto também é documento: sem ver Funcionários, a ficha impressa sai sem ela.
  const fotoId = ficha && !ficha.salarioOculto ? ficha.arquivos.find((a) => a.tipo === "FOTO_PESSOA")?.id ?? null : null;
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!fotoId) { setFotoUrl(null); return undefined; }
    let ativo = true;
    let criada: string | null = null;
    getArquivoFichaCadastral(id, fotoId)
      .then((blob) => { if (!ativo) return; criada = URL.createObjectURL(blob); setFotoUrl(criada); })
      .catch(() => { if (ativo) setFotoUrl(null); });
    return () => { ativo = false; if (criada) URL.revokeObjectURL(criada); };
  }, [id, fotoId]);

  if (erro && !ficha) return <div className="stack"><Button variant="secondary" leadingIcon={<ArrowLeft size={16} />} onClick={onVoltar}>Voltar</Button><Alert tone="error">{erro}</Alert></div>;
  if (!ficha) return <p className="fc-carregando">Carregando…</p>;

  const s = situacao({ status: ficha.status, vencida: ["ENVIADA", "PREENCHENDO"].includes(ficha.status) && new Date(ficha.expiraEm).getTime() < Date.now() });
  const aberta = ["ENVIADA", "PREENCHENDO"].includes(ficha.status);
  const finalizada = ficha.status === "FINALIZADA";
  const podeEditar = hasPermission("employee-forms", "edit") && ficha.status !== "CANCELADA";
  // Novo link e devolução são POST: no controle de acesso pedem "criar".
  const podeReenviar = hasPermission("employee-forms", "create");
  // Gerar link exige também ver Funcionários (mesma regra do servidor).
  const podeGerarLink = podeReenviar && hasPermission("employees", "view");
  const podeConcluir = hasPermission("employee-forms", "approve") && hasPermission("employees", ficha.tipo === "ADMISSAO" ? "create" : "edit");
  const quandoApaga = apagaEm(ficha);
  // Só conta (e só vai) o que está na tela agora: depois de uma correção pelo documento, uma
  // diferença pode ter sumido.
  const chavesVisiveis = new Set([
    ...ficha.diferencas.map((d) => d.campo),
    ...(ficha.filhosNovos.length ? ["filhosNovos"] : []),
    ...(ficha.filhosAlterados.length ? ["filhosAlterados"] : []),
  ]);
  const efetivos = [...escolhidos].filter((c) => chavesVisiveis.has(c));
  const semDiferencas = chavesVisiveis.size === 0;
  const nome = ficha.funcionario?.nome ?? (typeof ficha.dados.nomeCompleto === "string" ? ficha.dados.nomeCompleto : ficha.nomeReferencia);

  /** Executa a ação; devolve null se deu certo ou a mensagem do erro (que também vai para o topo). */
  async function agir(acao: () => Promise<unknown>, sucesso: string): Promise<string | null> {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await acao();
      setAviso(sucesso);
      carregar();
      return null;
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : "Não foi possível concluir a ação.";
      setErro(mensagem);
      return mensagem;
    } finally {
      setOcupado(false);
    }
  }

  // Salvar fica no fim da página: a confirmação aparece onde a pessoa está olhando (toast).
  async function salvarEmpresa() {
    setOcupado(true);
    try {
      await salvarEmpresaFichaCadastral(id, empresaParaEnvio(empresa));
      toast("Parte da empresa salva.", "success");
      carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Não foi possível salvar.", "error", 6000);
    } finally {
      setOcupado(false);
    }
  }

  async function concluir() {
    setConfirmar(null);
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      // Salvar a parte da empresa muda a versão da ficha: o concluir vai com a versão nova.
      let versao = ficha!.updatedAt;
      if (podeEditar) versao = (await salvarEmpresaFichaCadastral(id, empresaParaEnvio(empresa))).versao ?? versao;
      const r = await concluirFichaCadastral(id, versao, ficha!.tipo === "ATUALIZACAO" ? efetivos : undefined);
      setAviso(ficha!.tipo === "ADMISSAO" ? "Funcionário criado. Complete escala, VT e gorjeta no cadastro." : "Cadastro atualizado.");
      carregar();
      return r;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setOcupado(false);
    }
  }

  function alternar(campo: string) {
    setEscolhidos((atual) => { const novo = new Set(atual); if (novo.has(campo)) novo.delete(campo); else novo.add(campo); return novo; });
  }

  return (
    <div className="stack fc">
      <section className="panel fc-cabecalho">
        <Button variant="secondary" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={onVoltar}>Fichas</Button>
        <div className="fc-cabecalho-linha">
          <div>
            <h1 className="fc-titulo">{nome}</h1>
            <p className="fc-descricao">
              {ficha.tipo === "ADMISSAO" ? "Admissão" : "Atualização de dados"} · link criado em {dataBr(ficha.createdAt)}
              {aberta && ` · ${new Date(ficha.expiraEm).getTime() < Date.now() ? "venceu em" : "vale até"} ${dataBr(ficha.expiraEm)}`}
              {ficha.finalizadaEm && ` · finalizada em ${dataBr(ficha.finalizadaEm)}`}
            </p>
          </div>
          <StatusBadge tone={s.tom}>{s.rotulo}</StatusBadge>
        </div>
        <div className="fc-acoes">
          <Button variant="secondary" leadingIcon={<Printer size={16} />} onClick={imprimirFicha}>Imprimir ficha</Button>
          {aberta && podeGerarLink && <Button variant="secondary" leadingIcon={<Link2 size={16} />} disabled={ocupado}
            onClick={() => agir(async () => setLink(await novoLinkFichaCadastral(id)), "Novo link gerado. O anterior não abre mais.")}>Gerar novo link</Button>}
          {finalizada && podeReenviar && <Button variant="secondary" leadingIcon={<RotateCcw size={16} />} disabled={ocupado} onClick={() => setDevolvendo(true)}>Devolver para correção</Button>}
          {(aberta || finalizada) && hasPermission("employee-forms", "delete") && <Button variant="danger" leadingIcon={<Ban size={16} />} disabled={ocupado} onClick={() => setConfirmar("cancelar")}>Cancelar ficha</Button>}
          {finalizada && podeConcluir && <Button leadingIcon={<CheckCircle2 size={16} />}
            disabled={ocupado || (ficha.tipo === "ATUALIZACAO" && !semDiferencas && efetivos.length === 0)} onClick={() => setConfirmar("concluir")}>
            {ficha.tipo === "ADMISSAO" ? "Criar funcionário" : semDiferencas ? "Concluir sem alterações" : "Gravar no cadastro"}</Button>}
          {ficha.status === "CONCLUIDA" && ficha.funcionario && (
            <Button variant="secondary" onClick={() => navigate(`${ROTAS_RH.funcionarios}?funcionario=${encodeURIComponent(ficha.funcionario!.id)}`)}>Abrir o cadastro</Button>
          )}
        </div>
        {erro && <Alert tone="error">{erro}</Alert>}
        {aviso && <Alert tone="success">{aviso}</Alert>}
        {finalizada && (
          <ol className="fc-roteiro" aria-label="Próximos passos">
            <li>Confira os dados e as fotos{ficha.tipo === "ATUALIZACAO" ? " e marque o que muda no cadastro" : ""}.</li>
            <li>Complete a <a href="#fc-empresa">parte da empresa</a> e salve.</li>
            <li>Imprima a ficha, colha as assinaturas e envie à contabilidade.</li>
            <li>Clique em <strong>{ficha.tipo === "ADMISSAO" ? "Criar funcionário" : "Gravar no cadastro"}</strong>.</li>
          </ol>
        )}
        {aberta && ficha.falta.length > 0 && (
          <Alert tone="info" title="A pessoa ainda não finalizou">Falta: {ficha.falta.join(", ")}.</Alert>
        )}
        {ficha.motivoDevolucao && aberta && <Alert tone="warning" title="Devolvida para correção">{ficha.motivoDevolucao}</Alert>}
        {quandoApaga && (
          <Alert tone="warning" title={`Será apagada em ${dataBr(quandoApaga.toISOString())}`}>
            {ficha.status === "CANCELADA"
              ? "Ficha cancelada: os dados e as fotos são apagados 90 dias depois do cancelamento."
              : "O link venceu: se não for gerado um novo link, os dados e as fotos são apagados 90 dias depois do vencimento."}
          </Alert>
        )}
        {ficha.salarioOculto && (
          <Alert tone="info">Sem a permissão de ver Funcionários, CPF, PIX, salário e as fotos dos documentos ficam ocultos — inclusive na ficha impressa.</Alert>
        )}
        {ficha.bloqueadoAte && new Date(ficha.bloqueadoAte).getTime() > Date.now() && (
          <Alert tone="warning">O link foi bloqueado por tentativas erradas de data de nascimento. “Gerar novo link” desbloqueia.</Alert>
        )}
      </section>

      {ficha.tipo === "ATUALIZACAO" && finalizada && (
        <section className="panel">
          <h2 className="fc-secao-titulo">O que muda no cadastro</h2>
          {ficha.diferencas.length === 0 && ficha.filhosNovos.length === 0 && ficha.filhosAlterados.length === 0 ? (
            <p className="fc-vazio">Nada mudou em relação ao cadastro.</p>
          ) : (
            <ul className="fc-diferencas">
              {ficha.diferencas.map((d) => (
                <li key={d.campo} className={SENSIVEIS.has(d.campo) ? "fc-dif--sensivel" : undefined}>
                  <label>
                    <input type="checkbox" checked={escolhidos.has(d.campo)} onChange={() => alternar(d.campo)} />
                    <span className="fc-dif-rotulo">
                      {d.rotulo}
                      {SENSIVEIS.has(d.campo) && <small className="fc-dif-alerta">dado sensível: confirme com a pessoa antes de marcar</small>}
                    </span>
                    <span className="fc-dif-de">{d.atual ?? "vazio"}</span>
                    <span className="fc-dif-seta" aria-hidden="true">→</span>
                    <span className="fc-dif-para">{d.novo}</span>
                  </label>
                </li>
              ))}
              {ficha.filhosNovos.length > 0 && (
                <li>
                  <label>
                    <input type="checkbox" checked={escolhidos.has("filhosNovos")} onChange={() => alternar("filhosNovos")} />
                    <span className="fc-dif-rotulo">Incluir filhos</span>
                    <span className="fc-dif-de fc-dif-de--neutro">não estão no cadastro</span>
                    <span className="fc-dif-seta" aria-hidden="true">→</span>
                    <span className="fc-dif-para">{ficha.filhosNovos.map((f) => f.nome).join(", ")}</span>
                  </label>
                </li>
              )}
              {ficha.filhosAlterados.length > 0 && (
                <li>
                  <label>
                    <input type="checkbox" checked={escolhidos.has("filhosAlterados")} onChange={() => alternar("filhosAlterados")} />
                    <span className="fc-dif-rotulo">Corrigir filhos</span>
                    <span className="fc-dif-de fc-dif-de--neutro">como está no cadastro</span>
                    <span className="fc-dif-seta" aria-hidden="true">→</span>
                    <span className="fc-dif-para">
                      {ficha.filhosAlterados.map((f) => (
                        <span key={f.dependenteId} className="fc-dif-linha">
                          {f.nome}:{" "}
                          {[
                            f.nomeNovo && `nome → ${f.nomeNovo}`,
                            f.dataNascimento && `nascimento ${diaBr(f.dataNascimento.atual) || "vazio"} → ${diaBr(f.dataNascimento.novo)}`,
                            f.cpf && `CPF ${f.cpf.atual ? formatarCpf(f.cpf.atual) : "vazio"} → ${formatarCpf(f.cpf.novo)}`,
                          ].filter(Boolean).join("; ")}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {finalizada && podeEditar && !ficha.salarioOculto && <LeituraDocumentos ficha={ficha} onCorrigida={carregar} />}

      <section className="panel">
        <h2 className="fc-secao-titulo">Foto e documentos <small>({ficha.arquivos.length})</small></h2>
        <DocumentosFicha fichaId={ficha.id} arquivos={ficha.arquivos} tipos={ficha.opcoes.tiposArquivo} podeAbrir={!ficha.salarioOculto} />
      </section>

      <section className="panel">
        <h2 className="fc-secao-titulo">Dados enviados pela pessoa</h2>
        <DadosPessoa dados={ficha.dados} rotulos={ficha.opcoes.rotulos} />
      </section>

      <section className="panel">
        <div className="fc-secao-topo">
          <h2 className="fc-secao-titulo" id="fc-empresa">Parte da empresa</h2>
          {podeEditar && <Button variant="secondary" size="sm" leadingIcon={<Save size={15} />} disabled={ocupado} onClick={salvarEmpresa}>Salvar</Button>}
        </div>
        <EmpresaFicha ficha={ficha} valor={empresa} onChange={setEmpresa} somenteLeitura={!podeEditar} />
      </section>

      <FichaImpressao ficha={ficha} empresa={empresa} fotoUrl={fotoUrl} />

      {link && <LinkFicha aberto onFechar={() => setLink(null)} nome={nome} tipo={ficha.tipo} codigo={link.codigo} expiraEm={link.expiraEm}
        celular={typeof ficha.dados.telefone === "string" ? ficha.dados.telefone : null} />}

      <Dialog open={devolvendo} onOpenChange={(v) => { setDevolvendo(v); if (!v) { setErroDevolver(null); setErro(null); } }} title="Devolver para correção" description="O mesmo link volta a abrir para a pessoa corrigir. Ela vê a sua mensagem no topo da ficha.">
        <div className="fc-form">
          {erroDevolver && <Alert tone="error">{erroDevolver}</Alert>}
          <Textarea label="O que precisa corrigir" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} autoFocus placeholder="Ex.: a foto do RG ficou ilegível, mande de novo." />
          <div className="fc-form-acoes">
            <Button variant="secondary" onClick={() => setDevolvendo(false)}>Cancelar</Button>
            <Button disabled={motivo.trim().length < 3 || ocupado} onClick={async () => {
              // O erro aparece dentro da janela: o aviso do topo fica atrás dela.
              setErroDevolver(null);
              const falha = await agir(() => devolverFichaCadastral(id, motivo), "Ficha devolvida. Avise a pessoa pelo WhatsApp para abrir o mesmo link.");
              if (falha) setErroDevolver(falha);
              else { setDevolvendo(false); setMotivo(""); }
            }}>Devolver</Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog open={confirmar === "cancelar"} tone="danger" title="Cancelar esta ficha?" confirmLabel="Cancelar ficha" cancelLabel="Voltar"
        description="O link para de funcionar. Os dados e as fotos já enviados ficam guardados por 90 dias e depois são apagados."
        onCancel={() => setConfirmar(null)} onConfirm={() => { setConfirmar(null); agir(() => cancelarFichaCadastral(id), "Ficha cancelada."); }} />
      <ConfirmDialog open={confirmar === "concluir"} title={ficha.tipo === "ADMISSAO" ? "Criar o funcionário?" : "Gravar no cadastro?"}
        confirmLabel={ficha.tipo === "ADMISSAO" ? "Criar funcionário" : "Gravar"} cancelLabel="Voltar"
        description={ficha.tipo === "ADMISSAO"
          ? "Os dados da ficha e a parte da empresa viram o cadastro do funcionário. Depois, complete no cadastro a escala, o trajeto do VT e a gorjeta."
          : semDiferencas
            ? `Nada mudou em relação ao cadastro de ${nome.split(" ")[0]}. A ficha fica guardada como conferida.`
            : `Grava ${efetivos.length} alteração(ões) marcadas no cadastro de ${nome.split(" ")[0]}. Salário, função e empresa não mudam por aqui.`}
        onCancel={() => setConfirmar(null)} onConfirm={concluir} />
    </div>
  );
}
