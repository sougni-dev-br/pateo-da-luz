import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ExtraDiaria, ExtraPessoaFora, ExtraPessoas } from "../../../api/client";
import { Button, EmptyState, PanelEyebrow, RowMenu, StatusBadge, Switch, Table, TextField } from "../../../design-system";
import { PIX_ROTULO, brl, diariasTexto } from "./extrasRotulos";
import type { PessoaEscolhida } from "./DiariaModal";

type Props = {
  pessoas: ExtraPessoas;
  diarias: ExtraDiaria[];
  emRisco: Set<string>; // pessoas de fora com frequência alta (risco de vínculo)
  mesRotulo: string;
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
  onLancar: (p: PessoaEscolhida) => void;
  onNovaFora: () => void;
  onEditarFora: (p: ExtraPessoaFora) => void;
  onExcluirFora: (p: ExtraPessoaFora) => void;
};

const normaliza = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ExtrasPessoas({ pessoas, diarias, emRisco, mesRotulo, podeCriar, podeEditar, podeExcluir, onLancar, onNovaFora, onEditarFora, onExcluirFora }: Props) {
  const [busca, setBusca] = useState("");
  const [verDesligados, setVerDesligados] = useState(false);

  // Diárias realizadas no mês, por pessoa — o que cada um já custou.
  const noMes = useMemo(() => {
    const mapa = new Map<string, { qtd: number; total: number }>();
    for (const d of diarias) {
      if (d.status !== "REALIZADA") continue;
      const atual = mapa.get(d.pessoaId) ?? { qtd: 0, total: 0 };
      mapa.set(d.pessoaId, { qtd: atual.qtd + (d.duration === "MEIA" ? 0.5 : 1), total: atual.total + d.totalAmount });
    }
    return mapa;
  }, [diarias]);

  const filtro = normaliza(busca.trim());
  const combina = (nome: string, apelido: string | null) => !filtro || normaliza(`${nome} ${apelido ?? ""}`).includes(filtro);
  const casa = pessoas.casa.filter((p) => (verDesligados || p.ativo) && combina(p.nome, p.apelido));
  const fora = pessoas.fora.filter((p) => (verDesligados || p.ativo) && combina(p.nome, p.apelido));

  const celulaMes = (id: string) => {
    const m = noMes.get(id);
    return m ? <span className="extras-num">{diariasTexto(m.qtd)} · {brl(m.total)}</span> : <span className="extras-sub">—</span>;
  };

  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <TextField value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome ou apelido" aria-label="Buscar pessoa" />
        </div>
        <Switch checked={verDesligados} onChange={setVerDesligados} label="Mostrar desligados e inativos" />
        <span className="extras-sub">Mostrar desligados e inativos</span>
      </div>

      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Do cadastro de Funcionários</PanelEyebrow>
            <h2>Equipe da casa</h2>
          </div>
        </div>
        <p className="extras-sub" style={{ marginTop: 0 }}>
          Quem já trabalha no restaurante, CLT ou sem registro. Não precisa cadastrar de novo: dados, setor e PIX ficam no cadastro de Funcionários.
        </p>
        {casa.length === 0 ? (
          <EmptyState title="Ninguém encontrado" description="Ajuste a busca ou mostre os desligados." />
        ) : (
          <Table className="extras-tabela">
            <Table.Head>
              <Table.Row>
                <Table.Th>Nome</Table.Th>
                <Table.Th className="extras-ocultar-celular">Setor</Table.Th>
                <Table.Th className="extras-ocultar-celular">Vínculo</Table.Th>
                <Table.Th>Em {mesRotulo}</Table.Th>
                <Table.Th aria-label="Ações" />
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {casa.map((p) => (
                <Table.Row key={p.id}>
                  <Table.Td>
                    <strong>{p.nome}</strong>
                    {p.apelido && <div className="extras-sub">{p.apelido}</div>}
                  </Table.Td>
                  <Table.Td className="extras-ocultar-celular">{p.setor ?? "—"}</Table.Td>
                  <Table.Td className="extras-ocultar-celular">
                    {p.ativo
                      ? <StatusBadge tone="neutral">{p.modalidade === "CLT" ? "CLT" : "Sem registro"}</StatusBadge>
                      : <StatusBadge tone="warning">Desligado</StatusBadge>}
                  </Table.Td>
                  <Table.Td>{celulaMes(p.id)}</Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {podeCriar && (
                      <Button variant="secondary" leadingIcon={<Plus size={14} />} onClick={() => onLancar({ tipo: "CASA", id: p.id })} aria-label={`Lançar diária para ${p.nome}`}><span className="extras-rotulo-botao">Diária</span></Button>
                    )}
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Indicação</PanelEyebrow>
            <h2>Pessoas de fora</h2>
          </div>
          {podeCriar && <Button leadingIcon={<Plus size={14} />} onClick={onNovaFora}>Nova pessoa de fora</Button>}
        </div>
        {fora.length === 0 ? (
          <EmptyState
            title="Nenhuma pessoa de fora cadastrada"
            description="Cadastre aqui quem vem por indicação e não é funcionário. Também dá para cadastrar na hora de lançar a diária."
          />
        ) : (
          <Table className="extras-tabela">
            <Table.Head>
              <Table.Row>
                <Table.Th>Nome</Table.Th>
                <Table.Th className="extras-ocultar-celular">Telefone</Table.Th>
                <Table.Th className="extras-ocultar-celular">Indicado por</Table.Th>
                {pessoas.podeVerDados && <Table.Th className="extras-ocultar-celular">PIX</Table.Th>}
                <Table.Th>Em {mesRotulo}</Table.Th>
                <Table.Th aria-label="Ações" />
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {fora.map((p) => (
                <Table.Row key={p.id}>
                  <Table.Td>
                    <strong>{p.nome}</strong>
                    {!p.ativo && <> <StatusBadge tone="neutral">Inativo</StatusBadge></>}
                    {emRisco.has(p.id) && <> <StatusBadge tone="warning">Frequência alta</StatusBadge></>}
                    {p.apelido && <div className="extras-sub">{p.apelido}</div>}
                  </Table.Td>
                  <Table.Td className="extras-ocultar-celular">{p.telefone ?? "—"}</Table.Td>
                  <Table.Td className="extras-ocultar-celular">{p.indicadoPor ?? "—"}</Table.Td>
                  {pessoas.podeVerDados && (
                    <Table.Td className="extras-ocultar-celular">
                      {p.pixKey ? <>{p.pixKey} <span className="extras-sub">({p.pixKeyType ? PIX_ROTULO[p.pixKeyType] : "?"})</span></> : <span className="extras-sub">sem PIX</span>}
                    </Table.Td>
                  )}
                  <Table.Td>{celulaMes(p.id)}</Table.Td>
                  <Table.Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {podeCriar && p.ativo && (
                      <Button variant="secondary" leadingIcon={<Plus size={14} />} onClick={() => onLancar({ tipo: "FORA", id: p.id })} aria-label={`Lançar diária para ${p.nome}`}><span className="extras-rotulo-botao">Diária</span></Button>
                    )}
                    {(podeEditar || podeExcluir) && (
                      <RowMenu
                        items={[
                          ...(podeEditar ? [{ label: "Editar cadastro", icon: <Pencil size={14} />, onClick: () => onEditarFora(p) }] : []),
                          ...(podeExcluir ? [{ label: "Excluir", icon: <Trash2 size={14} />, tone: "danger" as const, onClick: () => onExcluirFora(p) }] : []),
                        ]}
                      />
                    )}
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </section>
    </div>
  );
}
