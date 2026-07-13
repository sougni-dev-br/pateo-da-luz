Script de auditoria para validar a base antes de unificar a regra de CMV por categoria do produto.

Uso:

```powershell
npm run audit:cmv-base
```

O script verifica:
- produtos sem categoria DRE;
- produtos classificados em `CMV_COMPRAS` mas fora do estoque;
- produtos em estoque fora de `CMV_COMPRAS`;
- itens de compra sem produto ou sem categoria DRE;
- compras mistas com itens CMV e nao-CMV;
- diferenca mensal entre a logica atual (`controlsStock`) e a logica correta por categoria DRE (`dreGroup = CMV_COMPRAS`).
