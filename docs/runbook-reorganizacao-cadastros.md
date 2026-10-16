# Roteiro: aplicar a reorganização de produtos (natureza, categoria, subcategoria)

Status: validado numa **cópia** do banco local. **Nada foi aplicado em produção.** Este roteiro só se executa com autorização explícita do dono.

## O que a aplicação faz e o que nunca faz

Faz: cria as categorias novas (com natureza e categoria DRE usual), preenche a natureza dos produtos, move cada produto para a categoria nova, recria a subcategoria sob a categoria nova (ou a descarta, se for só um número de importação), remove subcategorias que ficaram vazias e desativa categorias que ficaram sem produto.

**Nunca altera:** categoria DRE do produto, controle de estoque, setor, unidade, nome ou situação. O script confere uma impressão digital desses campos dentro da transação e desfaz tudo se algo mudar.

## Por que isto não mexe no financeiro

- O DRE das compras fora do CMV e o CMV leem a categoria **DRE** do produto, não a categoria de produto.
- As contagens de estoque guardam o nome da categoria como foto no momento da contagem.
- Prova medida na cópia: 71 relatórios (DRE de cada mês, pendências do DRE, fechamento mensal e CMV) foram capturados antes e depois: **71 idênticos**. Controle negativo: mudar a DRE de **um** produto na mesma cópia fez 12 dos 71 relatórios divergirem.

Mudar a **categoria DRE** de qualquer produto reescreve o histórico e é um assunto à parte (ver "Pendências de DRE").

## Pré-requisitos

1. PRs #107 e #110 mesclados e o backend publicado (as migrations `natureza_do_produto` e `categoria_natureza_e_dre_padrao` são aditivas e rodam sozinhas no boot do Render).
2. Autorização explícita do dono para gravar em produção.
3. Janela em que ninguém esteja cadastrando produto (a aplicação leva segundos, mas o plano é calculado sobre o estado lido).

## Passo a passo

1. **Backup.** `pg_dump -Fc` do banco de produção, guardado fora do repositório. Conferir que o arquivo restaura.
2. **Ensaio numa cópia da produção.** Restaurar o backup num banco local de teste e rodar a prévia e a aplicação nele (itens 3 a 6 abaixo, apontando para a cópia). Os códigos dos produtos são os mesmos, então o arquivo de decisões vale; se a produção tiver produtos novos, rodar a prévia de novo e revisar só os acrescentados.
3. **Prévia (somente leitura):**
   ```bash
   cd backend
   npx tsx --env-file=<env-da-copia> scripts/proposta-taxonomia.ts <pasta-fora-do-repositorio>
   ```
4. **Retrato dos relatórios ANTES** (servidor do backend apontando para a cópia):
   ```bash
   npx tsx scripts/comparar-relatorios.ts capturar http://localhost:3335 <pasta>/antes.json 2025-01
   ```
5. **Simular e aplicar na cópia:**
   ```bash
   npx tsx --env-file=<env-da-copia> scripts/aplicar-taxonomia.ts <decisoes.csv>                      # simula
   npx tsx --env-file=<env-da-copia> scripts/aplicar-taxonomia.ts <decisoes.csv> --saida <pasta> --aplicar
   ```
6. **Retrato DEPOIS e comparação.** Tem de dar `idênticos: N | diferentes: 0`. Qualquer diferença interrompe o processo.
   ```bash
   npx tsx scripts/comparar-relatorios.ts capturar http://localhost:3335 <pasta>/depois.json 2025-01
   npx tsx scripts/comparar-relatorios.ts comparar <pasta>/antes.json <pasta>/depois.json
   ```
7. **Produção.** Só depois do ensaio limpo, rodar o item 5 com o `DATABASE_URL` da produção (nunca imprimir a credencial), mantendo `--saida` fora do repositório. O arquivo de reversão é gravado antes de qualquer mudança.
8. **Conferência pós-aplicação** (consultas de consistência): nenhum produto com subcategoria de outra categoria; natureza do produto igual à da categoria; subcategorias numéricas = 0; só os itens deliberadamente não classificados ficam sem natureza.

## Reversão

- **Pelo script:** `npx tsx --env-file=<env> scripts/aplicar-taxonomia.ts --reverter <reversao.json>` simula; com `--aplicar`, desfaz. Ele devolve cada produto à categoria, subcategoria e natureza anteriores, recria as subcategorias removidas (com o mesmo id), reativa as categorias desativadas, restaura o que foi completado nas categorias existentes e remove as categorias e subcategorias criadas se estiverem vazias. Testado na cópia: o estado volta **idêntico** ao original (impressão digital de produtos, categorias e subcategorias igual antes e depois).
- **Garantido:** restaurar o backup do passo 1.
- O arquivo `reversao-*.json` é gravado antes de qualquer mudança e completado com os ids criados ao final.

