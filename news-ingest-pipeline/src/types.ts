export interface Medium {
  slug: string;
  name: string;
  feedUrl: string;
  baseUrl: string;
}

export interface Feed extends Medium {}

export interface ArticleRef {
  url: string;
  guid: string;
  title: string;
  publishedAt: Date;
  author: string | null;
  summary: string | null;
  categories: string[];
  feedSlug: string;
  rawRss: unknown;
}

export interface NormalizedArticle {
  url: string;
  guid: string;
  mediumSlug: string;
  title: string;
  summary: string;
  body: string;
  author: string | null;
  publishedAt: string;
  language: string;
  topics: string[];
  extractionSource: string;
}
