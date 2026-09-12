// @vitest-environment jsdom
/**
 * End-to-end markdown rendering: raw model text in, sanitized HTML out.
 *
 * These assertions are about what a reader actually sees in the app — the same
 * call the chat pages and the Buzz Thread make — so they cover the sanitizer
 * too, not just the newline pass.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../markdown';

describe('renderMarkdown', () => {
  it('breaks soft-wrapped prose into readable lines (the Buzz Thread bug)', () => {
    // Shape of a real Buzz Thread reply: prose with single newlines, no
    // markdown structure anywhere.
    const raw = [
      'Black queen cell virus - what it is, how to catch it, and the honest answer.',
      '',
      'What it is: a virus and the most common reason queen cells fail silently.',
      'It kills the developing queen partway through.',
      '',
      'What to do: no treatment exists - this is management, not medicine.',
    ].join('\n');
    const html = renderMarkdown(raw);
    expect(html.match(/<p>/g)).toHaveLength(3);
    expect(html).toContain('silently.<br>It kills');
  });

  it('renders real markdown structure', () => {
    const html = renderMarkdown(
      '**Queen** check first.\n\n- eggs last three days\n- alcohol mite wash\n\n1. queen\n2. mites\n\n## Heading\n\ntext',
    );
    expect(html).toContain('<strong>Queen</strong>');
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain('<h2>Heading</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
  });

  it('strips anything dangerous out of untrusted thread content', () => {
    const html = renderMarkdown(
      'Hi <img src=x onerror="alert(1)"> <script>alert(2)</script> [x](javascript:alert(3)) <b onclick="x()">bold</b>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('bold');
  });

  it('returns empty string for empty input and never throws on junk', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('\u0000<<<>>>')).toBeTypeOf('string');
  });
});
