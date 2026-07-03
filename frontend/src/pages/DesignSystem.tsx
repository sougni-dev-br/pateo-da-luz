import {
  BadgeDollarSign,
  Boxes,
  Building2,
  Eye,
  History,
  Package,
  Pencil,
  Percent as PercentIcon,
  Plus,
  PowerOff,
  Search,
  Target,
  TrendingDown,
  Truck,
  Warehouse
} from "lucide-react";
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FormField,
  FormGrid,
  FormSection,
  IconButton,
  KpiCard,
  Money,
  PageHeader,
  Percent,
  RowMenu,
  Select,
  StatusBadge,
  SummaryCard,
  Switch,
  Table,
  Tabs,
  Textarea,
  TextField,
  useHideValues
} from "../design-system";
import "./DesignSystem.css";

const COLOR_TOKENS: { name: string; hex: string; hint?: string }[] = [
  { name: "--ink", hex: "#161512", hint: "texto principal" },
  { name: "--ink-soft", hex: "#26231d" },
  { name: "--coal", hex: "#11100e", hint: "sidebar gradient" },
  { name: "--charcoal", hex: "#1f1d19" },
  { name: "--paper", hex: "#ffffff", hint: "superficie card" },
  { name: "--paper-soft", hex: "#f2f4f7" },
  { name: "--line", hex: "#dfe4ea" },
  { name: "--line-strong", hex: "#c8d0da" },
  { name: "--muted", hex: "#667085", hint: "texto secundario / R$" },
  { name: "--gold", hex: "#b99a58", hint: "acento da marca" },
  { name: "--gold-soft", hex: "#d8c391" },
  { name: "--gold-dark", hex: "#6f5523", hint: "extended" },
  { name: "--gold-tint", hex: "#f7f1e3", hint: "extended" },
  { name: "--success", hex: "#276749" },
  { name: "--warning", hex: "#8a650f" },
  { name: "--danger", hex: "#9f2d2d" },
  { name: "--info", hex: "#2f5f98" },
  { name: "--tint-success", hex: "#eaf4ee", hint: "extended" },
  { name: "--tint-warning", hex: "#fff8e8", hint: "extended" },
  { name: "--tint-danger", hex: "#fdeeee", hint: "extended" },
  { name: "--tint-info", hex: "#eaf1fa", hint: "extended" }
];

const TYPO_SAMPLES: { label: string; className: string; sample: string }[] = [
  { label: "page title 31/700", className: "", sample: "Dashboard financeiro" },
  { label: "kpi 24/700", className: "", sample: "R$ 128.450" },
  { label: "summary 22/700", className: "", sample: "R$ 45.230" },
  { label: "h2 20/600", className: "", sample: "Resumo do mês" },
  { label: "body 14", className: "", sample: "Última atualização às 12:34." },
  { label: "sm 13", className: "", sample: "Fornecedor · Categoria · NF" },
  { label: "xs 12", className: "", sample: "Nota discreta abaixo do valor" },
  { label: "2xs 11", className: "", sample: "EYEBROW / DELTA" }
];

const TYPO_STYLES: React.CSSProperties[] = [
  { fontSize: "var(--fs-page-title)", fontWeight: 700, lineHeight: "var(--lh-tight)", color: "var(--ink)" },
  { fontSize: "var(--fs-kpi)", fontWeight: 700, color: "var(--ink)" },
  { fontSize: "var(--fs-summary)", fontWeight: 700, color: "var(--ink)" },
  { fontSize: "var(--fs-h2)", fontWeight: 600, color: "var(--ink)" },
  { fontSize: "var(--fs-body)", color: "var(--ink)" },
  { fontSize: "var(--fs-sm)", color: "var(--muted)" },
  { fontSize: "var(--fs-xs)", color: "var(--muted)" },
  {
    fontSize: "var(--fs-2xs)",
    color: "var(--muted)",
    letterSpacing: "var(--ls-eyebrow)",
    textTransform: "uppercase",
    fontWeight: 700
  }
];

