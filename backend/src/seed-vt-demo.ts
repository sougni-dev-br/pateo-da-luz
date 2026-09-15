// Semente do ambiente LOCAL de conferência do VT (banco pateo_vt_demo).
// Não é usado em produção — serve para o Eli abrir a tela e conferir os números
// da quinzena com os casos reais dele (ida ≠ volta, EMTU de Carapicuíba).
import bcrypt from "bcryptjs";
import { prisma } from "./config/database.js";
import { generatePayroll } from "./modules/payroll/payroll.service.js";
import { exigeBancoDeDemonstracao } from "./exige-banco-de-demo.js";

const YEAR = 2026;
const MONTH = 9;

// CPF de teste com dígito verificador correto. O cadastro valida o CPF de
// verdade, então número inventado impede salvar a ficha — e a demonstração
// existe justamente para abrir e editar.
function cpfValido(base: number): string {
  const n = String(base).padStart(9, "0").slice(0, 9).split("").map(Number);
  const dv = (nums: number[]) => {
    const peso = nums.length + 1;
    const soma = nums.reduce((acc, v, i) => acc + v * (peso - i), 0);
    const r = 11 - (soma % 11);
    return r >= 10 ? 0 : r;
  };
  const d1 = dv(n);
  const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}

async function main() {
  exigeBancoDeDemonstracao("seed-vt-demo");

  await prisma.user.upsert({
    where: { email: "eli@pateo.local" },
    update: { passwordHash: bcrypt.hashSync("vtdemo123", 10), role: "ADMIN", isActive: true },
    create: {
      id: "user-demo", name: "Eli (demo local)", email: "eli@pateo.local",
      passwordHash: bcrypt.hashSync("vtdemo123", 10), role: "ADMIN", isActive: true,
    },
  });

  for (const name of ["Vale-Transporte", "Folha de Pagamento"]) {
    const existing = await prisma.dRECategory.findFirst({ where: { name } });
    if (!existing) await prisma.dRECategory.create({ data: { name, dreGroup: "PESSOAL" } });
  }

  // A EMTU nasce inativa e sem valor (a migration não pode chutar o preço da
  // linha — na Grande SP a tarifa comum vai de R$ 4,15 a R$ 12 conforme o
  // trajeto). Este 6,70 é o que sobra do relato da funcionária: R$ 12,00 por
  // sentido menos os R$ 5,30 do ônibus da SPTrans. Confirmar com ela antes de
  // levar para produção.
  await prisma.vtFare.update({ where: { id: "vtfare_emtu" }, data: { amount: 6.7, isActive: true } });

  const INTEGRACAO = "vtfare_integracao_sp";

  const ONIBUS = "vtfare_onibus_sp";
  const METRO = "vtfare_metro_cptm";
  const EMTU = "vtfare_emtu";

  // Nomes de pessoa de verdade: o cenário que cada um representa vai em `notes`,
  // não no nome. Cenário-como-nome polui toda tela que lista funcionário e
  // engana quem abre a demonstração achando que é cadastro real.
  const casos: Array<{
    id: string; firstName: string; lastName: string; cargo: string; setor: string; sexo: "FEMININO" | "MASCULINO";
    cenario: string; legs: Array<["IDA" | "VOLTA", string]>;
  }> = [
    {
      id: "demo-1", firstName: "Ana Paula", lastName: "Ribeiro", cargo: "Cozinheira", setor: "Cozinha", sexo: "FEMININO",
      cenario: "Cenário: ida de ônibus + metrô, volta só de ônibus.",
      legs: [["IDA", ONIBUS], ["IDA", METRO], ["VOLTA", ONIBUS]],
    },
    {
      id: "demo-2", firstName: "Marcos", lastName: "Vinícius Souza", cargo: "Garçom", setor: "Salão", sexo: "MASCULINO",
      cenario: "Cenário: mora em Carapicuíba — EMTU + ônibus da SPTrans nos dois sentidos.",
      legs: [["IDA", EMTU], ["IDA", ONIBUS], ["VOLTA", ONIBUS], ["VOLTA", EMTU]],
    },
    {
      id: "demo-3", firstName: "Cláudia", lastName: "Martins", cargo: "Pizzaiola", setor: "Pizzaria", sexo: "FEMININO",
      cenario: "Cenário: só ônibus na ida e na volta.",
      legs: [["IDA", ONIBUS], ["VOLTA", ONIBUS]],
    },
    {
      id: "demo-5", firstName: "Luiz Felipe", lastName: "Cardoso", cargo: "Auxiliar de cozinha", setor: "Cozinha", sexo: "MASCULINO",
      cenario: "Cenario da planilha: ida pela integracao onibus+metro (9,38), volta so de metro (5,40) = R$ 14,78/dia.",
      legs: [["IDA", INTEGRACAO], ["VOLTA", METRO]],
    },
    {
      id: "demo-4", firstName: "Rosana", lastName: "Alves", cargo: "Auxiliar de limpeza", setor: "Pia", sexo: "FEMININO",
      cenario: "Cenário: sem trajeto cadastrado — o gerador precisa avisar e o vale sai R$ 0,00.",
      legs: [],
    },
  ];

  let cpfSeq = 111111100;
  for (const c of casos) {
    cpfSeq += 1;
    await prisma.employee.upsert({
      where: { id: c.id },
      update: {
        firstName: c.firstName, lastName: c.lastName, position: c.cargo, sector: c.setor,
        notes: c.cenario, gender: c.sexo, vtType: "TRANSPORTE_PUBLICO", vtPeriodicity: "QUINZENAL",
      },
      create: {
        id: c.id, firstName: c.firstName, lastName: c.lastName, cpf: cpfValido(cpfSeq), gender: c.sexo,
        position: c.cargo, sector: c.setor, notes: c.cenario,
        baseSalary: 2200, vtType: "TRANSPORTE_PUBLICO", vtPeriodicity: "QUINZENAL", createdById: "user-demo",
      },
    });

    await prisma.employeeVtLeg.deleteMany({ where: { employeeId: c.id } });
    const order = { IDA: 0, VOLTA: 0 };
    for (const [direction, fareId] of c.legs) {
      await prisma.employeeVtLeg.create({
        data: { id: `${c.id}-${direction}-${order[direction]}`, employeeId: c.id, direction, fareId, sortOrder: order[direction]++ },
      });
    }

    // Escala 6×1: folga nas segundas de setembro/2026.
    await prisma.employeeScheduleDay.deleteMany({ where: { employeeId: c.id } });
    for (const d of [7, 14, 21, 28]) {
      await prisma.employeeScheduleDay.create({
        data: { id: `${c.id}-f${d}`, employeeId: c.id, date: new Date(Date.UTC(YEAR, MONTH - 1, d)), type: "FOLGA", createdById: "user-demo" },
      });
    }
  }

  // Deixa a demonstração no estado REAL de hoje (14/09): a 1ª quinzena já foi
  // paga em 31/08 e a 2ª está para pagar. Sem isso não dá para ver o acerto de
  // falta, que só existe sobre dia já pago.
  await prisma.vtFaltaDeduction.deleteMany({});
  await prisma.payrollItem.deleteMany({ where: { type: "VALE_TRANSPORTE" } });
  await generatePayroll(YEAR, MONTH, "user-demo", "VT_Q1");

  // Falta lançada DEPOIS do pagamento da 1ª quinzena: é o caso que gera
  // abatimento na 2ª. A falta do dia 3 fica de fora de propósito — ela seria
  // anterior ao pagamento e não pode ser descontada duas vezes.
  await prisma.employeeScheduleDay.upsert({
    where: { employeeId_date: { employeeId: "demo-3", date: new Date(Date.UTC(YEAR, MONTH - 1, 10)) } },
    update: { type: "FALTA" },
    create: {
      id: "demo-3-falta-10", employeeId: "demo-3",
      date: new Date(Date.UTC(YEAR, MONTH - 1, 10)), type: "FALTA", createdById: "user-demo",
    },
  });

  console.log("Demo pronto: eli@pateo.local / vtdemo123");
  console.log("  1ª quinzena já gerada (venceu 31/08) · falta de 10/09 pendente de acerto na 2ª");
  await prisma.$disconnect();
}

void main();
