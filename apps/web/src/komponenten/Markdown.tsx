import type { ComponentChildren } from 'preact';

/**
 * Kleiner, sicherer Markdown-Renderer: erzeugt Preact-Elemente (kein innerHTML, kein HTML aus dem Text).
 * Unterstützt: Überschriften, Absätze, Listen (auch nummeriert), Codeblöcke, Tabellen, Zitate,
 * **fett**, _kursiv_, `Code`, [Links](https://…) – nur http(s) und relative Pfade.
 */

function inline(text: string, schluessel = 'i'): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(_([^_]+)_)|(\*([^*]+)\*)/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > pos) out.push(text.slice(pos, m.index));
    const k = `${schluessel}-${n++}`;
    if (m[2]) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[6] && m[7]) {
      const url = m[7];
      const sicher = /^https?:\/\//.test(url) || url.startsWith('/');
      out.push(
        sicher ? (
          <a key={k} href={url} {...(url.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
            {m[6]}
          </a>
        ) : (
          m[6]
        ),
      );
    } else if (m[9]) out.push(<em key={k}>{m[9]}</em>);
    else if (m[11]) out.push(<em key={k}>{m[11]}</em>);
    pos = m.index + m[0].length;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const zeilen = text.replace(/\r\n/g, '\n').split('\n');
  const bloecke: ComponentChildren[] = [];
  let i = 0;
  let k = 0;
  while (i < zeilen.length) {
    const z = zeilen[i]!;
    if (!z.trim()) {
      i++;
      continue;
    }
    // Codeblock
    if (z.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < zeilen.length && !zeilen[i]!.trim().startsWith('```')) code.push(zeilen[i++]!);
      i++;
      bloecke.push(<pre key={k++} class="md-code">{code.join('\n')}</pre>);
      continue;
    }
    // Überschrift
    const h = z.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const stufe = Math.min(h[1]!.length + 1, 5);
      const Tag = `h${stufe}` as 'h2';
      bloecke.push(<Tag key={k++}>{inline(h[2]!)}</Tag>);
      i++;
      continue;
    }
    // Tabelle
    if (z.trim().startsWith('|') && zeilen[i + 1]?.match(/^\s*\|?\s*:?-{2,}/)) {
      const zellen = (s: string) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const kopf = zellen(z);
      i += 2;
      const rumpf: string[][] = [];
      while (i < zeilen.length && zeilen[i]!.trim().startsWith('|')) rumpf.push(zellen(zeilen[i++]!));
      bloecke.push(
        <div class="md-tabelle" key={k++}>
          <table>
            <thead><tr>{kopf.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
            <tbody>{rumpf.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    // Liste
    if (/^\s*([-*•]|\d+[.)])\s+/.test(z)) {
      const nummeriert = /^\s*\d+[.)]/.test(z);
      const punkte: { text: string; tief: boolean }[] = [];
      while (i < zeilen.length && /^\s*([-*•]|\d+[.)])\s+/.test(zeilen[i]!)) {
        const zl = zeilen[i++]!;
        punkte.push({ text: zl.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), tief: /^\s{2,}/.test(zl) });
      }
      const Liste = nummeriert ? 'ol' : 'ul';
      bloecke.push(
        <Liste key={k++}>
          {punkte.map((p, j) => (
            <li key={j} class={p.tief ? 'md-tief' : undefined}>{inline(p.text)}</li>
          ))}
        </Liste>,
      );
      continue;
    }
    // Zitat
    if (z.startsWith('>')) {
      const teile: string[] = [];
      while (i < zeilen.length && zeilen[i]!.startsWith('>')) teile.push(zeilen[i++]!.replace(/^>\s?/, ''));
      bloecke.push(<blockquote key={k++}>{inline(teile.join(' '))}</blockquote>);
      continue;
    }
    // Absatz
    const absatz: string[] = [];
    while (i < zeilen.length && zeilen[i]!.trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s+|\||>)/.test(zeilen[i]!)) absatz.push(zeilen[i++]!);
    if (absatz.length === 0) absatz.push(zeilen[i++]!);
    bloecke.push(<p key={k++}>{inline(absatz.join(' '))}</p>);
  }
  return <div class="markdown">{bloecke}</div>;
}
