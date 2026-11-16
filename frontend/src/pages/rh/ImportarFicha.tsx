// RH → Funcionários → Importar ficha da contabilidade.
// O PDF "Ficha de Empregado" é lido no servidor e vira uma lista do que mudaria em cada cadastro.
// Nada é gravado até marcar os itens e confirmar: só entra o que está marcado, e o servidor refaz
// a conta na hora de gravar.
import { ArrowLeft, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type FichaItemImportacao, type FichaPessoaPrevista, type FichaPrevia, type FichaResultadoPessoa,
  aplicarFichaRegistro, previaFichaRegistro,
} from "../../api/client";
import { Notice, useNotice } from "../../components/Notice";
import { useSession } from "../../context/SessionContext";
import { Alert, Button, Card, EmptyState, FormField, PanelEyebrow, StatusBadge, TextField } from "../../design-system";
import { hasPermission } from "../../lib/permissions";
import {
  ROTULO_SITUACAO, ROTULO_TIPO, type Selecao, alternar, itensPorTipo, marcarTodos, podeMarcar,
  selecaoInicial, selecoesParaEnvio, temSalario, totais,
} from "./fichaImportacao";
import { ROTAS_RH } from "./rotasRh";

const MUTED = "var(--muted)";
const MOTIVO_SALARIO = "Dissídio 2026, conforme ficha de registro da contabilidade";
const TOM_SITUACAO = { COM_ITENS: "info", EM_DIA: "success", SEM_CADASTRO: "neutral", CPF_DUPLICADO: "danger", NOME_DIFERENTE: "danger" } as const;

function ItemLinha({ item, marcado, onAlternar }: { item: FichaItemImportacao; marcado: boolean; onAlternar: () => void }) {
  const livre = podeMarcar(item);
  return (
    <li style={{ listStyle: "none", padding: "6px 0", borderTop: "1px solid var(--border)", opacity: livre ? 1 : 0.7 }}>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: livre ? "pointer" : "not-allowed" }}>
        <input type="checkbox" checked={marcado && livre} disabled={!livre} onChange={onAlternar} style={{ marginTop: 4 }}
          aria-label={`${item.rotulo}${item.ficha ? `: ${item.ficha}` : ""}`} />
        <span style={{ flex: 1 }}>
          <strong>{item.rotulo}</strong>
          {(item.atual !== null || item.ficha !== null) && (
            <span style={{ marginLeft: 8 }}>
              <span style={{ color: MUTED }}>{item.atual ?? "vazio"}</span>
              <span aria-hidden> → </span>
              <span>{item.ficha ?? "—"}</span>
            </span>
          )}
          {item.detalhes.map((d) => <div key={d} style={{ fontSize: 13, color: MUTED }}>{d}</div>)}
          {item.bloqueio && <div style={{ fontSize: 13, color: "var(--danger, #b42318)" }}>Não pode ser gravado: {item.bloqueio}</div>}
        </span>
      </label>
    </li>
  );
}

