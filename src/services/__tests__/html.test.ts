import { countWords, htmlToText, sanitizeHtml, textToHtml } from '../html';

describe('sanitizeHtml', () => {
  it('keeps only the body content and drops scripts, styles and comments', () => {
    const html = `<html><head><title>T</title><style>p{color:red}</style></head>
      <body><!-- ad --><script>alert(1)</script><p>Hello <b>world</b></p></body></html>`;
    expect(sanitizeHtml(html)).toBe('<p>Hello <b>world</b></p>');
  });

  it('unwraps unknown tags and removes attributes', () => {
    expect(
      sanitizeHtml(
        '<p class="x" style="color:red" onclick="x()"><span><font>a</font></span><em id="e">b</em></p>',
      ),
    ).toBe('<p>a<em>b</em></p>');
  });

  it('keeps class and style when asked', () => {
    expect(
      sanitizeHtml('<p class="x" style="color:red"><span class="y">a</span></p>', {
        keepFormatting: true,
      }),
    ).toBe('<p class="x" style="color:red"><span class="y">a</span></p>');
  });

  it('removes empty paragraphs and wrappers', () => {
    expect(sanitizeHtml('<div><p>&nbsp;</p><p> </p></div><p>text</p><p><br/></p>')).toBe(
      '<p>text</p>',
    );
  });

  it('wraps loose text in paragraphs, split on line breaks', () => {
    expect(sanitizeHtml('First line<br><br>Second <i>line</i><p>Third</p>')).toBe(
      '<p>First line</p><p>Second <i>line</i></p><p>Third</p>',
    );
  });

  it('rewrites or removes images', () => {
    const html = '<p><img src="a.jpg" width="10"><img src="missing.png"></p>';
    expect(
      sanitizeHtml(html, { resolveImage: (src) => (src === 'a.jpg' ? 'images/a.jpg' : null) }),
    ).toBe('<p><img src="images/a.jpg" alt="" /></p>');
  });

  it('turns an svg cover into an image', () => {
    const html = '<div><svg viewBox="0 0 1 1"><image xlink:href="cover.jpg"/></svg></div>';
    expect(sanitizeHtml(html)).toBe('<div><img src="cover.jpg" alt="" /></div>');
  });

  it('keeps external links and unwraps internal ones', () => {
    expect(sanitizeHtml('<p><a href="https://a.b/c">x</a> <a href="ch2.xhtml#n1">y</a></p>')).toBe(
      '<p><a href="https://a.b/c">x</a> y</p>',
    );
  });

  it('escapes text safely', () => {
    expect(sanitizeHtml('<p>1 &lt; 2 &amp; 3 é</p>')).toBe('<p>1 &lt; 2 &amp; 3 é</p>');
  });
});

describe('text helpers', () => {
  it('extracts text block by block', () => {
    expect(htmlToText('<h1>Title</h1><p>One  <b>two</b></p><p>Three<br/>Four</p>')).toBe(
      'Title\nOne two\nThree\nFour',
    );
  });

  it('counts words, including CJK characters', () => {
    expect(countWords("L'ami d'Hélène arrive aujourd'hui, à 10 h.")).toBe(7);
    expect(countWords('第一卷 hello')).toBe(4);
  });

  it('converts text to paragraphs', () => {
    expect(textToHtml('a < b\n\n  c  ')).toBe('<p>a &lt; b</p>\n<p>c</p>');
  });
});
