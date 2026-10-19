import { BackendClient } from "./backend-client.js";
import { loadConfig, temCredenciais } from "./config.js";
import { mesesParaSincronizar, periodoDoMes } from "./logica.js";
import { definirSegredos, logger, redigir } from "./logger.js";
import { abrirNavegador, baixarRelatorio, LoginNecessarioError, prepararSessao } from "./portal.js";

// Uso:
//   node src/sync.js           sincroniza o mês corrente (e o anterior nos primeiros dias do mês)
//   node src/sync.js --login   abre o navegador VISÍVEL para você entrar na Keeta uma vez (perfil fica salvo)
//
// Códigos de saída: 0 = ok · 1 = erro · 2 = a Keeta pede login (o ERP já foi avisado).

const VERSAO = "0.1.0";
const HOST = process.env.COMPUTERNAME ?? "PDVTOUCH";
const ESPERA_DO_LOGIN_MANUAL_MS = 10 * 60 * 1000;

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function heartbeat({ status, mensagem, inicio, fim, dias, duracaoMs }) {
  return {
    status,
    mensagem: status === "erro" ? redigir(String(mensagem ?? "")).slice(0, 480) : null,
    periodoInicio: inicio,
    periodoFim: fim,
    batchId: null,
    diasImportados: dias ?? null,
    totalBruto: null,
    duracaoMs,
    agenteVersion: VERSAO,
    agenteHost: HOST,
    ocorridoEm: new Date().toISOString()
  };
}

async function loginManual(config) {
  const { context, page } = await abrirNavegador({ ...config.portal, perfilDir: config.perfilDir, headless: false });
  try {
    await logger.info("Entre na Keeta na janela que abriu. O agente espera até 10 minutos.");
    const limite = Date.now() + ESPERA_DO_LOGIN_MANUAL_MS;
    while (Date.now() < limite) {
      try {
        const cabecalhos = await prepararSessao(page, { podeLogar: false });
        if (cabecalhos) {
          await logger.info("Sessão da Keeta salva no perfil. Pode fechar esta janela.");
          return 0;
        }
      } catch (err) {
        if (!(err instanceof LoginNecessarioError)) throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    await logger.error("Tempo esgotado sem concluir o login.");
    return 1;
  } finally {
    await context.close();
  }
}

async function sincronizar(config) {
  const hoje = hojeLocal();
  const periodos = mesesParaSincronizar(hoje)
    .map(({ ano, mes }) => periodoDoMes(ano, mes, hoje))
    .filter(Boolean);
  const inicioGeral = periodos[0]?.inicio ?? hoje;
  const fimGeral = periodos[periodos.length - 1]?.fim ?? hoje;
  const erp = new BackendClient(config.backend);
  const comecouEm = Date.now();

  if (periodos.length === 0) {
    await logger.info("Nenhum dia fechado para sincronizar hoje.");
    await erp.heartbeat(heartbeat({ status: "ok", inicio: hoje, fim: hoje, dias: 0, duracaoMs: Date.now() - comecouEm }));
    return 0;
  }

  let navegador = null;
  try {
    navegador = await abrirNavegador({ ...config.portal, perfilDir: config.perfilDir });
    const cabecalhos = await prepararSessao(navegador.page, {
      email: config.portal.email,
      senha: config.portal.senha,
      podeLogar: temCredenciais(config)
    });

    let dias = 0;
    for (const periodo of periodos) {
      const { buffer, nome } = await baixarRelatorio({
        context: navegador.context,
        cabecalhos,
        shopId: config.portal.shopId,
        ...periodo
      });
      const resultado = await erp.enviarRelatorio(buffer, nome);
      const t = resultado.totais ?? {};
      dias += (t.criar ?? 0) + (t.alterar ?? 0) + (t.igual ?? 0);
      await logger.info("ERP: relatório importado", { periodo: `${periodo.inicio}..${periodo.fim}`, gravados: resultado.gravados, totais: t, avisos: resultado.avisos?.length ?? 0 });
    }

    await erp.heartbeat(heartbeat({ status: "ok", inicio: inicioGeral, fim: fimGeral, dias, duracaoMs: Date.now() - comecouEm }));
    return 0;
  } catch (err) {
    const pediuLogin = err instanceof LoginNecessarioError;
    await logger.error(pediuLogin ? "Keeta pede login" : "Falha na sincronização", { mensagem: err.message });
    await erp.heartbeat(heartbeat({
      status: "erro",
      mensagem: pediuLogin ? `Keeta pediu login: ${err.message}` : err.message,
      inicio: inicioGeral,
      fim: fimGeral,
      duracaoMs: Date.now() - comecouEm
    }));
    return pediuLogin ? 2 : 1;
  } finally {
    await navegador?.context.close();
  }
}

async function main() {
  let config;
  try {
    ({ config } = await loadConfig());
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  // Senha, e-mail e token nunca podem aparecer em log, em mensagem de erro nem no sinal de vida enviado ao ERP.
  definirSegredos([config.portal.senha, config.portal.email, config.backend.ingestToken]);
  return process.argv.includes("--login") ? loginManual(config) : sincronizar(config);
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
