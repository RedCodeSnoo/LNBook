import { applyRulesToHtml, applyRulesToText, isValidRule } from '../textReplacement';

describe('text replacement', () => {
  it('replaces plain text, treating special characters literally', () => {
    const rules = [{ pattern: 'Read on site.com (free)', replacement: '', isRegex: false }];
    expect(applyRulesToText('Hello. Read on site.com (free) Bye.', rules)).toBe('Hello.  Bye.');
    expect(applyRulesToText('Read on siteXcom (free)', rules)).toBe('Read on siteXcom (free)');
  });

  it('keeps "$" literal in plain replacements and supports groups in regex mode', () => {
    expect(applyRulesToText('cost', [{ pattern: 'cost', replacement: '$1', isRegex: false }])).toBe(
      '$1',
    );
    expect(
      applyRulesToText('Mr Smith', [{ pattern: 'Mr (\\w+)', replacement: 'M. $1', isRegex: true }]),
    ).toBe('M. Smith');
  });

  it('skips disabled and invalid rules', () => {
    const rules = [
      { pattern: 'a', replacement: 'b', isRegex: false, enabled: false },
      { pattern: '([', replacement: 'x', isRegex: true },
      { pattern: '', replacement: 'x', isRegex: false },
    ];
    expect(applyRulesToText('a ([', rules)).toBe('a ([');
    expect(isValidRule(rules[1])).toBe(false);
    expect(isValidRule({ pattern: '\\d+', replacement: '', isRegex: true })).toBe(true);
  });

  it('only touches the text of an HTML fragment', () => {
    const html = '<p class="p">The p tag &amp; <b>bold p</b></p><p><img src="p.png" alt="" /></p>';
    expect(applyRulesToHtml(html, [{ pattern: 'p', replacement: 'q', isRegex: false }])).toBe(
      '<p class="p">The q tag &amp; <b>bold q</b></p><p><img src="p.png" alt="" /></p>',
    );
  });

  it('matches escaped characters and escapes the result', () => {
    const html = '<p>Tom &amp; Jerry &lt;3</p>';
    expect(
      applyRulesToHtml(html, [{ pattern: '& Jerry <3', replacement: '<and>', isRegex: false }]),
    ).toBe('<p>Tom &lt;and&gt;</p>');
  });

  it('removes paragraphs emptied by a rule', () => {
    const html = '<p>Keep</p>\n<p>Visit novelsite.com for more!</p>\n<p>Also keep</p>';
    expect(
      applyRulesToHtml(html, [{ pattern: '^Visit .* for more!$', replacement: '', isRegex: true }]),
    ).toBe('<p>Keep</p>\n<p>Also keep</p>');
  });
});
