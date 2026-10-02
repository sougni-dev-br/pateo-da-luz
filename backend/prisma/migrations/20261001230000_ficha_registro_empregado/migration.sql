-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "cbo" TEXT,
ADD COLUMN     "ctpsDataEmissao" DATE,
ADD COLUMN     "ctpsNumero" TEXT,
ADD COLUMN     "ctpsSerie" TEXT,
ADD COLUMN     "ctpsUf" TEXT,
ADD COLUMN     "escolaridade" TEXT,
ADD COLUMN     "estadoCivil" TEXT,
ADD COLUMN     "fgtsDataOpcao" DATE,
ADD COLUMN     "intervaloFim" TEXT,
ADD COLUMN     "intervaloInicio" TEXT,
ADD COLUMN     "jornadaFim" TEXT,
ADD COLUMN     "jornadaInicio" TEXT,
ADD COLUMN     "matriculaEsocial" TEXT,
ADD COLUMN     "nacionalidade" TEXT,
ADD COLUMN     "naturalidade" TEXT,
ADD COLUMN     "nomeMae" TEXT,
ADD COLUMN     "nomePai" TEXT,
ADD COLUMN     "possuiDeficiencia" BOOLEAN,
ADD COLUMN     "racaCor" TEXT,
ADD COLUMN     "registroNumero" TEXT,
ADD COLUMN     "rgDataEmissao" DATE,
ADD COLUMN     "rgOrgaoEmissor" TEXT,
ADD COLUMN     "tituloEleitor" TEXT,
ADD COLUMN     "tituloSecao" TEXT,
ADD COLUMN     "tituloZona" TEXT;

-- CreateTable
CREATE TABLE "EmployeeDependente" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "parentesco" TEXT,
    "dataNascimento" DATE,
    "origem" TEXT NOT NULL DEFAULT 'CADASTRO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDependente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeFerias" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "aquisitivoInicio" DATE NOT NULL,
    "aquisitivoFim" DATE NOT NULL,
    "gozoInicio" DATE,
    "gozoFim" DATE,
    "abonoInicio" DATE,
    "abonoFim" DATE,
    "origem" TEXT NOT NULL DEFAULT 'FICHA_REGISTRO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeFerias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAnotacaoCarteira" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "salario" DECIMAL(12,2),
    "retroativoCompetencia" TEXT,
    "cargoAnterior" TEXT,
    "cboAnterior" TEXT,
    "cargo" TEXT,
    "cbo" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'FICHA_REGISTRO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAnotacaoCarteira_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeDependente_employeeId_idx" ON "EmployeeDependente"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeFerias_employeeId_aquisitivoInicio_idx" ON "EmployeeFerias"("employeeId", "aquisitivoInicio");

-- CreateIndex
CREATE INDEX "EmployeeAnotacaoCarteira_employeeId_data_idx" ON "EmployeeAnotacaoCarteira"("employeeId", "data");

-- AddForeignKey
ALTER TABLE "EmployeeDependente" ADD CONSTRAINT "EmployeeDependente_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeFerias" ADD CONSTRAINT "EmployeeFerias_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAnotacaoCarteira" ADD CONSTRAINT "EmployeeAnotacaoCarteira_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

