# Fase 5 — Padrões novos + agrupamento em ondas

> **Status: PROPOSTA — nada disto está codificado.** Aguarda aprovação antes de qualquer linha da Fase 5.
> Complementa `fase-5-inventario.md`.

---

## 1. Padrão de formulário denso — `FormSection` / `FormGrid` / `FormField`

**Proposta: composto de 3 componentes**, substituindo os `<input>`/`<select>`/checkbox nativos que hoje dominam Empresas, Pagamentos, Cadastros base, Fichas Técnicas, Fornecedores, Usuários e Importações (~40% das telas).

- `FormField` envolve QUALQUER controle (TextField, Select do DS, ou nativo estilizado) e padroniza label, erro, hint e ícone — um único lugar para acessibilidade (`htmlFor`/`id`, `aria-describedby`, `aria-invalid`).
- `FormGrid` resolve o layout denso com colunas fixas e colapso mobile automático — mata o CSS Grid manual repetido por tela.
- `FormSection` dá o ritmo visual (eyebrow + título + descrição) que as telas cruas não têm.
- TextField/Select isolados continuam válidos para casos de campo único (busca, filtro inline).

```tsx
<FormSection eyebrow="Cadastro operacional" title="Dados do fornecedor"
  description="Informações fiscais e de contato.">
  <FormGrid cols={3}>
    <FormField label="Razão social" required error={errors.name}>
      <TextField value={form.name} onChange={...} />
    </FormField>
    <FormField label="CNPJ" hint="Somente números">
      <TextField value={form.cnpj} onChange={...} />
    </FormField>
    <FormField label="Ciclo de pagamento">
      <Select options={cycles} value={form.cycle} onChange={...} />
    </FormField>
    <FormField label="Ativo" inline>
      <Switch checked={form.active} onChange={...} />
    </FormField>
  </FormGrid>
</FormSection>
```

Novos componentes necessários: `FormSection`, `FormGrid`, `FormField`, `Switch` (substitui checkbox nativo azul), `Textarea`. Entram no DS **antes** da Onda D, com vitrine em `/design-system`.

---

## 2. Padrão de tabela — `Table` do DS

**Proposta: componente `Table` no DS** (primitivos compostos, não data-grid genérico), substituindo os `<table>` HTML estilizados por CSS de página.

```tsx
<Table>
  <Table.Head>
    <Table.Row>
      <Table.Th>Fornecedor</Table.Th>
      <Table.Th align="right">Total</Table.Th>
      <Table.Th actions />
    </Table.Row>
  </Table.Head>
  <Table.Body>
    <Table.Row onClick={...}>
      <Table.Td truncate title={supplier.name}>{supplier.name}</Table.Td>
      <Table.Td align="right"><Money value={total} /></Table.Td>
      <Table.Td actions>
        <IconButton icon={Pencil} label="Editar" onClick={...} />
        <RowMenu items={[{ label: "Inativar", ... }, { label: "Histórico", ... }]} />
      </Table.Td>
    </Table.Row>
  </Table.Body>
</Table>
```

Decisões embutidas (as 4 perguntas):

| Questão | Proposta |
|---|---|
| DS ou HTML estilizado? | Componente DS. O `<table>` semântico continua por baixo; o DS só padroniza classes/tokens. |
| Texto longo | `truncate` no `Table.Td`: `max-width` + `text-overflow: ellipsis` + `white-space: nowrap` + `title` nativo como tooltip (barato; Tooltip do DS pode substituir depois). Colunas de nome ganham `min-width: 180px` — mata a quebra vertical em 7 linhas de Fornecedores. |
| Botões de ação | **Híbrido, como você recomendou**: 1–2 ações primárias como `IconButton` 40×40 (com `aria-label` + tooltip) + `RowMenu` ("...") via DropdownMenu para as secundárias. Nunca texto "Editar/Inativar" solto na célula. |
| Row hover | `--row-hover: #fffaf0` (token já existe em `colors.css`) aplicado em `Table.Row:hover` — o creme do handoff vira padrão universal. |

Novos componentes necessários: `Table` (+ subcomponentes), `IconButton`, `RowMenu` (porta o DropdownMenu legacy para o DS). Entram **antes** da Onda B (primeira onda com tabela canônica).

---

## 3. Padrão de layout 2-col — `ListDetailLayout`

