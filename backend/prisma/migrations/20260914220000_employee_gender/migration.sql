-- Sexo do funcionario. Usado APENAS para a regra de folga dominical: a CLT
-- art. 386 garante a mulher uma folga em domingo a cada 15 dias, contra a
-- regra geral de uma a cada 3 semanas (Lei 10.101/2000 art. 6o paragrafo
-- unico, aplicada por analogia a bares e restaurantes). Os dois prazos ficam
-- em PayrollSettings porque quem os fecha na pratica e a CCT da categoria.
--
-- Nasce NAO_INFORMADO para todo mundo: sem o dado, a tela aplica o limite mais
-- conservador e avisa que o cadastro esta incompleto. Chutar o sexo pelo nome
-- daria alerta errado nos dois sentidos.
CREATE TYPE "EmployeeGender" AS ENUM ('FEMININO', 'MASCULINO', 'NAO_INFORMADO');
ALTER TABLE "Employee" ADD COLUMN "gender" "EmployeeGender" NOT NULL DEFAULT 'NAO_INFORMADO';
