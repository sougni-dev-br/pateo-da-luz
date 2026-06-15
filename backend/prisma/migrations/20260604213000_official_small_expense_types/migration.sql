INSERT INTO "SmallExpenseType" ("id", "name", "normalizedName", "group", "isActive", "updatedAt")
VALUES
  ('small-expense-bebidas', 'BEBIDAS', 'bebidas', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-aquisicao-equipamentos', 'Aquisição de equipamentos', 'aquisicao de equipamentos', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-assinaturas-licencas', 'Assinaturas e Licenças', 'assinaturas e licencas', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-cafe-funcionarios', 'CAFÉ FUNCIONÁRIOS', 'cafe funcionarios', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-confraternizacoes', 'CONFRATERNIZAÇÕES', 'confraternizacoes', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-decoracao', 'DECORAÇÃO', 'decoracao', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-equipamentos-tecnologia', 'EQUIPAMENTOS DE TECNOLOGIA', 'equipamentos de tecnologia', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-estacionamento', 'ESTACIONAMENTO', 'estacionamento', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-farmacinha', 'FARMACINHA', 'farmacinha', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-correios', 'GASTOS COM CORREIOS', 'gastos com correios', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-impressos', 'IMPRESSOS', 'impressos', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-locacao-utensilios', 'LOCAÇÃO DE UTENSÍLIOS', 'locacao de utensilios', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-manutencao', 'MANUTENÇÃO', 'manutencao', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-material-escritorio', 'MATERIAL DE ESCRITÓRIO', 'material de escritorio', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-mobiliario', 'MOBILIARIO', 'mobiliario', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-ti-hospedagem', 'Serviços de TI / Hospedagem de Site', 'servicos de ti hospedagem de site', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-uber', 'UBER', 'uber', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-uniforme', 'UNIFORME', 'uniforme', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-utensilios', 'UTENSÍLIOS', 'utensilios', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-meta', 'Veiculação Instagram - Facebook - META', 'veiculacao instagram facebook meta', 'Pequenos gastos', true, CURRENT_TIMESTAMP),
  ('small-expense-vt-extras-testes', 'VT-extras e testes', 'vt extras e testes', 'Pequenos gastos', true, CURRENT_TIMESTAMP)
ON CONFLICT ("normalizedName") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "group" = EXCLUDED."group",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "SmallExpenseType"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "normalizedName" NOT IN (
  'bebidas',
  'aquisicao de equipamentos',
  'assinaturas e licencas',
  'cafe funcionarios',
  'confraternizacoes',
  'decoracao',
  'equipamentos de tecnologia',
  'estacionamento',
  'farmacinha',
  'gastos com correios',
  'impressos',
  'locacao de utensilios',
  'manutencao',
  'material de escritorio',
  'mobiliario',
  'servicos de ti hospedagem de site',
  'uber',
  'uniforme',
  'utensilios',
  'veiculacao instagram facebook meta',
  'vt extras e testes'
);