Hoje só **Usuários** usa lista+editor lado a lado. Nenhuma outra tela usa esse layout exato (Fornecedores/Empresas usam form acima/abaixo da tabela; Fichas Técnicas usa painel sobreposto). O handoff não cobre — proposta nova:

```tsx
<ListDetailLayout
  list={
    <ListDetailLayout.List
      header={<TextField placeholder="Buscar usuário..." icon={Search} />}
      footer={<Button variant="secondary" icon={Plus}>Novo usuário</Button>}
    >
      {users.map((u) => (
        <ListDetailLayout.Item key={u.id} active={u.id === selectedId}
          title={u.name} subtitle={u.role} onClick={() => setSelectedId(u.id)} />
      ))}
    </ListDetailLayout.List>
  }
  detail={selected
    ? <UserEditor user={selected} />
    : <EmptyState title="Selecione um usuário" />}
/>
```

Comportamento: grid `320px + 1fr` no desktop; no mobile colapsa em navegação empilhada (lista → detalhe com botão voltar). Candidatas futuras além de Usuários: Fichas Técnicas (lista de pratos + editor) — avaliar na Onda D, sem forçar.

---

## 4. Agrupamento em 5 ondas

Pré-requisito de cada onda entre parênteses. Rotas que você não citou estão marcadas ⊕ (alocação minha — confirme).

**Onda A — Re-skin barato** *(pré-req: portar Dialog/ConfirmDialog para o DS)*
Fornecedores, Empresas, Compras ⚠️(2.812 ln — mais caro que os vizinhos), Pedidos de compra, Ciclos de fornecedor.
~4–5 commits (1 por tela; Compras pode virar 2).

**Onda B — KPIs + tabela canônica** *(pré-req: Table + IconButton + RowMenu no DS; passo 0: extrair as 5 views do Inventory.tsx em arquivos)*
Contas a pagar, Faturamento, Estoque Visão Geral, Produtos, Contagem de Estoque, ⊕ Requisições.
~6–7 commits (passo 0 + 1 por tela).

**Onda C — Layouts densos**
DRE Gerencial, Caixa, Movimentações, Inventário, ⊕ Relatórios de estoque, ⊕ Planejamento de compra.
~5–6 commits.

**Onda D — Formulários crus** *(pré-req: FormSection/FormGrid/FormField + Switch + Textarea + ListDetailLayout no DS — só após aprovação dos padrões 1 e 3)*
Pagamentos, Cadastros base, Usuários, Fichas Técnicas (inclui Categorias de pratos), Importações (hub + 5 painéis + rota /cadastros).
~7–8 commits (Importações vale 2–3).

**Onda E — Casos especiais**
Dashboard (**bloqueada — ver seção 5**), Cartões, Auditoria, Fechamento mensal, CMV Real, Impostos e Guias.
~5–6 commits.

**Transversal na varredura de cada onda**: corrigir textos sem acento ("codigo", "acoes", "usuario") e trocar eyebrow do PageHeader de breadcrumb duplicado para contexto de negócio ("Cadastro operacional", "Módulo financeiro").

**Estimativa total: 27–32 commits** + 3 commits de componentes DS novos (Table/IconButton/RowMenu; Form*; ListDetailLayout), cada um com vitrine no `/design-system`.

---

## 5. Dashboard: aguardando decisão ⛔

**Nenhuma linha do Dashboard será codificada até o Rafael decidir** entre:

1. **Manter operacional** (competência + alertas + situação do dia) e só re-skin com componentes DS;
2. **Trocar pelo financeiro do handoff** (KPIs + rankings + tabela) — perde os alertas operacionais atuais, a menos que sejam re-incorporados;
3. **Coexistir**: `/` operacional + `/financeiro/painel` (ou similar) com o dashboard financeiro do handoff.

A Onda E não inicia pelo Dashboard; as demais telas da onda não dependem dessa decisão.

---

## 6. Ordem de execução (após aprovação)

1. Aprovação dos padrões 1–3 (este doc) ← **estamos aqui**
2. Componentes DS novos, 3 commits, com testes + vitrine
3. Ondas A → B → C → D → E, cada tela validada localmente antes do commit
4. Dashboard por último, após decisão de produto
5. Nenhum deploy sem autorização explícita (regra permanente do projeto)
