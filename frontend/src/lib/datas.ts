// Datas de calendario (AAAA-MM-DD) no fuso de quem esta usando.
//
// toISOString() converte para UTC antes de formatar: depois das 21h no Brasil
// ja e o dia seguinte. Para "hoje" e para datas padrao de formulario, o dia que
// vale e o do relogio da pessoa — por isso estes helpers leem getFullYear/
// getMonth/getDate, que sao locais.
//
// Nao usar para timestamps vindos da API que representam uma data gravada como
// meia-noite UTC (ex.: scheduledDate da agenda de inventario): esses precisam
// continuar lidos em UTC, senao voltam um dia no Brasil.

/** A data local de `data` em AAAA-MM-DD. */
export function dataLocalIso(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/**
 * Data de hoje no fuso de quem esta usando, em AAAA-MM-DD. Uma contagem de
 * fechamento feita a noite do dia 30 nascia datada do dia 1o com toISOString.
 */
export function hojeLocalIso(agora: Date = new Date()): string {
  return dataLocalIso(agora);
}
