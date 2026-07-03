# TODO — Extração completa do Inventory.tsx

## Estado (passo 0 da Onda 5.B, executado)

- `src/pages/inventory/shared.ts` criado: ~230 linhas de helpers puros,
  mapas de rótulo e tons de status extraídos do monolito (3.409 → 3.251 linhas).
- tsc + 227 testes verdes; zero mudança de comportamento.

## Restrição descoberta (por que a extração por view não foi mecânica)

O `Inventory` é UM componente com estado 100% compartilhado entre as 5 views.
Os painéis das views ficam **sempre montados** e são alternados por classe CSS
(`panelClass()` → `.inventory-section-hidden`), não por mount/unmount. Uma
extração em 5 componentes com estado próprio mudaria o timing de efeitos e
carregamento (comportamento observável) na tela operacional mais crítica do
sistema — sem cobertura de testes de página para proteger.

## Tática ajustada (aprovada implicitamente pela regra "descoberta → reporta")

Cada view é extraída para `src/pages/inventory/<View>.tsx` **no commit da sua
própria migração de onda**, recebendo estado/handlers do container via props.
Assim as Ondas B (overview, counting) e C (movements, inventário, reports)
continuam sem editar a mesma região, e cada extração é validada junto com o
re-skin correspondente.

## Pendente ao final da Fase 5

- [ ] Conferir se o container Inventory.tsx terminou < 800 linhas; se não,
      extrair os handlers de dados para hooks (`useInventoryData`).
- [ ] Avaliar trocar o esquema de painéis CSS-hidden por rotas reais quando
      houver testes E2E cobrindo contagem → inventário.
