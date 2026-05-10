// Future: loop con Anthropic SDK + tool-use sobre Playwright MCP, devuelve preNormalized directamente
import type { ArticleRef } from '../types.js';
import type { ArticleExtractor, ExtractionResult } from './types.js';

export class AgenticMcpExtractor implements ArticleExtractor {
  name = 'agentic-mcp';

  canHandle(_ref: ArticleRef): boolean {
    return false;
  }

  extract(_ref: ArticleRef): Promise<ExtractionResult> {
    throw new Error('not implemented in v0');
  }
}
