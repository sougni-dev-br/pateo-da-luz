# Reorganização dos cadastros de produto: natureza, categoria, subcategoria, setor e categoria DRE

Status: proposta para aprovação. Nenhum dado foi alterado. Números do banco local (805 produtos); conferir em produção antes de executar a fase 3.

Princípio: **cada informação mora em um lugar só e responde uma pergunta só**. Hoje a mesma resposta ("é custo ou despesa?", "é utensílio?") está espalhada em quatro campos que se contradizem.

## 1. Os cinco eixos e a pergunta de cada um

| Eixo | Pergunta que responde | Quem usa | Quantos valores |
|---|---|---|---|
| **Natureza** | O que é este item? | Sistema: decide campos, estoque e padrões | 5, fixos |
| **Categoria** | Em que prateleira mental a equipe procura? | Pessoas: busca, compra, impressão | ~15, editáveis |
| **Subcategoria** | Refinamento opcional da categoria | Pessoas: filtro | opcional, poucas |
| **Setor** | Onde o item é contado? | Contagem de estoque | só para quem controla estoque |
| **Categoria DRE** | Onde o gasto cai no resultado? | Financeiro: DRE e CMV | grupos fixos, categorias editáveis |

Regras de ouro:
- A natureza **sugere** categoria DRE e estoque; a categoria **sugere** a categoria DRE usual. Ninguém digita DRE do zero.
- A categoria pertence a **uma** natureza. Isso elimina o saco de gatos `DESPESAS` (95 itens misturando insumo, escritório e manutenção).
- Setor só existe para item que controla estoque. "Não bater estoque" é um **marcador**, não um setor.
- O seletor de DRE do produto mostra só as categorias relevantes. Hoje são 60 ativas e 40 nunca foram usadas por produto (folha, impostos, locação...).

## 2. O que os dados mostram hoje

- **Categoria `DESPESAS`:** 95 produtos e 13 subcategorias. Tem 6 itens de CMV ("Custo de Alimentos") e ~85 despesas (escritório 29, uniformes 17, manutenção 9, publicidade 5, equipamentos 5...). Natureza e DRE nela são incompatíveis entre si.
- **Sobreposição:** `UTENSILIOS` (40) = DRE "Utensílios Operacionais" (42) = natureza durável. `LIMPEZA` (40) = DRE "Material de Limpeza" (44). Três campos dizendo a mesma coisa; quando divergem, ninguém sabe qual vale.
- **Subcategorias:** 40 no total; **8 se chamam "0"** (resíduo de importação), 5 estão vazias, nomes repetidos entre categorias (ÁGUA, LIMPEZA, EMBALAGEM, CARNES NOBRE, MATERIAL DE ESCRITÓRIO). **424 de 805 produtos não têm subcategoria**, então ela é opcional na prática e deve ser assim por regra.
- **`mainGroup` da categoria** ("Compras") é quase sempre igual e não é usado: candidato a remoção.
- **Setor:** `NÃO BATER EST` tem 119 itens (marcador de negócio disfarçado de setor); 18 produtos sem setor; "ESTOQUE" e "ESTOQUE SECO" coexistem.
- **DRE sem produto:** 3. **Compras ligadas a item sem estoque (despesas):** 82 linhas em 26 produtos: a separação já acontece na prática, só que sem nome.

## 3. Estrutura proposta

### 3.1 Natureza (já implementada nas fases 1 e 2)
INSUMO · EMBALAGEM · CONSUMO · DURAVEL · SERVICO. Os padrões (DRE sugerido, estoque) vêm do servidor.

### 3.2 Categorias, agrupadas por natureza (proposta inicial, a ajustar com o Eli)

| Natureza | Categorias | DRE padrão |
|---|---|---|
| Insumo | Carnes e aves · Peixes · FLV · Mercearia (hoje INSUMOS, 299) · Bebidas | Custo de Alimentos / Bebidas |
| Embalagem | Embalagens · Descartáveis / Delivery | Embalagens / Descartáveis |
| Consumo | Limpeza · Material de escritório | Material de Limpeza / Escritório |
| Durável | Utensílios · Equipamentos · Uniformes | Utensílios / Equipamentos / Uniformes (ou Investimentos) |
| Serviço | Manutenção · Publicidade · Software · Transporte · Serviços de terceiros | respectivas DRE |

"Mercearia" é nome de trabalho para o `INSUMOS` de hoje (299 itens), que é grande demais para ser uma categoria útil; dividir em subcategorias reais (secos, laticínios, óleos...) é decisão de cozinha, não de sistema.

### 3.3 Mapa categoria → DRE padrão no banco
Hoje o mapa vive no código (`DRE_POR_CATEGORIA` em `frontend/src/pages/products/natureza.ts`, e `SUGGESTION_MAP` antes). Vira coluna `Category.defaultDreCategoryId`, editável na tela de cadastros, para a regra poder mudar sem deploy.

### 3.4 Setor
- Setor só obrigatório com `controlsStock`.
- `NÃO BATER EST` é aposentado: os 119 itens já têm `controlsStock = false`, que é o campo real. Sem marcador novo.

## 4. Mudanças técnicas

