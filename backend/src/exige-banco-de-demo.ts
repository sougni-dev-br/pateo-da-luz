// Trava para os scripts de desenvolvimento (seed-vt-demo, audita-vt).
//
// Os dois apagam PayrollItem de VALE_TRANSPORTE, apagam escala e — no caso do
// seed — criam um usuário ADMIN com senha fixa. Eles usam o `prisma`
// compartilhado, que lê DATABASE_URL: dentro da Render isso é a PRODUÇÃO.
// Compilados em dist/, um `node dist/seed-vt-demo.js` executado por engano no
// shell do servidor apagaria os vales e deixaria uma conta de administrador
// com senha conhecida. Daí a trava ser por nome de banco e não por NODE_ENV,
// que é fácil de passar errado.
const BANCOS_PERMITIDOS = ["pateo_vt_demo"];

export function exigeBancoDeDemonstracao(script: string): void {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`${script}: DATABASE_URL não definida. Este script só roda no banco de demonstração.`);
    process.exit(1);
  }

  let banco: string;
  try {
    // O nome do banco é o path da URL de conexão, sem a barra inicial.
    banco = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    console.error(`${script}: DATABASE_URL ilegível. Abortado por precaução.`);
    process.exit(1);
  }

  if (!BANCOS_PERMITIDOS.includes(banco)) {
    console.error(`${script}: ABORTADO — este script é destrutivo e só pode rodar em ${BANCOS_PERMITIDOS.join(", ")}.`);
    console.error(`O banco apontado por DATABASE_URL é "${banco}".`);
    process.exit(1);
  }
}
