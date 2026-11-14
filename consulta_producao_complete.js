/* ConsultaProdução ASP.NET: cobertura integral verificável, sem efeito externo. */
'use strict';
function decodeHtml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w$:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeHtml(m[2] === undefined ? m[3] : m[2]);
  return out;
}
function formFields(html) {
  const out = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (!a.name || /^(submit|button|image|file)$/i.test(a.type || '')) continue;
    if (/^(radio|checkbox)$/i.test(a.type || '') && !/\bchecked(?:\s|=|>)/i.test(m[0])) continue;
    out[a.name] = a.value || '';
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const a = attrs(m[1]); if (!a.name) continue;
    const options = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
    const selected = options.find(x => /\bselected(?:\s|=|$)/i.test(x[1])) || options[0];
    out[a.name] = selected ? (attrs(selected[1]).value || '') : '';
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const a = attrs(m[1]); if (a.name) out[a.name] = decodeHtml(m[2]);
  }
  return out;
}
function totalFrom(html) {
  const m = html.match(/Localizada\(s\)\s*<strong>\s*([\d.,]+)\s*<\/strong>/i);
  if (!m) throw new Error('Cobertura não comprovada: total oficial ausente.');
  return Number(m[1].replace(/\D/g, ''));
}
async function collectComplete({ url, parse, fetchImpl = fetch, headers = {}, pageSize = 100, maxPages = 1000, timeoutMs = 45000, onPage = () => {} }) {
  let cookie = ''; let requests = 0;
  async function request(body) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', redirect: 'follow', signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url } : {}) },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}) });
      requests++;
      if (!response.ok) throw new Error('ConsultaProdução HTTP ' + response.status);
      const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
      const jar = new Map(cookie.split('; ').filter(Boolean).map(x => { const i=x.indexOf('='); return [x.slice(0,i),x.slice(i+1)]; }));
      for (const c of setCookies) { const pair=c.split(';')[0]; const i=pair.indexOf('='); if(i>0) jar.set(pair.slice(0,i),pair.slice(i+1)); }
      cookie = [...jar].map(([k,v]) => k+'='+v).join('; ');
      return await response.text();
    } finally { clearTimeout(timer); }
  }
  let html = await request(); const total = totalFrom(html);
  if (total === 0) { if (parse(html).length) throw new Error('Total zero incompatível com itens.'); return { items: [], coverage: { complete:true,total:0,pages:1,requests } }; }
  let fields = formFields(html);
  const sizeField = Object.keys(fields).find(k => k.endsWith('$ddl_ItensExibidos'));
  if (!sizeField || !fields.__VIEWSTATE) throw new Error('Formulário de paginação incompleto.');
  html = await request({ ...fields, __EVENTTARGET: sizeField, __EVENTARGUMENT: '', [sizeField]: String(pageSize) });
  fields = formFields(html);
  if (fields[sizeField] !== String(pageSize)) throw new Error('Fonte não confirmou tamanho de página solicitado.');
  const expectedPages = Math.ceil(total / pageSize);
  if (expectedPages > maxPages) throw new Error('Cobertura incompleta: '+expectedPages+' páginas excedem limite '+maxPages+'.');
  const seen = new Set(); const fingerprints = new Set(); const items = [];
  for (let page=1; page<=expectedPages; page++) {
    if (totalFrom(html) !== total) throw new Error('Fonte mudou total durante paginação; repetir rodada.');
    const rows = parse(html); const expected = Math.min(pageSize, total-(page-1)*pageSize);
    if (rows.length !== expected) throw new Error('Página '+page+' incompleta: '+rows.length+'/'+expected+' itens.');
    const fingerprint = rows.map(x=>String(x.id)).join(',');
    if (fingerprints.has(fingerprint)) throw new Error('Paginação repetiu página; cobertura não comprovada.');
    fingerprints.add(fingerprint);
    for (const row of rows) { const id=String(row.id || ''); if(!id || seen.has(id)) throw new Error('ID vazio/duplicado na fonte; repetir rodada.'); seen.add(id); items.push(row); }
    onPage({ page, expectedPages, count:rows.length, total });
    if(page < expectedPages) {
      fields = formFields(html);
      // O controle Próxima continua avançando além da janela de dez botões.
      const next = [...html.matchAll(/<a\b([^>]*)>[\s\S]*?<\/a>/gi)].map(m=>attrs(m[1])).find(a=>/\$lbNext/.test(a.href || ''));
      const match = next && next.href.match(/__doPostBack\('([^']+)'/);
      if(!match || !fields.__VIEWSTATE) throw new Error('Próxima página oficial ausente antes do fim.');
      html = await request({ ...fields, __EVENTTARGET: match[1], __EVENTARGUMENT: '', [sizeField]:String(pageSize) });
    }
  }
  if(items.length !== total) throw new Error('Total coletado diverge do total oficial.');
  return { items, coverage: { complete:true,total,pages:expectedPages,pageSize,requests } };
}
module.exports = { collectComplete, formFields, totalFrom };
