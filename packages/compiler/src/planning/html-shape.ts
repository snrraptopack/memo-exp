/** HTML parser shape constraints shared by initial HTML and DOM templates. */
export const UNSAFE_TAGS = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'listing',
  'template',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'colgroup',
  'select',
  'option',
  'optgroup',
  'datalist',
  'frameset',
  // Native HTML parsing can close/reparent these nodes or ignore their
  // start/end tags depending on ancestry. Keep their factories imperative.
  'html',
  'head',
  'body',
  'caption',
  'td',
  'th',
  'ruby',
  'rb',
  'rp',
  'rt',
  'rtc',
  'pre',
  'image',
  'isindex',
  'keygen',
  'nobr',
  'svg',
  'math',
]);

export const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const P_CLOSERS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol',
  'p', 'pre', 'search', 'section', 'table', 'ul', 'li', 'dt', 'dd',
  'center', 'dialog', 'dir', 'summary',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function parserClosesAncestor(tag: string, ancestors: string[]): boolean {
  if (P_CLOSERS.has(tag) && ancestors.includes('p')) return true;
  if (['a', 'button', 'form'].includes(tag) && ancestors.includes(tag)) {
    return true;
  }
  // A nested list container stops the parser's scan for a preceding li.
  const item=ancestors.lastIndexOf('li');
  if (tag==='li' && item>=0 && !ancestors.slice(item+1).some(tag=>tag==='ul'||tag==='ol')) return true;
  if ((tag === 'dt' || tag === 'dd') &&
      ancestors.some(ancestor => ancestor === 'dt' || ancestor === 'dd')) {
    return true;
  }
  return HEADINGS.has(tag) && ancestors.some(ancestor => HEADINGS.has(ancestor));
}


