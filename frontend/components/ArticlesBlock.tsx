"use client";

import { ExternalLink, Clock, User } from "lucide-react";
import type { Article, Media } from "@/lib/types";

interface ArticleWithMedia extends Article {
  media: Media;
}

interface Props {
  articles: ArticleWithMedia[];
}

function formatDate(dateString?: string): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function ArticlesBlock({ articles }: Props) {
  if (articles.length === 0) {
    return (
      <section className="bg-[--color-bg-card] rounded-lg border border-[--color-border-card] p-6">
        <h2 className="text-xl font-semibold mb-4 text-[--color-text-primary]">
          Fuentes de noticias
        </h2>
        <p className="text-[--color-text-muted] italic">
          No hay artículos disponibles para este evento.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-[--color-bg-card] rounded-lg border border-[--color-border-card] p-6">
      <h2 className="text-xl font-semibold mb-6 text-[--color-text-primary]">
        Fuentes de noticias ({articles.length})
      </h2>
      
      <div className="space-y-4">
        {articles.map((article) => (
          <article
            key={`${article.medium_slug}-${article.guid}`}
            className="border-b border-[--color-border-card] pb-4 last:border-b-0 last:pb-0"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-[--color-text-secondary] bg-[--color-bg-primary] px-2 py-1 rounded">
                    {article.media.name}
                  </span>
                  {article.author && (
                    <div className="flex items-center gap-1 text-xs text-[--color-text-muted]">
                      <User className="h-3 w-3" />
                      <span>{article.author}</span>
                    </div>
                  )}
                  {article.published_at && (
                    <div className="flex items-center gap-1 text-xs text-[--color-text-muted]">
                      <Clock className="h-3 w-3" />
                      <span>{formatDate(article.published_at)}</span>
                    </div>
                  )}
                </div>
                
                <h3 className="text-lg font-medium text-[--color-text-primary] mb-2 leading-tight">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[--color-accent] transition-colors underline-offset-4 hover:underline"
                  >
                    {article.title}
                  </a>
                </h3>
                
                {article.summary && (
                  <p className="text-[--color-text-secondary] text-sm leading-relaxed line-clamp-3">
                    {article.summary}
                  </p>
                )}
              </div>
              
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 p-2 rounded-lg text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-[--color-bg-primary] transition-all duration-200"
                aria-label="Leer artículo completo"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
