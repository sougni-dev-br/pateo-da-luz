-- Teto do IR para a gorjeta informada à contabilidade (CLT): o envio leva
-- teto − salário registrado em vez da gorjeta do rateio; a pessoa continua
-- recebendo a gorjeta dos pontos. Vazio = envio com a gorjeta do rateio. Aditiva.
ALTER TABLE "Employee" ADD COLUMN "tetoIrGorjeta" DECIMAL(12,2);
