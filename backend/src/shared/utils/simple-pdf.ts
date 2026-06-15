type PdfSection = {
  heading?: string;
  lines?: string[];
  table?: {
    headers: string[];
    rows: Array<Array<string | number | null | undefined>>;
  };
};

function removeDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cleanPdfText(value: unknown) {
  return removeDiacritics(String(value ?? ""))
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfText(value: unknown) {
  return cleanPdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(value: unknown, max = 152) {
  const text = cleanPdfText(value);
  if (text.length <= max) return [text];

  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatTableRow(row: Array<string | number | null | undefined>) {
  return row.map((value) => cleanPdfText(value || "-")).join(" | ");
}

export function createSimplePdf(title: string, sections: PdfSection[]) {
  const pages: string[][] = [[]];
  const pushLine = (line = "") => {
    const current = pages[pages.length - 1];
    if (current.length >= 35) pages.push([]);
    pages[pages.length - 1].push(line);
  };

  pushLine(title);
  pushLine(`Gerado em ${new Date().toLocaleString("pt-BR")}`);
  pushLine("");

  for (const section of sections) {
    if (section.heading) {
      pushLine("");
      pushLine(section.heading.toUpperCase());
    }

    for (const line of section.lines ?? []) {
      for (const wrapped of wrapLine(line)) pushLine(wrapped);
    }

    if (section.table) {
      pushLine(formatTableRow(section.table.headers));
      pushLine("-".repeat(152));
      for (const row of section.table.rows) {
        for (const wrapped of wrapLine(formatTableRow(row))) pushLine(wrapped);
      }
    }
  }

  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const fontObject = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  for (const page of pages) {
    const commands = ["BT", "/F1 8 Tf", "30 545 Td", "13 TL"];
    page.forEach((line, index) => {
      if (index > 0) commands.push("T*");
      commands.push(`(${escapePdfText(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    const contentObject = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    contentObjectIds.push(contentObject);
    pageObjectIds.push(0);
  }

  const pagesObjectId = objects.length + pages.length + 1;
  for (let index = 0; index < pages.length; index += 1) {
    const pageObject = addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`
    );
    pageObjectIds[index] = pageObject;
  }

  const pagesObject = addObject(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`);
  const catalogObject = addObject(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);

  const chunks = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join(""), "latin1"));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""), "latin1");
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(chunks.join(""), "latin1");
}
