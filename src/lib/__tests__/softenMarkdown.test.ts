import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import { softenMarkdown } from '../softenMarkdown';

marked.setOptions({ gfm: true, breaks: false, async: false });

/** Parse helper — mirrors src/lib/markdown.ts minus the sanitize step. */
const parse = (text: string) => marked.parse(softenMarkdown(text)) as string;

describe('softenMarkdown', () => {
  it('turns soft-wrapped prose lines into line breaks inside one paragraph', () => {
    const html = parse('What it is: a virus.\nDetecting it: open the cells.');
    expect(html.match(/<p>/g)).toHaveLength(1);
    expect(html).toContain("a virus.<br>Detecting it: open the cells.");
  });

  it('does not invent paragraph structure the author did not write', () => {
    const html = parse('one\ntwo\nthree');
    expect(html).toBe('<p>one<br>two<br>three</p>\n');
  });

  it('leaves an intentional paragraph break alone', () => {
    const html = parse('First para.\n\nSecond para.');
    expect(html).toBe('<p>First para.</p>\n<p>Second para.</p>\n');
  });

  it('keeps tight lists tight — a block line never gains a blank neighbour', () => {
    const html = parse('Order of battle:\n\n- Nuc Charlie first\n- Queen Castle Foxtrot second\n- big colonies last');
    expect((html.match(/<ul>/g) ?? [])).toHaveLength(1);
    expect((html.match(/<li>/g) ?? [])).toHaveLength(3);
    expect(html).not.toContain('<li><p>');
  });

  it('keeps an ordered list from prose intact', () => {
    const html = parse('Priority:\n1. queen\n2. mites\n3. stores');
    const ol = html.slice(html.indexOf('<ol>'), html.indexOf('</ol>'));
    expect(ol).not.toContain('<p>');
    expect((ol.match(/<li>/g) ?? [])).toHaveLength(3);
  });

  it('does not break a gfm table whose rows are on single newlines', () => {
    const html = parse('| hive | status |\n| --- | --- |\n| Alpha | strong |\n| Bravo | weak |');
    expect((html.match(/<tr>/g) ?? [])).toHaveLength(3);
    expect(html).toContain('<th>hive</th>');
  });

  it('never rewrites newlines inside a fenced code block', () => {
    const html = parse('Run this:\n\n```\nline one\nline two\n```');
    const pre = html.slice(html.indexOf('<pre>'), html.indexOf('</pre>'));
    expect(pre).toContain('line one\nline two');
    expect((pre.match(/<p>/g) ?? [])).toHaveLength(0);
  });

  it('keeps a heading flush to the paragraph under it', () => {
    const html = parse('## What it is\nA virus that kills the queen.');
    expect(html.startsWith('<h2>What it is</h2>')).toBe(true);
    expect(html).toContain('<p>A virus that kills the queen.</p>');
  });

  it('keeps a blockquote multi-line rather than splitting it', () => {
    const html = parse('> one\n> two');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('one\ntwo');
  });

  it('renders emphasis, bold and bullets written properly', () => {
    const html = parse('**Queen** check first.\n\n- eggs\n- mites\n\n> quiet is fine');
    expect(html).toContain('<strong>Queen</strong>');
    expect((html.match(/<li>/g) ?? [])).toHaveLength(2);
    expect(html).toContain('<blockquote>');
  });

  it('handles the empty and prose-only cases', () => {
    expect(softenMarkdown('')).toBe('');
    expect(softenMarkdown('one line')).toBe('one line');
  });
});