1. **Schema (aditivo):** `Category.nature` (nullable no início) e `Category.defaultDreCategoryId`. Nenhuma remoção até a fase E.
2. **Cadastros:** tela de categorias passa a pedir natureza e DRE padrão; impede criar categoria sem natureza; mostra uso (quantos produtos) e deixa mesclar duas categorias (move os produtos e apaga a vazia).
3. **Seletor de DRE do produto:** só mostra categorias dos grupos da natureza (as outras ficam atrás de "mostrar todas").
4. **Rotinas de limpeza com prévia (dry-run):**
   - Natureza proposta por produto: categoria → natureza; ambiguidades (ex.: `DESPESAS` com DRE de CMV) marcadas para decisão humana.
   - Mesclar subcategorias "0" e vazias; unificar duplicadas.
   - Dividir `DESPESAS` em Escritório / Uniformes / Manutenção / Publicidade etc. pelo DRE que o item já tem.
5. **Aposentadoria:** `Product.accountType` (texto livre) e `Category.mainGroup`.

## 5. Fases e entregas

| Fase | Entrega | Risco | Depende de |
|---|---|---|---|
| A | Aprovar a taxonomia (seção 3) com o Eli e as decisões abaixo | nenhum | Eli |
| B | Schema aditivo + cadastro de categorias com natureza e DRE padrão | baixo | A |
| C | Prévia da limpeza (CSV + tela de revisão em lote), sem gravar | nenhum | B |
| D | Aplicar a limpeza por grupo, com o Eli confirmando cada bloco | médio: mexe em `controlsStock`/DRE de itens reais | C, backup antes |
| E | Natureza obrigatória; seletor de DRE filtrado; remover `accountType` e `mainGroup` | baixo | D completa |

Regras de segurança para D: nenhuma alteração de `controlsStock` sem confirmação explícita; trava de período financeiro respeitada; backup do banco antes; rodar primeiro numa cópia; relatório de "antes e depois" por grupo.

## 6. Decisões do Eli (15/10/2026) e o que cada uma implica

| # | Decisão | Consequência verificada no código e nos dados |
|---|---|---|
| 1 | **Utensílios são contados** (quantidade) | Hoje contar = `controlsStock = true`. O valor do inventário do CMV soma **todos** os itens contados (`cmv-real.service.ts`, `totalValue`), sem filtro, e o fechamento do mês exige **todo** item com controle de estoque na contagem. Ligar a contagem de utensílios direto distorceria o CMV e travaria o fechamento. Exige isolar o escopo do CMV (ver 6.1). |
| 2 | **Uniforme = despesa; equipamento = investimento** | O DRE das compras fora do CMV lê o `dreCategoryId` **atual** do produto (`dre.routes.ts`, parte B). Reclassificar os 15 equipamentos move o histórico para "Investimentos", inclusive meses fechados (ver 6.2). |
| 3 | **Serviços ficam em Produtos** (natureza Serviço) | Já implementado: o cadastro de serviço pede só nome e categoria DRE. |
| 4 | **Limpeza continua contada** | Sem mudança. Limpeza segue no CMV gerencial (`CATEGORIAS_CMV_GERENCIAL`). |
| 5 | **"NÃO BATER EST" = o que não precisa ser contado** | Os 119 itens já têm `controlsStock = false`. O setor é redundante: o campo real é `controlsStock`. **Não** haverá marcador novo; o setor é aposentado e os itens ficam sem setor. 87 desses itens têm contagem histórica, preservada. |
| 6 | **"Mercearia" não serve** | Os ~299 `INSUMOS` são um resto genérico (secos, molhos, doces, laticínios, congelados). Proposta: dividir em categorias reais em vez de nomear o resto (ver 6.3). |

### 6.1 Isolar o escopo do CMV para poder contar utensílios
- O fechamento e o valor do inventário passam a considerar só itens do escopo CMV (grupo `CMV_COMPRAS` ou as categorias da visão gerencial, a mesma lista que o DRE já usa). Utensílios contados ficam fora do valor e da exigência de cobertura.
- Utensílios são contados numa sessão própria, com setores reais (Salão, Cozinha, Bar...), sem relação com o fechamento do CMV.
- Entrega separada (PR próprio), com prova de que nenhum mês já fechado muda de valor, antes e depois.
- Até lá, `DURAVEL` continua com `controlsStock = false` por padrão, para um utensílio novo não travar o fechamento.

### 6.2 Equipamento como investimento sem reescrever o passado
Opções (a decidir):
- **Só daqui para frente:** nova categoria DRE de investimento em equipamento; compras novas usam ela; o histórico fica como despesa.
- **Reclassificar tudo** com relatório antes/depois por mês e aprovação do Eli para cada mês fechado afetado.
- **Gravar a categoria DRE na linha da compra** no momento da compra (muda o modelo, protege o passado de qualquer reclassificação futura). É a solução definitiva e a mais trabalhosa.

### 6.3 Insumos
Dividir em categorias reais, com prévia por palavra-chave que o Eli revisa: Laticínios e frios · Molhos, temperos e conservas · Secos e grãos · Doces e confeitaria · Congelados. Carnes salgadas (costela, rabo, bacon) vão para Carnes e aves. Bebida alcoólica que está em Insumos (vinho) vai para Bebidas.

### 6.4 Regra geral para a fase D (limpeza dos dados)
Toda reclassificação de DRE de produto reescreve o histórico. Antes de aplicar qualquer bloco: rodar o DRE de todos os meses antes e depois numa cópia do banco e comparar; só prosseguir se a diferença for zero ou aprovada.
