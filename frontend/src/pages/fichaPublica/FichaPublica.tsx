// Página que a pessoa abre pelo link do WhatsApp para preencher a ficha cadastral. Fora do
// login do sistema (main.tsx desvia /ficha/... para cá). Celular primeiro: uma etapa por
// tela, botão de avançar embaixo, onde o polegar alcança.
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Lock, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { abrirFicha, ErroFicha, finalizar, salvarDados, verificar, type Dados, type Estado } from "./api";
import { Apresentacao } from "./Apresentacao";
import { CampoFicha } from "./CampoFicha";
import { EtapaFamilia, filhosParaSalvar, filhosParaTela, type FilhoTela } from "./EtapaFamilia";
import { EtapaFotos } from "./EtapaFotos";
import { EtapaRevisao } from "./EtapaRevisao";
import { ETAPAS, corpoDaEtapa, etapaInicial, valoresDe, type Valores } from "./etapas";
import { buscarCep, dataParaIso, mascaraCpf, mascaraData, soDigitos } from "./formato";
import "./fichaPublica.css";

// A carta de apresentação aparece uma vez por aba: recarregar no meio do preenchimento não volta
// para ela.
const chaveApresentada = (codigo: string) => `ficha-apresentada:${codigo.slice(0, 12)}`;
function jaApresentada(codigo: string): boolean {
  try { return sessionStorage.getItem(chaveApresentada(codigo)) === "1"; } catch { return false; }
}

function codigoDaUrl(): string {
  const parte = window.location.pathname.split("/")[2] ?? "";
  try { return decodeURIComponent(parte); } catch { return parte; } // link colado com "%" quebrado
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="fp">
      <header className="fp-marca"><span className="fp-marca-nome">Pateo da Luz</span><span className="fp-marca-sub">Ficha cadastral</span></header>
      <main className="fp-corpo">{children}</main>
    </div>
  );
}

function Mensagem({ titulo, texto, icone }: { titulo: string; texto: string; icone?: React.ReactNode }) {
  return (
    <Moldura>
      <div className="fp-mensagem">
        {icone}
        <h1>{titulo}</h1>
        <p>{texto}</p>
      </div>
    </Moldura>
  );
}

function Verificacao({ codigo, metodo, onLiberado }: { codigo: string; metodo: "NASCIMENTO" | "CPF"; onLiberado: (e: Estado) => void }) {
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    const resposta = metodo === "NASCIMENTO" ? dataParaIso(valor) : soDigitos(valor);
    if (!resposta || (metodo === "CPF" && resposta.length !== 11)) { setErro(metodo === "NASCIMENTO" ? "Use DD/MM/AAAA." : "CPF tem 11 números."); return; }
    setEnviando(true);
    setErro(null);
    try { onLiberado(await verificar(codigo, resposta)); } catch (x) { setErro(x instanceof ErroFicha ? x.message : "Tente de novo."); } finally { setEnviando(false); }
  }
  return (
    <Moldura>
      <form className="fp-cartao fp-verificacao" onSubmit={confirmar}>
        <Lock size={28} className="fp-verificacao-icone" aria-hidden="true" />
        <h1>Confirme sua identidade</h1>
        <p>Para proteger as suas informações, informe {metodo === "NASCIMENTO" ? "a sua data de nascimento" : "o seu CPF"} antes de continuar.</p>
        <label className="fp-rotulo" htmlFor="fp-verifica">{metodo === "NASCIMENTO" ? "Data de nascimento" : "CPF"}</label>
        <input id="fp-verifica" className="fp-entrada" inputMode="numeric" autoFocus placeholder={metodo === "NASCIMENTO" ? "DD/MM/AAAA" : "000.000.000-00"}
          value={valor} onChange={(e) => setValor(metodo === "NASCIMENTO" ? mascaraData(e.target.value) : mascaraCpf(e.target.value))} aria-invalid={Boolean(erro)} />
        {erro && <p className="fp-erro" role="alert">{erro}</p>}
        <button type="submit" className="fp-botao fp-botao--principal" disabled={enviando}>
          {enviando ? <Loader2 size={18} className="fp-girando" aria-hidden="true" /> : null} Continuar
        </button>
      </form>
    </Moldura>
  );
}

