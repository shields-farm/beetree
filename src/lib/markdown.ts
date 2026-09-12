/**
 * Shared markdown renderer for every AI-authored surface in BeeTree
 * (full chat, floating chat, Buzz Thread correspondence).
 *
 * One module instead of three copies, for two reasons:
 *
 * 1. Sanitization. Model output and Buzz Thread correspondence are untrusted —
 *    thread text is generated inside the headlong container and delivered over
 *    HTTP by the host relay. Everything is sanitized before it reaches
 *    dangerouslySetInnerHTML. (FloatingChat previously injected raw HTML.)
 *
 * 2. One parser configuration. Each surface used to call `marked.setOptions`
 *    at module scope with different flags, which is global mutable state: any
 *    component that imported after the wrong module got the other one's
 *    settings. Formatting behavior belongs here, not in whichever component
 *    happened to load first. Prose soft-wrapping is handled by
 *    `softenMarkdown` rather than a parser-wide `breaks` flag, so tables and
 *    lists keep working.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { softenMarkdown } from './softenMarkdown';

marked.setOptions({ gfm: true, breaks: false, async: false });

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Render AI-authored markdown to sanitized HTML. */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    return DOMPurify.sanitize(marked.parse(softenMarkdown(text)) as string);
  } catch {
    // Never fail open into raw HTML — escape and show the source text.
    return `<p>${escapeHtml(text)}</p>`;
  }
}
