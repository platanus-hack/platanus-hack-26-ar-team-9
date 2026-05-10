import type { ArticleRef } from '../types.js';

const ENTERTAINMENT_PATHS = [
  '/espectaculos/',
  '/espectaculo/',
  '/farandula/',
  '/famosos/',
  '/chimentos/',
  '/chimento/',
  '/celebridades/',
  '/celebridad/',
  '/show/',
  '/shows/',
  '/television/',
  '/televisión/',
  '/tv/',
  '/entretenimiento/',
  '/gente/',
];

const ENTERTAINMENT_CATEGORY_RE = /espect|farandula|farándula|famoso|chimento|celebr|television|televisión|entretenimiento|chimentos|gente/i;

const ENTERTAINMENT_TITLE_RE = /\b(showmatch|gran hermano|masterchef|bailando por un sue[ñn]o|bake off|got talent)\b/i;

export function isEntertainment(ref: ArticleRef): boolean {
  const url = ref.url.toLowerCase();
  if (ENTERTAINMENT_PATHS.some((p) => url.includes(p))) return true;

  const cats = ref.categories ?? [];
  if (cats.some((c) => ENTERTAINMENT_CATEGORY_RE.test(c))) return true;

  if (ref.title && ENTERTAINMENT_TITLE_RE.test(ref.title)) return true;

  return false;
}
