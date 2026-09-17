import { describe, expect, test } from "vitest";
import { exactShopId } from "../noventa-nove-http-client.js";
import { shopIdCandidates } from "../noventa-nove-webhook.service.js";

// Resposta REAL de POST /v1/shop/shop/list colhida contra a API de produção
// em 17/09/2026. O shop_id tem 19 dígitos: JSON.parse devolve
// 5764608397866174000, o texto original guarda 5764608397866174292.
const RESPOSTA_REAL_SHOP_LIST =
  '{"errno":0,"errmsg":"ok","requestId":"0a8660386aac766eb23f90da16a81a02","time":1789687406,' +
  '"data":{"page_no":1,"page_size":100,"total":1,"shop_list":[{"app_id":5764607571057444871,' +
  '"shop_id":5764608397866174292,"app_shop_id":"PATEO-FREI-CANECA","city_id":55000199,' +
  '"token_expiration_time":1788632790}]}}';

const SHOP_ID_EXATO = "5764608397866174292";
const SHOP_ID_ARREDONDADO = 5764608397866174292; // o literal aqui JÁ é o arredondado em runtime

describe("exactShopId", () => {
  test("recupera os digitos exatos do texto quando o JSON.parse arredondou", () => {
    // Arrange — simula exatamente o que o JSON.parse entrega
    const parsed = JSON.parse(RESPOSTA_REAL_SHOP_LIST).data.shop_list[0].shop_id as number;
    expect(String(parsed)).not.toBe(SHOP_ID_EXATO); // o estrago existe mesmo

    // Act
    const resultado = exactShopId(parsed, RESPOSTA_REAL_SHOP_LIST);

    // Assert
    expect(resultado.value).toBe(SHOP_ID_EXATO);
    expect(resultado.approximate).toBe(false);
  });

  test("devolve a string intacta quando a 99 manda o id ja como texto", () => {
    const resultado = exactShopId(SHOP_ID_EXATO, "{}");

    expect(resultado.value).toBe(SHOP_ID_EXATO);
    expect(resultado.approximate).toBe(false);
  });

  test("nao mexe em id pequeno que cabe em double sem perda", () => {
    const resultado = exactShopId(12345, '{"shop_id":12345}');

    expect(resultado.value).toBe("12345");
    expect(resultado.approximate).toBe(false);
  });

  test("marca como aproximado quando o texto nao contem o id — em vez de inventar digitos", () => {
    const resultado = exactShopId(SHOP_ID_ARREDONDADO, '{"outra":"coisa"}');

    expect(resultado.approximate).toBe(true);
    expect(resultado.value).toBe(String(SHOP_ID_ARREDONDADO));
  });

  test("marca como aproximado quando dois ids diferentes arredondam para o mesmo valor", () => {
    // Arrange — ...291 e ...292 colapsam no mesmo double; nao da pra decidir
    const rawAmbiguo = '{"shop_list":[{"shop_id":5764608397866174291},{"shop_id":5764608397866174292}]}';
    expect(Number("5764608397866174291")).toBe(Number("5764608397866174292"));

    // Act
    const resultado = exactShopId(SHOP_ID_ARREDONDADO, rawAmbiguo);

    // Assert — prefere admitir a duvida a gravar o id errado com cara de certo
    expect(resultado.approximate).toBe(true);
  });
});

describe("shopIdCandidates", () => {
  test("aceita o exato E o arredondado, pra nao quebrar loja ainda nao reconciliada", () => {
    // Arrange
    const raw = `{"type":"orderNew","data":{"order_info":{"shop":{"shop_id":${SHOP_ID_EXATO}}}}}`;
    const parsed = JSON.parse(raw).data.order_info.shop.shop_id as number;

    // Act
    const candidatos = shopIdCandidates(parsed, raw);

    // Assert
    expect(candidatos).toContain(SHOP_ID_EXATO);
    expect(candidatos).toContain(String(parsed));
    // O arredondado vem primeiro; o exato fica por ultimo (findStoreForCallback
    // grava o ultimo quando precisa escolher).
    expect(candidatos[candidatos.length - 1]).toBe(SHOP_ID_EXATO);
  });

  test("sem shop_id no evento devolve lista vazia, nunca [undefined]", () => {
    expect(shopIdCandidates(undefined, "{}")).toEqual([]);
  });

  test("id que ja veio como string passa direto", () => {
    expect(shopIdCandidates(SHOP_ID_EXATO, "{}")).toEqual([SHOP_ID_EXATO]);
  });

  test("id pequeno nao vira busca no texto", () => {
    expect(shopIdCandidates(999, '{"shop_id":999}')).toEqual(["999"]);
  });
});
