# Formas de pagamento e pequenos gastos

## Formas de pagamento

A tabela `PaymentMethod` agora representa as formas de pagamento mestre.

Campos:

- nome original;
- nome normalizado;
- tipo;
- grupo;
- ativo/inativo;
- observacoes.

Registros iniciais carregados pela migration:

- DINHEIRO
- PIX
- BOLETO
- BOLETO 2X
- BOLETO 3X
- BOLETO 4X
- BOLETO 5X
- BOLETO 6X
- BOLETO 7X
- BOLETO 8X
- CARTAO CREDITO
- FATURADO
- CARTAO DEBITO

Na importacao de compras, a forma de pagamento e localizada pelo nome normalizado. O texto original da planilha continua preservado em `Purchase.paymentMethod`, mas o relacionamento principal fica em `Purchase.paymentMethodId`.

## Tipos de pequenos gastos

A tabela `SmallExpenseType` prepara o sistema para planilhas futuras de pequenos gastos/cartao.

Campos:

- nome;
- nome normalizado;
- grupo;
- ativo/inativo;
- observacoes.

Quando a compra importada for identificada como pequeno gasto, o sistema vincula a compra ao tipo de pequeno gasto em `Purchase.smallExpenseTypeId`.