function CartaoDaPessoa({ pessoa, marcados, onAlternar, onTodos }: {
  pessoa: FichaPessoaPrevista; marcados: string[]; onAlternar: (id: string) => void; onTodos: (marcar: boolean) => void;
}) {
  const grupos = itensPorTipo(pessoa.itens);
  const livres = pessoa.itens.filter(podeMarcar).length;
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <strong>{pessoa.nome}</strong>
          <div style={{ fontSize: 13, color: MUTED }}>
            Registro {pessoa.registro}
            {pessoa.cadastro && ` · cadastro: ${pessoa.cadastro.nome}${pessoa.cadastro.cargo ? ` · ${pessoa.cadastro.cargo}` : ""}${pessoa.cadastro.empresa ? ` · ${pessoa.cadastro.empresa}` : ""}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <StatusBadge tone={TOM_SITUACAO[pessoa.situacao]}>{ROTULO_SITUACAO[pessoa.situacao]}</StatusBadge>
          {livres > 0 && (
            <>
              <Button variant="secondary" onClick={() => onTodos(true)} title="Não inclui as trocas de dados pessoais: essas se marcam uma a uma">Marcar tudo</Button>
              <Button variant="secondary" onClick={() => onTodos(false)} disabled={marcados.length === 0}>Desmarcar</Button>
            </>
          )}
        </div>
      </div>

      {pessoa.situacao === "SEM_CADASTRO" && <p style={{ color: MUTED }}>Não há funcionário com o CPF desta ficha. A importação não cria cadastro.</p>}
      {pessoa.situacao === "CPF_DUPLICADO" && <p style={{ color: MUTED }}>O CPF desta ficha está em mais de um cadastro, ou a pessoa aparece em duas fichas do PDF: resolva antes de importar.</p>}
      {pessoa.situacao === "EM_DIA" && <p style={{ color: MUTED }}>O cadastro já está igual à ficha.</p>}

      {grupos.map((g) => (
        <section key={g.tipo} style={{ marginTop: 12 }}>
          <PanelEyebrow>{ROTULO_TIPO[g.tipo]}</PanelEyebrow>
          <ul style={{ margin: 0, padding: 0 }}>
            {g.itens.map((i) => <ItemLinha key={i.id} item={i} marcado={marcados.includes(i.id)} onAlternar={() => onAlternar(i.id)} />)}
          </ul>
        </section>
      ))}

      {pessoa.suspeitos.length > 0 && (
        <Alert tone="warning">
          <strong>Corrigir com a contabilidade (não entram no cadastro):</strong>
          <ul style={{ margin: "4px 0 0 18px" }}>{pessoa.suspeitos.map((s) => <li key={s}>{s}</li>)}</ul>
        </Alert>
      )}
      {pessoa.observacoes.length > 0 && <div style={{ marginTop: 8, fontSize: 13, color: MUTED }}>{pessoa.observacoes.map((o) => <div key={o}>{o}</div>)}</div>}
    </Card>
  );
}

export function ImportarFicha() {
  const { user } = useSession();
  const navigate = useNavigate();
  const { notice, setNotice } = useNotice(8000);
  const podeAplicar = hasPermission(user, "employees", "edit");
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [desde, setDesde] = useState("");
  const [motivo, setMotivo] = useState(MOTIVO_SALARIO);
  const [previa, setPrevia] = useState<FichaPrevia | null>(null);
  const [selecao, setSelecao] = useState<Selecao>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<FichaResultadoPessoa[] | null>(null);

  async function ler(file: File, desdeUsado: string) {
    setOcupado(true);
    setErro(null);
    try {
      const nova = await previaFichaRegistro(file, desdeUsado || null);
      setPrevia(nova);
      setSelecao(selecaoInicial(nova.pessoas));
    } catch (e) {
      setPrevia(null);
      setErro(e instanceof Error ? e.message : "Não consegui ler a ficha.");
    } finally {
      setOcupado(false);
    }
  }

  function escolher(lista: FileList | null) {
    const file = lista?.[0];
    if (!file) return;
    setArquivo(file);
    setResultado(null);
    void ler(file, desde);
  }

  async function aplicar() {
    if (!arquivo || !previa) return;
    setOcupado(true);
    setErro(null);
    try {
      const envio = selecoesParaEnvio(selecao, previa.pessoas);
      // A data usada na leitura (não a que está no campo agora): o que se grava é o que foi mostrado.
      const { resultados } = await aplicarFichaRegistro(arquivo, envio, previa.desde, temSalario(selecao) ? motivo.trim() || null : null);
      setResultado(resultados);
      const gravados = resultados.reduce((n, r) => n + r.aplicados.length, 0);
      setNotice({ tone: gravados > 0 ? "success" : "error", message: gravados > 0 ? `${gravados} item(ns) gravado(s).` : "Nada foi gravado: veja os motivos abaixo." });
      // Rele a prévia: o que foi gravado some da lista e o que ficou pendente continua.
      await ler(arquivo, previa.desde ?? "");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui gravar.");
    } finally {
      setOcupado(false);
    }
  }

  const marcados = totais(selecao);
  const pessoas = previa?.pessoas ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice notice={notice} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Funcionários</PanelEyebrow>
            <h2>Importar ficha da contabilidade</h2>
          </div>
          <Button variant="secondary" leadingIcon={<ArrowLeft size={14} />} onClick={() => navigate(ROTAS_RH.funcionarios)}>Voltar</Button>
        </div>

        <Alert tone="info">
          Suba o PDF &quot;Ficha de Empregado&quot; (pode ter várias pessoas). Nada é gravado agora: o sistema só mostra o que mudaria em cada
          cadastro. Campos vazios já vêm marcados; o que difere do cadastro, salário, cargo e empresa você marca se quiser trocar.
        </Alert>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", margin: "12px 0" }}>
          <input ref={inputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => escolher(e.target.files)} data-testid="arquivo-ficha" />
          <Button leadingIcon={<FileUp size={14} />} onClick={() => inputRef.current?.click()} disabled={ocupado}>
            {arquivo ? "Trocar PDF" : "Selecionar PDF da ficha"}
          </Button>
          <FormField label="Salários a partir de (opcional)">
            <TextField type="date" value={desde} onChange={(e) => setDesde(e.target.value)} disabled={ocupado} />
          </FormField>
          {arquivo && <Button variant="secondary" onClick={() => void ler(arquivo, desde)} disabled={ocupado}>Reler com esta data</Button>}
          {arquivo && <span style={{ color: MUTED, fontSize: 13 }}>{arquivo.name}</span>}
        </div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>
          Sem a data, os salários da ficha não são propostos. Com ela (ex.: 01/11/2026), entram os reajustes dali em diante, sem mexer no passado.
        </div>

        {ocupado && <EmptyState title="Processando…" />}
        {erro && <Alert tone="error">{erro}</Alert>}

        {resultado && resultado.some((r) => r.ignorados.length > 0) && (
          <Alert tone="warning">
            <strong>Não foram gravados:</strong>
            <ul style={{ margin: "4px 0 0 18px" }}>
              {resultado.flatMap((r) => r.ignorados.map((i) => <li key={`${r.employeeId}:${i.id}`}>{r.nome} — {i.id}: {i.motivo}</li>))}
            </ul>
          </Alert>
        )}

        {!ocupado && previa && pessoas.length === 0 && <EmptyState title="Nenhuma ficha encontrada neste PDF." />}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {pessoas.map((p) => (
            <CartaoDaPessoa key={p.chave} pessoa={p} marcados={selecao[p.chave] ?? []}
              onAlternar={(id) => setSelecao((s) => alternar(s, p.chave, id))}
              onTodos={(marcar) => setSelecao((s) => marcarTodos(s, p, marcar))} />
          ))}
        </div>

        {previa && pessoas.length > 0 && (
          <div style={{ position: "sticky", bottom: 0, background: "var(--surface, #fff)", borderTop: "1px solid var(--border)", padding: "12px 0", marginTop: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            {temSalario(selecao) && (
              <FormField label="Motivo do reajuste (vai no histórico do cadastro)">
                <TextField value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
              </FormField>
            )}
            <Button onClick={() => void aplicar()} disabled={ocupado || marcados.itens === 0 || !podeAplicar}
              title={podeAplicar ? undefined : "Exige a permissão de editar Funcionários."}>
              {marcados.itens === 0 ? "Marque o que aplicar" : `Aplicar ${marcados.itens} item(ns) em ${marcados.pessoas} pessoa(s)`}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