export function FichaPublica() {
  const codigo = useRef(codigoDaUrl()).current;
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erroFatal, setErroFatal] = useState<string | null>(null);
  const [etapa, setEtapa] = useState(0);
  const [valores, setValores] = useState<Valores>({});
  const [filhos, setFilhos] = useState<FilhoTela[]>([]);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [consentiu, setConsentiu] = useState(false);
  const [apresentada, setApresentada] = useState(() => jaApresentada(codigo));
  const iniciado = useRef(false);
  const topo = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = "Ficha cadastral — Pateo da Luz";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    abrirFicha(codigo).then(receber).catch((e) => setErroFatal(e instanceof ErroFicha ? e.message : "Não foi possível abrir a ficha."));
    return () => { robots.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function receber(e: Estado) {
    setEstado(e);
    if (e.dados && !iniciado.current) {
      iniciado.current = true;
      setValores(valoresDe(e.dados));
      setFilhos(filhosParaTela(e.dados.filhos));
      // Primeira visita (atualização vem preenchida): do começo, para conferir tudo.
      setEtapa(e.status === "ENVIADA" ? 0 : etapaInicial(e.dados, (e.arquivos?.length ?? 0) > 0));
    }
  }

  function irPara(i: number) {
    setErros({});
    setAviso(null);
    setEtapa(i);
    // Depois de a etapa nova renderizar: rolar antes disso é desfeito pela troca de altura.
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      topo.current?.focus({ preventScroll: true });
    });
  }

  function alterar(nome: string, v: string | boolean | null) {
    setValores((atual) => ({ ...atual, [nome]: v }));
    if (erros[nome]) setErros((atual) => { const { [nome]: _removido, ...resto } = atual; return resto; });
  }

  async function aoSairDoCep() {
    const achado = await buscarCep(String(valores.cep ?? ""));
    if (!achado) return;
    setValores((atual) => ({
      ...atual,
      endereco: atual.endereco || achado.endereco, bairro: atual.bairro || achado.bairro,
      cidade: atual.cidade || achado.cidade, uf: atual.uf || achado.uf,
    }));
  }

  // A chave de acesso vale 2 h: passou disso (ou o RH gerou outro link), o servidor pede a
  // data de nascimento de novo. Volta para a confirmação sem perder o que está digitado —
  // o formulário não é reiniciado (iniciado.current continua true).
  function pedirConfirmacao(e: unknown): boolean {
    if (!(e instanceof ErroFicha) || e.status !== 401 || !e.corpo?.verificacao || !estado) return false;
    setEstado({ ...estado, dados: undefined, verificacao: e.corpo.verificacao as "NASCIMENTO" | "CPF" });
    return true;
  }

  async function salvar(corpo: Dados): Promise<boolean> {
    setSalvando(true);
    try {
      receber(await salvarDados(codigo, corpo));
      return true;
    } catch (e) {
      if (!pedirConfirmacao(e)) setAviso(e instanceof ErroFicha ? e.message : "Não foi possível salvar. Tente de novo.");
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function continuar() {
    const atual = ETAPAS[etapa];
    let corpo: Dados | null = null;
    if (atual.id === "familia") {
      const r = filhosParaSalvar(filhos);
      if ("erros" in r) { setErros(r.erros); return; }
      corpo = { nomeConjuge: String(valores.nomeConjuge ?? "").trim() || null, filhos: r.filhos };
    } else if (atual.campos.length) {
      const r = corpoDaEtapa(atual, valores, estado?.tipo === "ADMISSAO");
      if ("erros" in r) {
        setErros(r.erros);
        setAviso("Confira os campos marcados.");
        const alvo = document.getElementById(`ficha-${Object.keys(r.erros)[0]}`);
        alvo?.scrollIntoView({ behavior: "smooth", block: "center" });
        alvo?.focus({ preventScroll: true });
        return;
      }
      corpo = r.corpo;
    }
    if (corpo && !(await salvar(corpo))) return;
    irPara(etapa + 1);
  }

  async function enviar() {
    if (!consentiu) { setAviso("Marque a confirmação para enviar."); return; }
    setSalvando(true);
    try {
      setEstado(await finalizar(codigo));
    } catch (e) {
      const falta = e instanceof ErroFicha && Array.isArray(e.corpo?.falta) ? (e.corpo!.falta as string[]) : null;
      if (falta && estado) setEstado({ ...estado, falta });
      if (!pedirConfirmacao(e)) setAviso(e instanceof ErroFicha ? e.message : "Não foi possível enviar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  function iniciar() {
    try { sessionStorage.setItem(chaveApresentada(codigo), "1"); } catch { /* aba anônima: mostra de novo ao recarregar */ }
    setApresentada(true);
    // O botão some com a carta: o foco vai para o título da etapa (leitor de tela e teclado).
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      topo.current?.focus({ preventScroll: true });
    });
  }

  if (erroFatal) return <Mensagem titulo="Não foi possível abrir a ficha" texto={erroFatal} />;
  if (!estado) return <Moldura><div className="fp-mensagem"><Loader2 size={28} className="fp-girando" aria-label="Carregando" /></div></Moldura>;
  if (estado.status === "FINALIZADA" || estado.status === "CONCLUIDA") {
    return <Mensagem icone={<CheckCircle2 size={44} className="fp-ok" aria-hidden="true" />} titulo="Ficha enviada com sucesso"
      texto={`${estado.primeiroNome ? `Obrigado, ${estado.primeiroNome}. ` : "Obrigado. "}Suas informações foram recebidas pelo Departamento Pessoal do Pateo da Luz. Se for necessário algum ajuste, entraremos em contato. Você já pode fechar esta página.`} />;
  }
  if (!apresentada) {
    return (
      <Moldura>
        <Apresentacao tipo={estado.tipo} primeiroNome={estado.primeiroNome} expiraEm={estado.expiraEm}
          jaComecou={estado.status === "PREENCHENDO"} onIniciar={iniciar} />
      </Moldura>
    );
  }
  if (estado.verificacao && !estado.dados) {
    return <Verificacao codigo={codigo} metodo={estado.verificacao} onLiberado={receber} />;
  }
  if (!estado.dados || !estado.opcoes) return <Mensagem titulo="Não foi possível abrir a ficha" texto="Recarregue a página. Se o problema continuar, procure o Departamento Pessoal." />;

  const atual = ETAPAS[etapa];
  const ultima = etapa === ETAPAS.length - 1;
  const progresso = Math.round(((etapa + 1) / ETAPAS.length) * 100);

  return (
    <Moldura>
      {etapa === 0 && estado.tipo === "ATUALIZACAO" && (
        <p className="fp-nota">Os dados que já temos aparecem preenchidos. Confira e corrija o que tiver mudado.</p>
      )}
      {estado.motivoDevolucao && <div className="fp-aviso fp-aviso--rh" role="status"><strong>O Departamento Pessoal pediu um ajuste:</strong> {estado.motivoDevolucao}</div>}

      <nav className="fp-progresso" aria-label="Etapas">
        <div className="fp-progresso-barra" aria-hidden="true"><span style={{ width: `${progresso}%` }} /></div>
        <ol className="fp-passos">
          {ETAPAS.map((e, i) => (
            <li key={e.id}>
              <button type="button" className={`fp-passo${i === etapa ? " fp-passo--atual" : ""}${i < etapa ? " fp-passo--feito" : ""}`}
                onClick={() => (i < etapa ? irPara(i) : undefined)} disabled={i > etapa} aria-current={i === etapa ? "step" : undefined}
                aria-label={`Etapa ${i + 1}: ${e.titulo}`}>{i + 1}</button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="fp-cartao" aria-labelledby="fp-titulo-etapa">
        <p className="fp-contador">Etapa {etapa + 1} de {ETAPAS.length}</p>
        <h1 id="fp-titulo-etapa" ref={topo} tabIndex={-1} className="fp-titulo">{atual.titulo}</h1>
        <p className="fp-subtitulo">{atual.resumo}</p>

        {atual.id === "familia" ? (
          <EtapaFamilia nomeConjuge={String(valores.nomeConjuge ?? "")} filhos={filhos} erros={erros}
            onConjuge={(v) => alterar("nomeConjuge", v)} onFilhos={setFilhos} />
        ) : atual.id === "fotos" ? (
          <EtapaFotos codigo={codigo} tipo={estado.tipo} tipos={estado.opcoes.tiposArquivo} obrigatorios={estado.opcoes.arquivosObrigatorios}
            arquivos={estado.arquivos ?? []} onEstado={receber} />
        ) : atual.id === "revisao" ? (
          <EtapaRevisao dados={estado.dados} arquivos={estado.arquivos ?? []} tiposArquivo={estado.opcoes.tiposArquivo} falta={estado.falta ?? []}
            consentiu={consentiu} onConsentir={setConsentiu} onEditar={irPara} />
        ) : (
          <div className="fp-grade">
            {atual.campos
              .filter((c) => c.nome !== "vtTrajeto" || valores.usaVt === true)
              .flatMap((c) => [
                ...(c.grupo ? [<h2 key={`g-${c.grupo}`} className="fp-grupo">{c.grupo}</h2>] : []),
                <CampoFicha key={c.nome} campo={{ ...c, obrigatorio: c.obrigatorio || (c.nome === "vtTrajeto" && estado.tipo === "ADMISSAO") }} valor={valores[c.nome] ?? null}
                  erro={erros[c.nome]} opcoes={estado.opcoes!} onChange={(v) => alterar(c.nome, v)} onBlur={c.nome === "cep" ? aoSairDoCep : undefined} />,
              ])}
          </div>
        )}
      </section>

      {aviso && <p className="fp-aviso fp-aviso--erro" role="alert">{aviso}</p>}

      <div className="fp-rodape">
        {etapa > 0 && (
          <button type="button" className="fp-botao fp-botao--linha" onClick={() => irPara(etapa - 1)} disabled={salvando}>
            <ArrowLeft size={18} aria-hidden="true" /> Voltar
          </button>
        )}
        {ultima ? (
          <button type="button" className="fp-botao fp-botao--principal" onClick={enviar} disabled={salvando || (estado.falta?.length ?? 0) > 0}>
            {salvando ? <Loader2 size={18} className="fp-girando" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />} Enviar ao RH
          </button>
        ) : (
          <button type="button" className="fp-botao fp-botao--principal" onClick={continuar} disabled={salvando}>
            {salvando ? <Loader2 size={18} className="fp-girando" aria-hidden="true" /> : null}
            {atual.id === "fotos" ? "Revisar" : "Salvar e continuar"} <ArrowRight size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </Moldura>
  );
}

export default FichaPublica;
