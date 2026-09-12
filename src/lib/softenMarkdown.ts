/**
 * Newline normalization for AI-authored text before it hits a markdown parser.
 *
 * Why this exists: both minds write prose, and prose is not markdown. A model
 * answer like
 *
 *     What it is: a virus that kills the developing queen.
 *     Detecting it: open the queen cells and look.
 *
 * is two sentences on two lines, but markdown treats a lone newline as a space,
 * so it renders as one wall of text. Markdown-aware wrapping fixes exactly that
 * (this is what `breaks: true` does) but pays for it everywhere else: a table
 * built from single-newline rows stops being a table, and a wrapped list item
 * stops being a list item.
 *
 * So instead of a parser-wide flag, add a hard break only where a soft break is
 * unambiguous: between two ordinary lines of running text. Structural lines
 * (list items, headings, quotes, table rows, rules), code fences, and blank
 * lines are left exactly as authored — no blank line is ever inserted, so the
 * paragraph structure the author wrote is the paragraph structure that renders.
 * The result is a normal strict-markdown parse; nothing downstream needs to
 * know this happened.
 */

/** Fenced code blocks are opaque: never rewrite newlines inside them. */
const FENCE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

/** A line whose meaning depends on staying flush against its neighbours. */
const STRUCTURAL = /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||(?:-{3,}|\*{3,}|_{3,})\s*$|={3,}\s*$)/;

/** Convert soft-wrapped lines in running text to markdown hard breaks. */
function hardWrap(chunk: string): string {
  const lines = chunk.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];

    // Already a paragraph break, or an intentional gap around one.
    const tight = next !== undefined
      && line.trim() !== ''
      && next.trim() !== ''
      // Structural neighbours keep their tight spacing: a blank line inside a
      // list would turn a tight list into a loose one (every item in <p>), and
      // a blank line inside a table row would end the table entirely.
      && !STRUCTURAL.test(line)
      && !STRUCTURAL.test(next);

    // Two trailing spaces = hard line break in markdown, so the author's line
    // structure survives inside a single paragraph block. We do not insert a
    // blank line: that would invent a paragraph the author did not write.
    out.push(tight ? `${line}  ` : line);
  }
  return out.join('\n');
}

/**
 * Normalize soft-wrapped prose so a markdown parser renders line breaks the
 * way a reader expects. Pure and side-effect free.
 */
export function softenMarkdown(text: string): string {
  if (!text) return '';
  // Even indices are outside code fences, odd indices are inside them.
  return text
    .split(FENCE)
    .map((chunk, i) => (i % 2 === 1 ? chunk : hardWrap(chunk)))
    .join('');
}
