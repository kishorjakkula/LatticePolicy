// Runtime wrapper to lazily load PDF-related libraries.
export async function loadJsPdf(): Promise<any> {
  const mod = await import('jspdf')
  return mod.jsPDF || mod.default || mod
}

export async function loadHtml2Canvas(): Promise<any> {
  const mod = await import('html2canvas')
  return mod.default || mod
}

export async function loadDomPurify(): Promise<any> {
  const mod = await import('dompurify')
  return mod.default || mod
}

export default {
  loadJsPdf,
  loadHtml2Canvas,
  loadDomPurify
}
