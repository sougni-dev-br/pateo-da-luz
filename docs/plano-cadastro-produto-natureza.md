# Plano: natureza do item + nova tela de cadastro de produto

Status: proposta (nada implementado). Dados citados vêm do banco local (805 produtos); conferir em produção antes da fase 3.

## Problema

- A tela [Products.tsx](../frontend/src/pages/Products.tsx) (1587 linhas) empilha indicadores, formulário de 5 abas sempre aberto e só depois a lista.
- O backend só exige `name` ([product.schemas.ts](../backend/src/modules/products/product.schemas.ts)); categoria, setor, DRE e unidade ficam opcionais, então o cadastro sai incompleto.
- Não existe campo "o que é este item". O sistema deduz de `dreCategory.dreGroup` (`CMV_COMPRAS` entra no CMV). A categoria `DESPESAS` mistura insumo de cozinha com despesa de escritório; `LIMPEZA` controla estoque mas não é CMV. `accountType` é texto livre (338 de 805 vazios).

## Decisões de modelo

1. **Novo enum `ProductNature`** em `Product.nature` (nullable no início, depois obrigatório para novos):

   | Valor | Significado | DRE padrão (grupo) | controlsStock padrão |
   |---|---|---|---|
   | `INSUMO` | alimento/bebida/ingrediente | CMV_COMPRAS | sim |
   | `EMBALAGEM` | embalagem e descartável de delivery | CMV_COMPRAS | sim |
   | `CONSUMO` | limpeza, escritório | DESPESAS_GERAIS | escolha |
   | `DURAVEL` | utensílio, equipamento, uniforme | DESPESAS_GERAIS ou PLANEJAMENTO | não |
   | `SERVICO` | manutenção, software, publicidade | DESPESAS_GERAIS | não |

   Os valores e os padrões acima são ponto de partida; **aguardam resposta do dono** sobre utensílios (contar ou só gasto), uniformes/equipamentos (despesa ou investimento) e serviços (sair de Produtos?).
2. A natureza **sugere** categoria DRE e `controlsStock`, mas não os trava: o usuário pode trocar e o sistema avisa quando a combinação foge do padrão (ex.: `INSUMO` com DRE fora de CMV).
3. `accountType` deixa de ser exibido; a coluna fica até o fim da fase 3 e depois é removida.
4. Regras que não podem mudar: CMV continua lendo `dreGroup = 'CMV_COMPRAS'` (ver `cmv-purchase-base.service.ts`); a natureza não altera nenhum cálculo existente.

## Fases

### Fase 1 — Backend: campo e validação (sem mudar telas)
- Migration aditiva: enum + `Product.nature` nullable + índice. Nenhum backfill automático.
- `productSchema`: aceitar `nature`. Para **criação**, exigir `nature`, `unitMeasureId`, `categoryId`, `dreCategoryId` e, quando `controlsStock`, `inventorySectorId`. Para **edição** de produto antigo, só validar o que foi alterado, para não bloquear salvar item legado.
- Tabela de padrões por natureza em um módulo único (`product-nature.ts`), usada por backend e exposta em `getProductFormOptions`, para o frontend não duplicar a regra.
- Endpoint de busca de similares por nome (reaproveitar `normalizeText` e `product-name-conflict.ts`) para o aviso de duplicidade.
- Testes (vitest): validação por natureza, criação rejeitada sem obrigatórios, edição legada aceita, padrões por natureza.

### Fase 2 — Frontend: nova tela (lista + cadastro em rota própria)
- `/estoque/produtos` vira só a lista: busca, filtro por natureza, filtros avançados já existentes, ação em lote de DRE. Indicadores e gráficos num bloco recolhível.
- `/estoque/produtos/novo` e `/estoque/produtos/:id/editar`, no padrão de `/compras/:id/editar`: cabeçalho com status "Conferido / N pendências", botões Voltar e Salvar.
- Passos: **1 Natureza** (5 cartões) → **2 Identificação** (nome, unidade, categoria, subcategoria; aviso de nome parecido) → **3 Classificação** (DRE, setor e estoque já sugeridos, só confirmar) → **4 Estoque e compra** (só se aplicável: mínimo, ideal, lead time, fornecedor principal, embalagens/conversões, localização) → **5 Conferência**.
- Salvar fica desabilitado até os obrigatórios do passo estarem preenchidos; mensagem diz o que falta.
- Dirty-check e confirmação ao sair preservados (lógica de `normalizeForm` já existe).
- Extrair para `frontend/src/pages/products/`: `ProductList`, `ProductEditor`, `NatureStep`, `ClassificationStep`, `StockPurchaseStep`, `useProductForm`. Meta: nenhum arquivo acima de 400 linhas.
- Simplificar unidades: unidade padrão + embalagens de compra; remover "unidade base futura" e o fator/peso duplicados da UI (campos continuam no banco).
- Mobile: passos em coluna única, mesmo comportamento da compra.
- Testes: renderização por natureza, botão Salvar bloqueado, aviso de duplicidade, edição de produto legado sem natureza.

### Fase 3 — Dados existentes (com revisão do dono, nunca automática)
- Relatório CSV de proposta de natureza por produto, derivada de DRE + categoria + `controlsStock`, com os casos ambíguos marcados.
- Tela de revisão em lote: o dono confirma por grupo (ex.: "40 itens de UTENSILIOS → Durável").
- Tratar categoria `DESPESAS` (91 itens, 6 deles CMV), setor "NÃO BATER EST" (119) e itens sem setor (18).
- Depois de tudo classificado: `nature` obrigatória e remoção de `accountType`.

## Riscos e cuidados
- Mexer em `controlsStock` altera o que aparece na contagem: a fase 3 nunca muda esse campo sem confirmação explícita.
- O repo é público: exemplos em testes e comentários devem ser fictícios.
- Existe o cadastro de "Pequenos gastos" (`SmallExpenseType`) com "Utensílios" e "Locação de utensílios". Verificar a relação com compras antes de decidir o destino de `SERVICO`/`DURAVEL`.
- Migration só roda em produção com autorização; deploy idem. Frontend deve ser buildado de worktree em `origin/main`.
- A árvore atual (`feat/preco-por-fornecedor`) tem alterações de outra sessão em `client.ts`, `Requisitions.tsx` e rotas de estoque; implementar em worktree novo a partir de `origin/main`.

## Ordem de entrega
Fase 1 e Fase 2 podem sair em PRs separados (1 depende só de migration aditiva). Fase 3 só depois do dono validar a tela nova com dados reais.