## Salvaguardas do script de aplicação

- Simula por padrão; `--aplicar` exige `--saida` fora de qualquer repositório git; imprime o banco-alvo antes de gravar.
- Recusa aplicar se uma regra **ativa** da agenda de contagem usa uma categoria que seria desativada, e informa quantas sessões e itens de agenda apontam para o que será removido.
- Dentro da transação: confere que os produtos não foram editados desde a leitura, que as remoções e desativações aconteceram na quantidade planejada e que a impressão digital de DRE, estoque, setor, unidade, nome e situação não mudou. Qualquer falha desfaz tudo.
- Leitura estrita do arquivo de decisões: recusa arquivo fora de UTF-8, aspas sem fechamento, linha com número de colunas diferente do cabeçalho e natureza desconhecida.
- A comparação de relatórios recusa resposta de erro como se fosse dado: se qualquer relatório não vier com status 2xx, a captura falha e a comparação se recusa.

## Pendências de DRE (fora desta aplicação, exigem decisão)

A classificação nova torna visíveis produtos cuja **categoria DRE não combina com o que são**. Corrigir isso muda o DRE e o CMV de meses passados, então só com comparação antes e depois e aprovação do dono:

- itens de papelaria ou descartável (bobina de impressora, copo de papel, prato descartável) com DRE de CMV ou de utensílio;
- itens de padaria e presente com DRE "Prêmios / Gratificações" (pessoal);
- despesas, impostos e vale-transporte cadastrados como produto.

Decisão pendente do dono: equipamento como **investimento** só daqui para frente (recomendado), reclassificação completa com relatório por mês, ou gravar a DRE na linha da compra.

## Cuidados que continuam valendo

- **Importação de catálogo e de compras** criam categoria pelo nome da planilha. Se a planilha ainda trouxer `INSUMOS` ou `DESPESAS`, a categoria antiga é recriada. Atualizar a planilha-modelo (ou o mapeamento) antes da próxima importação.
- **Contagem de utensílios** continua sendo entrega separada: ligar o controle de estoque nos duráveis hoje entraria no valor do inventário do CMV e na exigência de cobertura do fechamento. Os duráveis seguem com `controlsStock = false` por padrão.
- As planilhas de prévia e de decisões têm nomes reais de produtos e **nunca** vão para o repositório (é público).

## Resultado do ensaio numa cópia da produção (16/10/2026)

Backup diário automático de produção (gerado às 09:20 do mesmo dia) restaurado num Postgres 18 isolado em Docker, **sem nenhuma conexão com a produção**. Nada foi aplicado em produção.

| Verificação | Resultado |
|---|---|
| Restauração do backup | limpa, sem avisos: 857 produtos, 5.760 itens de compra |
| Migrations pendentes (`natureza_do_produto`, `categoria_natureza_e_dre_padrao`) | aplicadas sem erro sobre dados reais |
| Estabilidade da régua (duas capturas sem mudança) | 70 de 70 relatórios idênticos |
| Aplicação: 851 de 857 produtos, 17 categorias novas, 19 subcategorias removidas | campos protegidos inalterados; segunda execução sem nada a fazer |
| Relatórios financeiros depois de aplicar | **70 de 70 idênticos** (DRE de cada mês, pendências, fechamento mensal, CMV) |
| Controle negativo (mudar a DRE de um produto com 112 itens de compra) | **12 de 70 relatórios divergiram**: a régua enxerga mudança |
| Reversão | estado de produtos, categorias e subcategorias **idêntico ao original**; relatórios 70 de 70 idênticos ao "antes" |
| Referências soltas (agenda de contagem, sessões) às categorias afetadas | zero |

O que o ensaio mostrou de novo em relação à base local:
- 52 produtos só existem em produção. Vinte e um deles são despesas do shopping (aluguel, condomínio, IPTU, fundos, energia, gás) e retenções de imposto cadastradas como produto; ganharam as categorias **ALUGUEL E TARIFAS** e **IMPOSTOS E RETENCOES** em vez de cair no balaio "Outras despesas".
- Três itens ficam sem natureza de propósito, por serem cadastros genéricos ou não identificáveis pelo nome, e a categoria `INSUMOS` continua ativa por causa deles.
- A última migration aplicada em produção é `vinculo_pedido_nota`, que ainda não está nestas branches: o Prisma avisa que existe no banco e falta localmente, o que é esperado e inofensivo para `migrate deploy`.

Para subir a API sobre uma cópia que tem dados reais use `scripts/api-sem-efeitos.ts`, **nunca** o `server.ts`: o `server.ts` inicia o WhatsApp (que usaria a sessão salva no banco) e os crons do 99 Food. O script ainda recusa subir se o banco não for local.
