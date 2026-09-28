import { Plus, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type TipFunction, type TipTeamMember, getTipCompanies, getTipFunctions, getTipTeam, saveTipFunctions, saveTipTeamMember,
} from "../../api/client";
import { Alert, Button, StatusBadge, Table } from "../../design-system";
import { inputStyle, mutedStyle, numInputStyle, panelStyle, pts } from "./gorjetaUtils";

type Props = {
  canEdit: boolean;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
  onChanged: () => void;
};

const nome = (e: TipTeamMember) => (e.displayName || `${e.firstName} ${e.lastName}`).trim();
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

// Quem participa da gorjeta, com que função e em que empresa. Os pontos-base do
// rateio saem daqui: função (ou pontos personalizados). O ajuste de cada mês é
// feito na aba Apuração, sem mexer nesta base.
export function AbaEquipe({ canEdit, onNotice, onChanged }: Props) {
  const [team, setTeam] = useState<TipTeamMember[]>([]);
  const [funcoes, setFuncoes] = useState<TipFunction[]>([]);
  const [empresas, setEmpresas] = useState<Array<{ id: string; tradeName: string }>>([]);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [funcoesSujas, setFuncoesSujas] = useState(false);

  async function carregar() {
    try {
      const [t, f, c] = await Promise.all([getTipTeam(), getTipFunctions(), getTipCompanies()]);
      setTeam(t);
      setFuncoes(f);
      setEmpresas(c);
      setFuncoesSujas(false);
    } catch (e) {
      onNotice("error", (e as Error).message);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, []);

  const funcaoPorId = useMemo(() => new Map(funcoes.filter((f) => f.id).map((f) => [f.id!, f])), [funcoes]);

  async function salvarMembro(m: TipTeamMember, patch: Partial<TipTeamMember>) {
    const novo = { ...m, ...patch };
    setTeam((prev) => prev.map((x) => (x.id === m.id ? novo : x)));
    setSalvando(m.id);
    try {
      await saveTipTeamMember(m.id, {
        participaGorjeta: novo.participaGorjeta, tipoGorjeta: novo.tipoGorjeta, cotaFixaGorjeta: novo.cotaFixaGorjeta,
        pontosPadrao: novo.pontosPadrao, tipFunctionId: novo.tipFunctionId, gorjetaReserva: novo.gorjetaReserva, companyId: novo.companyId,
      });
      onChanged();
    } catch (e) {
      setTeam((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      onNotice("error", (e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  function editarFuncao(i: number, patch: Partial<TipFunction>) {
    setFuncoes((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    setFuncoesSujas(true);
  }

  async function salvarFuncoes() {
    try {
      await saveTipFunctions(funcoes);
      onNotice("success", "Tabela de funções salva. Use \"Atualizar do cadastro\" na Apuração para levar os novos pontos ao período aberto.");
      await carregar();
      onChanged();
    } catch (e) {
      onNotice("error", (e as Error).message);
    }
  }

  const visiveis = team.filter((m) => mostrarInativos || m.isActive || m.participaGorjeta);
  const participantes = team.filter((m) => m.participaGorjeta);
  const somaBase = participantes.filter((m) => m.isActive).reduce((a, m) => {
    const f = m.tipFunctionId ? funcaoPorId.get(m.tipFunctionId) : undefined;
    return a + (m.pontosPadrao ?? f?.points ?? 0);
  }, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <strong>Equipe da gorjeta</strong>
          <span style={mutedStyle}>
            {participantes.length} participantes · <strong>{pts(somaBase)}</strong> pontos-base entre os ativos
            {salvando && " · salvando…"}
          </span>
        </div>
        <span style={mutedStyle}>
          Pontos-base = pontos da função, ou os personalizados quando preenchidos. Sem registro recebe salário + gorjeta na lista de pagamento.
          Reserva: entra no rateio, mas o valor fica na casa e não vai para pagamento.
        </span>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
          Mostrar desligados que não participam
        </label>
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th minWidth={200}>Funcionário</Table.Th>
              <Table.Th>Participa</Table.Th>
              <Table.Th minWidth={200}>Função</Table.Th>
              <Table.Th>Pontos pers.</Table.Th>
              <Table.Th>Base</Table.Th>
              <Table.Th minWidth={160}>Empresa</Table.Th>
              <Table.Th>Reserva</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {visiveis.map((m) => {
              const f = m.tipFunctionId ? funcaoPorId.get(m.tipFunctionId) : undefined;
              const base = m.pontosPadrao ?? f?.points ?? null;
              const foraFaixa = m.pontosPadrao != null && f && (
                (f.minPoints != null && m.pontosPadrao < f.minPoints) || (f.maxPoints != null && m.pontosPadrao > f.maxPoints));
              const off = !canEdit || salvando === m.id;
              return (
                <Table.Row key={m.id}>
                  <Table.Td>
                    <div style={{ fontWeight: 500 }}>{nome(m)}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                      {m.modality === "NAO_CLT" && <StatusBadge tone="warning">Sem registro</StatusBadge>}
                      {!m.isActive && <StatusBadge tone="neutral">Desligado</StatusBadge>}
                    </div>
                  </Table.Td>
                  <Table.Td>
                    <input type="checkbox" checked={m.participaGorjeta} disabled={off} aria-label={`${nome(m)} participa da gorjeta`}
                      onChange={(e) => void salvarMembro(m, { participaGorjeta: e.target.checked })} />
                  </Table.Td>
                  <Table.Td>
                    <select style={inputStyle} value={m.tipFunctionId ?? ""} disabled={off}
                      onChange={(e) => void salvarMembro(m, { tipFunctionId: e.target.value || null })}>
                      <option value="">—</option>
                      {funcoes.filter((x) => x.isActive || x.id === m.tipFunctionId).map((x) => (
                        <option key={x.id} value={x.id}>{x.name} ({pts(x.points)})</option>
                      ))}
                    </select>
                  </Table.Td>
                  <Table.Td>
                    <input key={`${m.id}-${m.pontosPadrao}`} style={numInputStyle} type="number" step="0.5" min="0" disabled={off}
                      defaultValue={m.pontosPadrao ?? ""} placeholder={f ? pts(f.points) : ""}
                      onBlur={(e) => {
                        const v = numOrNull(e.target.value);
                        if (v !== m.pontosPadrao) void salvarMembro(m, { pontosPadrao: v });
                      }} />
                  </Table.Td>
                  <Table.Td style={{ fontWeight: 600, color: foraFaixa ? "var(--warning, #b45309)" : undefined }}
                    title={foraFaixa ? `Fora da faixa da função (${f?.minPoints} a ${f?.maxPoints})` : undefined}>
                    {pts(base)}{foraFaixa ? " ⚠" : ""}
                  </Table.Td>
                  <Table.Td>
                    <select style={inputStyle} value={m.companyId ?? ""} disabled={off}
                      onChange={(e) => void salvarMembro(m, { companyId: e.target.value || null })}>
                      <option value="">—</option>
                      {empresas.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
                    </select>
                  </Table.Td>
                  <Table.Td>
                    <input type="checkbox" checked={m.gorjetaReserva} disabled={off} aria-label={`${nome(m)} guarda a reserva`}
                      onChange={(e) => void salvarMembro(m, { gorjetaReserva: e.target.checked })} />
                  </Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>

      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>Funções e pontos-base</strong>
          {canEdit && (
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" leadingIcon={<Plus size={14} />}
                onClick={() => { setFuncoes((p) => [...p, { name: "", points: 0, minPoints: null, maxPoints: null, group: null, notes: null, isActive: true }]); setFuncoesSujas(true); }}>
                Nova função
              </Button>
              <Button leadingIcon={<Save size={14} />} disabled={!funcoesSujas} onClick={() => void salvarFuncoes()}>Salvar tabela</Button>
            </div>
          )}
        </div>
        {funcoesSujas && <Alert tone="warning">Alterações na tabela ainda não salvas.</Alert>}
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th minWidth={200}>Função / nível</Table.Th>
              <Table.Th>Pontos</Table.Th>
              <Table.Th>Mín.</Table.Th>
              <Table.Th>Máx.</Table.Th>
              <Table.Th>Grupo</Table.Th>
              <Table.Th minWidth={220}>Observação</Table.Th>
              <Table.Th>Ativa</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {funcoes.map((f, i) => (
              <Table.Row key={f.id ?? `nova-${i}`}>
                <Table.Td><input style={inputStyle} value={f.name} disabled={!canEdit} onChange={(e) => editarFuncao(i, { name: e.target.value })} /></Table.Td>
                <Table.Td><input style={numInputStyle} type="number" step="0.5" min="0" value={f.points} disabled={!canEdit} onChange={(e) => editarFuncao(i, { points: Number(e.target.value) })} /></Table.Td>
                <Table.Td><input style={numInputStyle} type="number" step="0.5" min="0" value={f.minPoints ?? ""} disabled={!canEdit} onChange={(e) => editarFuncao(i, { minPoints: numOrNull(e.target.value) })} /></Table.Td>
                <Table.Td><input style={numInputStyle} type="number" step="0.5" min="0" value={f.maxPoints ?? ""} disabled={!canEdit} onChange={(e) => editarFuncao(i, { maxPoints: numOrNull(e.target.value) })} /></Table.Td>
                <Table.Td><input style={{ ...inputStyle, width: 120 }} value={f.group ?? ""} disabled={!canEdit} onChange={(e) => editarFuncao(i, { group: e.target.value || null })} /></Table.Td>
                <Table.Td><input style={inputStyle} value={f.notes ?? ""} disabled={!canEdit} onChange={(e) => editarFuncao(i, { notes: e.target.value || null })} /></Table.Td>
                <Table.Td><input type="checkbox" checked={f.isActive} disabled={!canEdit} onChange={(e) => editarFuncao(i, { isActive: e.target.checked })} /></Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </div>
  );
}