const SPACING_TOKENS: { name: string; px: number }[] = [
  { name: "--space-1", px: 4 },
  { name: "--space-2", px: 8 },
  { name: "--space-3", px: 12 },
  { name: "--space-4", px: 16 },
  { name: "--space-5", px: 18 },
  { name: "--space-6", px: 20 },
  { name: "--space-7", px: 24 },
  { name: "--space-8", px: 30 }
];

const MONEY_CASES: { label: string; value: number | null | undefined; hidden?: boolean }[] = [
  { label: "positivo grande", value: 128450 },
  { label: "positivo com centavos", value: 1234.56 },
  { label: "zero", value: 0 },
  { label: "negativo", value: -820 },
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "hidden=true (override local)", value: 128450, hidden: true }
];

const PERCENT_CASES: { label: string; value: number | null; decimals?: number }[] = [
  { label: "31,8% (1 casa)", value: 31.8 },
  { label: "31,88% (2 casas)", value: 31.876, decimals: 2 },
  { label: "0,0%", value: 0 },
  { label: "negativo", value: -4.2 },
  { label: "null → travessão", value: null }
];

const DEMO_TABS = [
  { value: "todas", label: "Todas" },
  { value: "abertas", label: "Em aberto" },
  { value: "pagas", label: "Pagas" }
];

const DEMO_SELECT_OPTIONS = [
  { value: "hortifruti", label: "Hortifruti" },
  { value: "carnes", label: "Carnes" },
  { value: "bebidas", label: "Bebidas" }
];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="ds-showcase-section">
      <div className="ds-showcase-section-header">
        <h2>{title}</h2>
        {subtitle && <small>{subtitle}</small>}
      </div>
      {children}
    </section>
  );
}

function ColorSwatch({ name, hex, hint }: { name: string; hex: string; hint?: string }) {
  return (
    <div className="ds-showcase-color-swatch">
      <span className="chip" style={{ background: `var(${name})` }} />
      <span className="meta">
        <strong>{name}</strong>
        <code>{hex}{hint ? ` · ${hint}` : ""}</code>
      </span>
    </div>
  );
}

