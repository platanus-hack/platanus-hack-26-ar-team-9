import type { ArticleRef } from '../types.js';
import type { ExtractionResult } from '../extract/types.js';

export const SYSTEM_PROMPT = `Sos un extractor de artículos periodísticos. Tu tarea es normalizar el contenido de una noticia y devolver un JSON estricto.

Reglas:
- Devolvé SOLO el JSON, sin texto adicional, sin markdown, sin bloques de código.
- No inventes información. Si un campo no está disponible, usá null.
- El body debe ser el texto completo del artículo, limpio de publicidad y navegación.
- El summary debe ser una síntesis objetiva de 1-3 oraciones.
- Los topics deben ser sustantivos concretos en español (máximo 8).
- El language es el idioma detectado del artículo (normalmente "es").
- publishedAt debe ser ISO 8601 con offset.`;

export function buildUserPrompt(ref: ArticleRef, extraction: ExtractionResult): string {
  const bodyPreview = extraction.bodyText.slice(0, 8000);

  return `URL: ${ref.url}
Título RSS: ${ref.title}
Autor RSS: ${ref.author ?? 'desconocido'}
Fecha RSS: ${ref.publishedAt.toISOString()}
Categorías RSS: ${ref.categories.join(', ') || 'ninguna'}

--- TEXTO EXTRAÍDO ---
${bodyPreview}
--- FIN TEXTO ---

Devolvé este JSON (sin nada más):
{
  "title": "string (mínimo 3 caracteres)",
  "summary": "string (50-500 caracteres)",
  "body": "string (mínimo 200 caracteres, texto completo limpio)",
  "author": "string | null",
  "publishedAt": "ISO 8601 con offset",
  "language": "string (código de idioma, ej: es)",
  "topics": ["array", "de", "strings", "máximo 8"]
}`;
}
