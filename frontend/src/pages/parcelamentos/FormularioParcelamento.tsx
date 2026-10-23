import { useEffect, useMemo, useState } from "react";
import { Company, getCompanies, getPaymentMethods, getProducts, getSuppliers, PaymentMethod, Product, Supplier } from "../../api/client";
import { Alert, Button, FormGrid, Select, TextField, Textarea } from "../../design-system";
import { Money } from "../../design-system";
import { hojeLocalIso } from "../../lib/datas";
import { gerarParcelas, motivoProdutoInvalido, ParcelaEditavel, somaEmCentavos, valorDoCampo } from "./regras";

export type DadosDoFormulario = {
  supplierId: string;
  companyId: string;
  productId: string;
  description: string;
  paymentMethodId: string;
  notes: string;
  motivo: string;
  total: number;
  quantidade: number;
  primeiroVencimento: string;
  parcelas: Array<{ valor: number; vencimento: string }>;
};

type Props = {
  modo: "novo" | "renegociar";
  /** Saldo aberto do parcelamento que está sendo renegociado (valor sugerido para o total). */
  saldo?: number;
  busy: boolean;
  erro: string | null;
  onVoltar: () => void;
  onEnviar: (dados: DadosDoFormulario) => void;
};

const paraTela = (n: number) => n.toFixed(2).replace(".", ",");

