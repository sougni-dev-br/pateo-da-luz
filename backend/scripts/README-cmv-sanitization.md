# CMV Sanitization

Script unico e idempotente para aplicar o saneamento da base de CMV.

## O que ele ajusta

- Classificacoes DRE aprovadas para os produtos sem categoria.
- Setores de inventario aprovados.
- Itens de despesa operacional que nao devem controlar estoque.
- Decisoes finais dos 7 itens residuais.

## Como usar

1. Revisar a previa no ambiente alvo:

```bash
npm run cmv:sanitize
```

2. Aplicar no ambiente alvo:

```bash
npm run cmv:sanitize -- --apply
```

## Observacoes

- O script usa o `DATABASE_URL` ativo no ambiente.
- Sem `--apply`, ele nao grava nada.
- Se a base ja estiver saneada, ele informa que nao ha alteracoes pendentes.
