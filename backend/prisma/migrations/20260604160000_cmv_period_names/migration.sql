UPDATE "CmvPeriod"
SET "name" =
  'CMV ' ||
  TO_CHAR("dataInicial" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') ||
  ' a ' ||
  TO_CHAR("dataFinal" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY');