export function DesignSystem() {
  const { hidden, toggle } = useHideValues();
  const [tab, setTab] = useState("todas");
  const [text, setText] = useState("");
  const [sel, setSel] = useState("");
  const [switchOn, setSwitchOn] = useState(true);

  return (
    <div className="ds-showcase">
      <div className="ds-showcase-content">
        <PageHeader
          eyebrow="Design System"
          title="Primitivos"
          description="Referência viva dos componentes do DS Pateo da Luz. Dev-only."
          actions={
            <Button variant="secondary" size="sm" onClick={toggle}>
              {hidden ? "Mostrar valores" : "Ocultar valores"}
            </Button>
          }
        />

        {/* ─── Tokens ─── */}
        <Section title="Tokens · Cores" subtitle="handoff colors.css + tints.css estendido">
          <div className="ds-showcase-grid-3">
            {COLOR_TOKENS.map((c) => (
              <ColorSwatch key={c.name} name={c.name} hex={c.hex} hint={c.hint} />
            ))}
          </div>
        </Section>

        <Section title="Tokens · Tipografia" subtitle="Inter, escala em px">
          <Card>
            {TYPO_SAMPLES.map((sample, i) => (
              <div key={sample.label} className="ds-showcase-typography-sample">
                <small>{sample.label}</small>
                <div style={TYPO_STYLES[i]}>{sample.sample}</div>
              </div>
            ))}
          </Card>
        </Section>

        <Section title="Tokens · Spacing" subtitle="escala de 4 a 30px">
          <Card>
            {SPACING_TOKENS.map((s) => (
              <div key={s.name} className="ds-showcase-spacing-row">
                <span style={{ width: 90 }}>{s.name}</span>
                <span className="bar" style={{ width: s.px }} />
                <span>{s.px}px</span>
              </div>
            ))}
          </Card>
        </Section>

        {/* ─── Money & Percent ─── */}
        <Section
          title="Money & Percent"
          subtitle={`hideValues global = ${hidden ? "on (••••)" : "off (visível)"}`}
        >
          <div className="ds-showcase-grid-2">
            <Card>
              <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600 }}>Money</h3>
              {MONEY_CASES.map((c) => (
                <div key={c.label} className="ds-showcase-money-case" style={{ marginBottom: 8 }}>
                  <code>{c.label}</code>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>
                    <Money value={c.value} hidden={c.hidden} />
                  </div>
                </div>
              ))}
            </Card>
            <Card>
              <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600 }}>Percent</h3>
              {PERCENT_CASES.map((c) => (
                <div key={c.label} className="ds-showcase-money-case" style={{ marginBottom: 8 }}>
                  <code>{c.label}</code>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>
                    <Percent value={c.value} decimals={c.decimals} />
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </Section>

        {/* ─── Buttons ─── */}
        <Section title="Buttons" subtitle="4 variantes × 2 tamanhos × estados">
          <div className="ds-showcase-row">
            <Button>Primary md</Button>
            <Button size="sm">Primary sm</Button>
            <Button leadingIcon={<Plus size={16} />}>Com ícone</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="ds-showcase-row">
            <Button variant="secondary">Secondary md</Button>
            <Button variant="secondary" size="sm">Secondary sm</Button>
            <Button variant="secondary" leadingIcon={<Search size={16} />}>Buscar</Button>
            <Button variant="secondary" disabled>Disabled</Button>
          </div>
          <div className="ds-showcase-row">
            <Button variant="danger">Danger md</Button>
            <Button variant="danger" size="sm">Danger sm</Button>
            <Button variant="danger" disabled>Disabled</Button>
          </div>
          <div className="ds-showcase-row">
            <Button variant="icon" aria-label="buscar"><Search size={18} /></Button>
            <Button variant="icon" aria-label="adicionar"><Plus size={18} /></Button>
            <Button variant="icon" aria-label="disabled" disabled><Search size={18} /></Button>
          </div>
        </Section>

        {/* ─── Cards ─── */}
        <Section title="Cards" subtitle="base + interactive (hover: lift + border strong)">
          <div className="ds-showcase-grid-2">
            <Card>
              <strong>Card base</strong>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>
                Superfície estática. Sem hover.
              </p>
            </Card>
            <Card interactive tabIndex={0}>
              <strong>Card interactive</strong>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>
                Hover: sobe 1px, borda reforça, sombra aumenta.
              </p>
            </Card>
          </div>
        </Section>

        {/* ─── Status & Feedback ─── */}
        <Section title="Status & Feedback">
          <div className="ds-showcase-row">
            <StatusBadge tone="neutral">Neutro</StatusBadge>
            <StatusBadge tone="success">Pago</StatusBadge>
            <StatusBadge tone="warning">Em aberto</StatusBadge>
            <StatusBadge tone="danger">Vencido</StatusBadge>
            <StatusBadge tone="info">Enviado</StatusBadge>
          </div>
          <Alert tone="info">Sistema online — última verificação há 12s.</Alert>
          <Alert tone="success">Pagamento confirmado.</Alert>
          <Alert tone="warning">3 contas vencem esta semana.</Alert>
          <Alert tone="error">Erro ao carregar catálogo. Tente novamente.</Alert>
          <EmptyState
            title="Nenhuma compra registrada em junho"
            description="Importe uma NF-e ou lance manualmente para começar a rastrear o CMV."
            action={<Button leadingIcon={<Plus size={16} />}>Nova compra</Button>}
          />
        </Section>

        {/* ─── Navegação ─── */}
        <Section title="Navegação">
          <PageHeader
            eyebrow="Financeiro / Contas a pagar"
            title="Contas a pagar"
            description="Vencimentos e status do mês corrente."
            actions={
              <>
                <Button variant="secondary" size="sm">Exportar</Button>
                <Button size="sm" leadingIcon={<Plus size={16} />}>Nova conta</Button>
              </>
            }
          />
          <Tabs tabs={DEMO_TABS} value={tab} onChange={setTab} />
        </Section>

        {/* ─── Forms ─── */}
        <Section title="Forms">
          <div className="ds-showcase-form-grid">
            <TextField
              label="Fornecedor"
              placeholder="Digite o nome"
              value={text}
              onChange={(e) => setText(e.target.value)}
              hint="Busca por razão social ou CNPJ"
            />
            <TextField label="Email" defaultValue="marcos@pateo.local" disabled />
            <TextField
              label="CNPJ"
              error="Formato inválido — use 00.000.000/0000-00"
              defaultValue="123"
            />
            <Select
              label="Categoria"
              options={DEMO_SELECT_OPTIONS}
              placeholder="Selecione"
              value={sel}
              onChange={(e) => setSel(e.target.value)}
            />
            <Select
              label="Regime"
              options={[
                { value: "simples", label: "Simples Nacional" },
                { value: "lucro-real", label: "Lucro Real" }
              ]}
              value="simples"
              hint="Disabled: aparência bloqueada"
              disabled
            />
            <Select
              label="Fornecedor"
              options={DEMO_SELECT_OPTIONS}
              error="Escolha um fornecedor"
              placeholder="Selecione"
            />
          </div>
        </Section>

        {/* ─── Formulário denso (Fase 5.0) ─── */}
        <Section
          title="Formulário denso"
          subtitle="FormSection + FormGrid + FormField + Switch + Textarea"
        >
          <Card>
            <FormSection
              eyebrow="Cadastro operacional"
              title="Dados do fornecedor"
              description="Informações fiscais e de contato."
              actions={<Button variant="secondary" size="sm">Limpar</Button>}
            >
              <FormGrid cols={3}>
                <FormField label="Razão social" required>
                  <TextField placeholder="Nome da empresa" />
                </FormField>
                <FormField label="CNPJ" hint="Somente números">
                  <TextField placeholder="00.000.000/0000-00" />
                </FormField>
                <FormField label="Categoria" error="Escolha uma categoria">
                  <Select options={DEMO_SELECT_OPTIONS} placeholder="Selecione" />
                </FormField>
                <FormField label="Fornecedor ativo" inline>
                  <Switch checked={switchOn} onChange={setSwitchOn} />
                </FormField>
                <div className="ds-form-grid-span-all">
                  <FormField label="Observações" hint="Visível apenas internamente">
                    <Textarea placeholder="Anotações do fornecedor..." />
                  </FormField>
                </div>
              </FormGrid>
            </FormSection>
            <FormSection eyebrow="Financeiro" title="Condições de pagamento">
              <FormGrid cols={2}>
                <FormField label="Prazo (dias)">
                  <TextField type="number" defaultValue={28} />
                </FormField>
                <FormField label="Forma preferida">
                  <Select
                    options={[
                      { value: "pix", label: "PIX" },
                      { value: "boleto", label: "Boleto" }
                    ]}
                    placeholder="Selecione"
                  />
                </FormField>
              </FormGrid>
            </FormSection>
          </Card>
        </Section>

        {/* ─── Tabela canônica (Fase 5.0) ─── */}
        <Section
          title="Tabela canônica"
          subtitle="Table + IconButton 40x40 + RowMenu · truncate com tooltip · row hover creme"
        >
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th minWidth={180}>Fornecedor</Table.Th>
                <Table.Th>Categoria</Table.Th>
                <Table.Th align="right">Total do mês</Table.Th>
                <Table.Th align="center">Status</Table.Th>
                <Table.Th actions>Ações</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              <Table.Row>
                <Table.Td truncate title="Distribuidora Hortifruti Central do Vale Ltda ME">
                  Distribuidora Hortifruti Central do Vale Ltda ME
                </Table.Td>
                <Table.Td>Hortifruti</Table.Td>
                <Table.Td align="right"><Money value={12480} /></Table.Td>
                <Table.Td align="center"><StatusBadge tone="success">Ativo</StatusBadge></Table.Td>
                <Table.Td actions>
                  <IconButton icon={<Pencil size={16} />} label="Editar" />
                  <RowMenu
                    items={[
                      { label: "Ver histórico", icon: <History size={15} /> },
                      { label: "Ver compras", icon: <Eye size={15} /> },
                      { separator: true },
                      { label: "Inativar", icon: <PowerOff size={15} />, tone: "danger" }
                    ]}
                  />
                </Table.Td>
              </Table.Row>
              <Table.Row>
                <Table.Td truncate>Casa de Carnes Bom Corte</Table.Td>
                <Table.Td>Carnes</Table.Td>
                <Table.Td align="right"><Money value={31240} /></Table.Td>
                <Table.Td align="center"><StatusBadge tone="warning">Pendente</StatusBadge></Table.Td>
                <Table.Td actions>
                  <IconButton icon={<Pencil size={16} />} label="Editar" />
                  <RowMenu
                    items={[
                      { label: "Ver histórico", icon: <History size={15} /> },
                      { separator: true },
                      { label: "Inativar", icon: <PowerOff size={15} />, tone: "danger" }
                    ]}
                  />
                </Table.Td>
              </Table.Row>
              <Table.Row>
                <Table.Td truncate>Bebidas Serra Azul</Table.Td>
                <Table.Td>Bebidas</Table.Td>
                <Table.Td align="right"><Money value={8020} /></Table.Td>
                <Table.Td align="center"><StatusBadge tone="danger">Inativo</StatusBadge></Table.Td>
                <Table.Td actions>
                  <IconButton icon={<Pencil size={16} />} label="Editar" />
                  <IconButton icon={<PowerOff size={16} />} label="Reativar" variant="danger" />
                </Table.Td>
              </Table.Row>
            </Table.Body>
          </Table>
        </Section>

        {/* ─── Compostos ─── */}
        <Section title="Compostos · SummaryCard" subtitle="valor + detalhe + chip tonalizado">
          <div className="ds-showcase-grid-4">
            <SummaryCard
              label="Total"
              value="R$ 128.450"
              detail="junho/2026 · 42 lançamentos"
              icon={<BadgeDollarSign size={18} />}
            />
            <SummaryCard
              label="Pago"
              value="R$ 84.120"
              detail="65,4% do total"
              tone="success"
              icon={<Target size={18} />}
            />
            <SummaryCard
              label="Em aberto"
              value="R$ 30.100"
              detail="12 lançamentos"
              tone="warning"
              icon={<Boxes size={18} />}
            />
            <SummaryCard
              label="Vencido"
              value="R$ 14.230"
              detail="3 lançamentos"
              tone="danger"
              icon={<TrendingDown size={18} />}
            />
          </div>
          <div className="ds-showcase-grid-4" style={{ marginTop: 16 }}>
            <SummaryCard label="Fornecedores ativos" value="42" detail="+3 este mês" tone="info" icon={<Truck size={18} />} />
            <SummaryCard label="Regime" value="Simples Nacional" detail="atualizado 12/06" tone="neutral" icon={<Building2 size={18} />} />
            <SummaryCard label="Produtos" value={187} detail="12 sem preço" tone="neutral" icon={<Package size={18} />} />
            <SummaryCard label="Estoque" value="R$ 62.400" detail="posição atual" tone="info" icon={<Warehouse size={18} />} />
          </div>
        </Section>

        <Section
          title="Compostos · KpiCard"
          subtitle="barra topo + chip + delta + sparkline · Money interno respeita hideValues"
        >
          <div className="ds-showcase-grid-4">
            <KpiCard
              label="Receita líquida"
              value="R$ 214.500"
              sub="vs. R$ 197.200 mês anterior"
              tone="success"
              icon={<BadgeDollarSign size={18} />}
              delta={{ text: "+8,7%", direction: "up" }}
              sparkline={[3, 5, 4, 6, 7, 9, 8, 11]}
            />
            <KpiCard
              label="CMV"
              value="31,8%"
              sub="Meta: 30%"
              tone="warning"
              icon={<PercentIcon size={18} />}
              delta={{ text: "+1,8pp", direction: "flat" }}
              sparkline={[30, 31, 30, 32, 31, 31.5, 31.8, 31.8]}
            />
            <KpiCard
              label="Ticket médio"
              value="R$ 62"
              sub="salão + delivery"
              tone="info"
              icon={<Target size={18} />}
              delta={{ text: "-2,1%", direction: "down" }}
              sparkline={[68, 66, 65, 64, 62, 63, 62, 62]}
            />
            <KpiCard
              label="Resultado"
              value="R$ 32.100"
              sub="após despesas"
              tone="neutral"
              icon={<TrendingDown size={18} />}
              delta={{ text: "+3,2%", direction: "up" }}
              sparkline={[24, 25, 27, 26, 28, 30, 31, 32]}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
