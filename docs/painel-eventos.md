# Painel de eventos

Operação → **Painel de eventos** (`/operacao/eventos`, módulo de permissão `events`).

Histórico dos eventos que trazem gente ao restaurante (centro de convenções, teatro e
grupos com pacote) e a decisão de cada dia: modalidade do serviço, tamanho do buffet,
preço e comentário da gerência.

> Os dados reais (planilha, revisão de comentários, apelidos de nomes) ficam **fora** deste
> repositório, que é público.

## Regras que o código garante

- **O faturamento não duplica.** Fica uma vez por data (`OperationDay` para o histórico
  importado, `RevenueEntry` do Salão para o que veio do PDV). Os eventos apontam para a data.
  Dia com dois eventos aparece na ficha de cada um como dia compartilhado, sem dividir valor.
- **Uma fonte por dia.** Se a data tem lançamento do PDV com número de pessoas, ele vale; senão,
  o histórico da planilha. As duas nunca são somadas (`realizadoPorData`).
- **Sempre sem os 10%.** Do PDV: `salesFirstShift − shift1Service` (almoço) e
  `salesSecondShift − shift2Service` (jantar). A planilha já guardava sem.
- **O PDV grava a data ao meio-dia UTC.** Filtro de intervalo usa "antes do dia seguinte".
- **Preço do buffet vem do PDV** (`buffetCobradoPorData`): vendas recebidas de produto cujo nome
  começa com "BUFFET" em `AgileSaleItem`; preço unitário = total ÷ quantidade. O preço do dia é o
  do buffet que mais vendeu; os outros (pacote de grupo, troca de preço no meio do dia) aparecem
  ao lado. Os itens só existem desde que o agente passou a mandá-los (set/2026); antes disso, e em
  dia sem venda de buffet, vale o preço anotado (`OperationDay.buffetPrice`).
- **A previsão só olha para trás.** `preverAlmoco` descarta qualquer dia igual ou posterior ao
  dia previsto. A mesma função serve para medir o acerto no passado.
- **A previsão é congelada** na primeira decisão salva do dia (`forecastLunch`, `forecastSize`,
  `forecastBasis`), para comparar depois com o realizado.
- **P/M/G da Escala:** o painel só **lê** `ScheduleDayEvent` e avisa quando a marcação difere
  da sugestão. Quem grava continua sendo a Escala (`POST /schedule/bulk` apaga e recria o mês;
  por isso o painel não escreve nessa tabela).

## Modelo

| Tabela | O que guarda |
|---|---|
| `EventSeries` | O evento que se repete. `nameKey` (nome normalizado) e `aliasKeys` (chaves de séries juntadas a ela) |
| `EventEdition` | Cada vez que a série acontece: datas, público anunciado, andar, contato, origem (`PLANILHA`, `CIRCULAR`, `MANUAL`) |
| `EventEditionDay` | Um dia da edição: horário de início e fim |
| `OperationDay` | Uma linha por data: modalidade, preço do buffet, comentário, previsão congelada e o histórico de antes do PDV |
| `EventSettings` | Limites da sugestão (Pequeno até N almoços, Grande acima de M) e capacidade do salão |

## Previsão (`eventos-previsao.ts`)

Regras explicáveis, sem modelo estatístico. A tela mostra a frase de onde veio o número.

1. **Mesma série:** mediana dos almoços das edições anteriores no mesmo ponto do evento
   (1º dia, meio, último, evento de um dia); sem isso, todos os dias da série.
2. **Dias parecidos:** mesmo ponto do evento × dia útil/sábado/domingo × um ou vários eventos
   juntos, afrouxando o filtro até ter 3 casos. Grupos com pacote não contam como evento do prédio.
3. Com as duas: 60% série e 40% perfil quando a série tem 2 dias ou mais; meio a meio com 1 dia.
4. Tamanho pelos limites de `EventSettings`. "Pouca base" quando quase não há caso parecido.

## Importação do histórico

```bash
cd backend
npx tsx scripts/importar-painel-eventos.ts --planilha <xlsx> --aba <aba> --revisao <xlsx> --apelidos <json>          # ensaio
npx tsx scripts/importar-painel-eventos.ts --planilha <xlsx> --aba <aba> --revisao <xlsx> --apelidos <json> --apply  # grava
```

- Lê a aba informada em `--aba` em pedaços do XML (a aba tem fórmulas arrastadas até a última linha do
  Excel e o `readFile` do ExcelJS estoura a memória). Colunas achadas pelo cabeçalho.
- Idempotente: séries pela chave (ou apelido), edições por (série, início), dias por data.
  Comentário e preço já editados no ERP não são sobrescritos.
- Datas que já têm PDV não recebem o histórico da planilha.
- `--revisao`: planilha com a decisão (Mover / Manter / Descartar) para comentários que um
  ordenamento antigo deixou na linha errada. Sem decisão, o comentário não é importado.
- `--apelidos`: JSON `{ juntar: { chave: chaveDestino }, origem: { chave: "GRUPO" }, nome: { chave: "Nome" } }`.
- Depois de importar, séries repetidas também podem ser juntadas pela tela (Ficha → Juntar).
