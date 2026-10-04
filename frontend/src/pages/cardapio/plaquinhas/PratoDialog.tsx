import { useEffect, useState, type FormEvent } from "react";
import { saveBuffetPlateItem, type BuffetPlateItem } from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button, Select, TextField } from "../../../design-system";
import { CATEGORIAS, arrumarNome } from "./plaquinhasFormato";

type Props = {
  aberto: boolean;
  prato: BuffetPlateItem | null;
  /** Nome digitado na busca, para já vir preenchido ao cadastrar. */
  nomeInicial?: string;
  categoriaInicial?: string;
  onFechar: () => void;
  onSalvo: (prato: BuffetPlateItem) => void;
};

// Todo prato do catálogo tem o nome em inglês: é ele que vai na segunda linha da plaquinha.
export function PratoDialog({ aberto, prato, nomeInicial = "", categoriaInicial, onFechar, onSalvo }: Props) {
  const [namePt, setNamePt] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setNamePt(prato?.namePt ?? arrumarNome(nomeInicial));
    setNameEn(prato?.nameEn ?? "");
    setCategory(prato?.category ?? categoriaInicial ?? "");
    setErro(null);
  }, [aberto, prato, nomeInicial, categoriaInicial]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const pt = arrumarNome(namePt);
    const en = nameEn.replace(/\s+/g, " ").trim();
    if (pt.length < 2) return setErro("Escreva o nome do prato em português.");
    if (en.length < 2) return setErro("Escreva o nome em inglês. Ele sai na plaquinha, logo abaixo do português.");
    if (!category) return setErro("Escolha a categoria. Ela aparece no alto da plaquinha.");
    setErro(null);
    setSalvando(true);
    try {
      onSalvo(await saveBuffetPlateItem({ namePt: pt, nameEn: en.charAt(0).toUpperCase() + en.slice(1), category }, prato?.id));
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível salvar o prato.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title={prato ? "Editar prato" : "Cadastrar prato novo"}
      description="O nome em português vai em destaque e o inglês logo abaixo, em itálico.">
      <form className="plq-form" onSubmit={salvar}>
        <TextField label="Nome em português" value={namePt} maxLength={120} autoFocus required
          onChange={(e) => setNamePt(e.target.value)} onBlur={() => setNamePt((v) => arrumarNome(v))}
          placeholder="Ex.: Risoto de alho-poró com camarão" />
        <TextField label="Nome em inglês" value={nameEn} maxLength={120} required
          onChange={(e) => setNameEn(e.target.value)} placeholder="Ex.: Leek and shrimp risotto"
          hint="Obrigatório. Use um nome curto, como num cardápio." />
        <Select label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}
          placeholder="Escolha a categoria" required
          options={CATEGORIAS.map((c) => ({ value: c, label: c }))} hint="Aparece no alto da plaquinha." />
        {erro && <Alert tone="error">{erro}</Alert>}
        <div className="plq-form-acoes">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : prato ? "Salvar" : "Cadastrar"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
