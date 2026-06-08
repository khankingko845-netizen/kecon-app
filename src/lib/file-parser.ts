// Client-side text extraction from uploaded story files (.txt, .docx, .pdf).
// Heavy parsers are dynamically imported so they only load when a matching file
// is chosen and never run on the server.

async function extractDocx(file: File): Promise<string> {
  // The package's "browser" field maps this to the browser build automatically.
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ");
    pageTexts.push(text.trim());
  }
  return pageTexts.filter(Boolean).join("\n\n");
}

export function isSupportedStoryFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text") ||
    name.endsWith(".txt") ||
    name.endsWith(".docx") ||
    name.endsWith(".pdf")
  );
}

// Extract plain text from a supported file. Throws on unsupported formats.
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("text") || name.endsWith(".txt")) {
    return file.text();
  }
  if (name.endsWith(".docx")) {
    return extractDocx(file);
  }
  if (name.endsWith(".pdf")) {
    return extractPdf(file);
  }
  throw new Error("Định dạng không hỗ trợ. Dùng .txt, .docx hoặc .pdf");
}