// Cadastro e renegociação usam o mesmo formulário: o total e a prévia das parcelas valem para os dois.
export function FormularioParcelamento({ modo, saldo, busy, erro, onVoltar, onEnviar }: Props) {
  const [fornecedores, setFornecedores] = useState<Supplier[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [formas, setFormas] = useState<PaymentMethod[]>([]);
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [productId, setProductId] = useState("");
  const [description, setDescription] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [notes, setNotes] = useState("");
  const [motivo, setMotivo] = useState("");
  const [total, setTotal] = useState(saldo !== undefined ? paraTela(saldo) : "");
  const [quantidade, setQuantidade] = useState("");
  const [primeiroVencimento, setPrimeiroVencimento] = useState(hojeLocalIso());
  const [parcelas, setParcelas] = useState<ParcelaEditavel[]>([]);

  useEffect(() => {
    if (modo !== "novo") return;
    Promise.all([getSuppliers({ activeOnly: true }), getCompanies(), getPaymentMethods()])
      .then(([f, e, p]) => { setFornecedores(f); setEmpresas(e); setFormas(p); })
      .catch((error) => setErroDeCarga(error instanceof Error ? error.message : "Não foi possível carregar os cadastros."));
  }, [modo]);

  useEffect(() => {
    if (modo !== "novo" || buscaProduto.trim().length < 2) { setProdutos([]); return; }
    const t = setTimeout(() => {
      getProducts({ search: buscaProduto.trim(), pageSize: 20, isActive: "true" }).then((r) => setProdutos(r.items)).catch(() => setProdutos([]));
    }, 300);
    return () => clearTimeout(t);
  }, [buscaProduto, modo]);

  const totalNumero = valorDoCampo(total);
  const quantidadeNumero = Number(quantidade);

  // Mudou o total, o número de parcelas ou o primeiro vencimento: a prévia é refeita (edições manuais se perdem).
  useEffect(() => {
    setParcelas(gerarParcelas(totalNumero ?? 0, Number.isInteger(quantidadeNumero) ? quantidadeNumero : 0, primeiroVencimento));
  }, [totalNumero, quantidadeNumero, primeiroVencimento]);

  const somaCent = useMemo(() => somaEmCentavos(parcelas), [parcelas]);
  const totalCent = Math.round((totalNumero ?? 0) * 100);
  const diferenca = totalCent - somaCent;
  const parcelasValidas = parcelas.length > 0 && parcelas.every((p) => (valorDoCampo(p.valor) ?? 0) > 0 && p.vencimento);
  const camposOk = modo === "novo" ? Boolean(supplierId && companyId && productId && description.trim()) : motivo.trim().length >= 3;
  const podeEnviar = camposOk && parcelasValidas && diferenca === 0 && !busy;

  function mudarParcela(indice: number, campo: keyof ParcelaEditavel, valor: string) {
    setParcelas((atual) => atual.map((p, i) => (i === indice ? { ...p, [campo]: valor } : p)));
  }

  function enviar() {
    onEnviar({
      supplierId, companyId, productId, description: description.trim(), paymentMethodId, notes: notes.trim(), motivo: motivo.trim(),
      total: totalNumero ?? 0, quantidade: quantidadeNumero, primeiroVencimento,
      parcelas: parcelas.map((p) => ({ valor: valorDoCampo(p.valor) ?? 0, vencimento: p.vencimento }))
    });
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (podeEnviar) enviar(); }}>
      {(erro || erroDeCarga) && <Alert tone="error">{erro ?? erroDeCarga}</Alert>}
      {modo === "novo" && (
        <FormGrid cols={2}>
          <Select label="Fornecedor" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} placeholder="Escolha" options={fornecedores.map((f) => ({ value: f.id, label: f.name }))} />
          <Select label="Empresa" required value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="Escolha" options={empresas.map((c) => ({ value: c.id, label: c.tradeName }))} />
          <TextField label="Buscar produto" hint="Digite 2 letras ou mais" value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} />
          <Select label="Produto do lançamento" required value={productId} onChange={(e) => setProductId(e.target.value)} placeholder={produtos.length ? "Escolha" : "Busque ao lado"} options={produtos.map((p) => {
            const motivo = motivoProdutoInvalido(p);
            return { value: p.id, label: motivo ? `${p.name} (${motivo})` : p.name, disabled: motivo !== null };
          })} hint="Produto de despesa, sem estoque e fora do CMV" />
          <TextField label="Descrição" required maxLength={120} placeholder="Ex.: Acordo de parcelamento 2026" value={description} onChange={(e) => setDescription(e.target.value)} />
          <Select label="Forma de pagamento" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} placeholder="Definir na baixa" options={formas.map((m) => ({ value: m.id, label: m.name }))} />
        </FormGrid>
      )}
      <FormGrid cols={3}>
        <TextField label={modo === "renegociar" ? "Novo total (R$)" : "Total (R$)"} inputMode="decimal" required placeholder="0,00" hint={modo === "renegociar" && saldo !== undefined ? `Saldo em aberto: ${paraTela(saldo)}` : undefined} value={total} onChange={(e) => setTotal(e.target.value)} />
        <TextField label="Nº de parcelas" inputMode="numeric" required placeholder="12" value={quantidade} onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, ""))} />
        <TextField label="1º vencimento" type="date" required value={primeiroVencimento} onChange={(e) => setPrimeiroVencimento(e.target.value)} />
      </FormGrid>

      {parcelas.length > 0 && (
        <>
          <div className="parcelamentos-grade" role="group" aria-label="Parcelas">
            {parcelas.map((p, i) => (
              <div className="parcelamentos-grade-linha" key={i}>
                <span>{i + 1}</span>
                <TextField label={i === 0 ? "Vencimento" : undefined} aria-label={`Vencimento da parcela ${i + 1}`} type="date" value={p.vencimento} onChange={(e) => mudarParcela(i, "vencimento", e.target.value)} />
                <TextField label={i === 0 ? "Valor (R$)" : undefined} aria-label={`Valor da parcela ${i + 1}`} inputMode="decimal" value={p.valor} onChange={(e) => mudarParcela(i, "valor", e.target.value)} />
              </div>
            ))}
          </div>
          <p className="parcelamentos-conferencia">
            Soma das parcelas: <strong><Money value={somaCent / 100} /></strong>
            {diferenca !== 0 && <> · <strong>faltam/sobram <Money value={diferenca / 100} /></strong> para fechar o total</>}
          </p>
        </>
      )}

      {modo === "renegociar" && <TextField label="Motivo da renegociação" required minLength={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      {modo === "novo" && <Textarea label="Observações" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}

      <div className="parcelamentos-rodape">
        <Button variant="secondary" disabled={busy} onClick={onVoltar}>Voltar</Button>
        <Button type="submit" disabled={!podeEnviar}>{modo === "novo" ? "Criar parcelamento" : "Renegociar saldo"}</Button>
      </div>
    </form>
  );
}
