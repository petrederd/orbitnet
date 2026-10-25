'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { SITE, loadTool } = require('./helpers');

function tool(category, slug) {
  return path.join(SITE, 'tools', category, slug + '.html');
}

function makeJwt(secret, payload, alg = 'HS256') {
  const hashes = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac(hashes[alg] || 'sha256', secret).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + signature;
}

test('cron parser expands fields, macros and next runs', () => {
  const { context } = loadTool(tool('developer', 'cron-parser'), {
    cron: '*/15 9-17 * * 1-5', errorMsg: '', results: '',
  });

  const parsed = context.parseCron('*/15 9-17 * * 1-5');
  assert.deepEqual(Array.from(parsed.minutes), [0, 15, 30, 45]);
  assert.deepEqual(Array.from(parsed.hours), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(Array.from(parsed.dows), [1, 2, 3, 4, 5]);
  assert.match(context.describeCron(parsed), /36 specific times/);

  const daily = context.parseCron('@daily');
  assert.equal(daily.normalized, '0 0 * * *');
  const runs = context.nextRuns(daily, 3, new Date('2026-01-15T12:34:56Z'));
  assert.equal(runs.length, 3);
  runs.forEach(run => {
    assert.equal(run.getMinutes(), 0);
    assert.equal(run.getSeconds(), 0);
  });

  const restrictedDays = context.parseCron('0 0 1 * 1');
  assert.equal(restrictedDays.daysStar, false);
  assert.equal(restrictedDays.dowsStar, false);
  assert.match(context.describeCron(restrictedDays), /day 1 of the month or Monday/);
  const restrictedRuns = context.nextRuns(restrictedDays, 4, new Date(2026, 0, 15, 12, 0, 0));
  assert.ok(restrictedRuns.some(run => run.getDate() === 1));
  assert.ok(restrictedRuns.some(run => run.getDay() === 1));

  const starStep = context.parseCron('0 0 */2 * 1');
  assert.equal(starStep.daysStar, true);
  assert.match(context.describeCron(starStep), /and Monday/);

  const leap = context.parseCron('0 0 29 2 *');
  const leapRuns = context.nextRuns(leap, 1, new Date(2026, 0, 1, 12, 0, 0));
  assert.equal(leapRuns.length, 1);
  assert.equal(leapRuns[0].getFullYear(), 2028);
  assert.equal(leapRuns[0].getMonth(), 1);
  assert.equal(leapRuns[0].getDate(), 29);

  assert.throws(() => context.parseCron('*/0 * * * *'), /Step must be a positive integer/);
  assert.throws(() => context.parseCron('60 * * * *'), /minute must be between/);
  assert.throws(() => context.parseCron('* * * *'), /Expected 5 fields/);
});

test('URL encoder handles component and full-URI modes', () => {
  const { context, get } = loadTool(tool('developer', 'url-encoder'), {
    input: 'Hello world & 100% / path?q=1', mode: 'component', output: '', stats: '', errorMsg: '',
  });

  assert.equal(
    context.encodeText('Hello world & 100% / path?q=1', 'component'),
    'Hello%20world%20%26%20100%25%20%2F%20path%3Fq%3D1'
  );
  assert.equal(
    context.encodeText('https://example.com/a b?x=1&y=2', 'uri'),
    'https://example.com/a%20b?x=1&y=2'
  );
  assert.equal(context.decodeText('Hello%20world%20%26%20100%25', 'component'), 'Hello world & 100%');
  assert.equal(context.encodeText('a b+c', 'form'), 'a+b%2Bc');
  assert.equal(context.decodeText('a+b%2Bc', 'form'), 'a b+c');
  assert.throws(() => context.decodeText('%ZZ', 'component'), /Invalid percent-encoding/);
  assert.throws(() => context.encodeText('\uD800', 'component'), /Cannot encode text/);

  context.run('encode');
  assert.equal(get('output').value, 'Hello%20world%20%26%20100%25%20%2F%20path%3Fq%3D1');
  assert.match(get('stats').textContent, /UTF-8 bytes/);
});

test('URL parser splits credentials, segments and duplicate query keys', () => {
  const { context } = loadTool(tool('developer', 'url-parser'), {
    urlInput: '', errorMsg: '', results: '',
  });

  const parsed = context.parseUrl('https://user:pass@example.com:8443/path/to/page?tag=a&tag=b&q=hello%20world#section-2');
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, 'example.com');
  assert.equal(parsed.port, '8443');
  assert.equal(parsed.username, 'user');
  assert.equal(parsed.password, 'pass');
  assert.deepEqual(Array.from(parsed.segments), ['path', 'to', 'page']);
  assert.deepEqual(
    Array.from(parsed.params, param => ({ key: param.key, value: param.value })),
    [
      { key: 'tag', value: 'a' },
      { key: 'tag', value: 'b' },
      { key: 'q', value: 'hello world' },
    ]
  );
  assert.equal(context.parseUrl('example.com/x').href, 'https://example.com/x');
  assert.throws(() => context.parseUrl(''), /enter a URL/);
});

test('YAML and JSON converter round-trips both directions', () => {
  const { context } = loadTool(tool('developer', 'yaml-json'), {
    yamlInput: '', jsonInput: '', status: '', errorMsg: '',
  });
  context.jsyaml = yaml;

  const json = context.yamlToJson('name: orbitnet\nports:\n  - 80\n  - 443\nsettings:\n  debug: false\n');
  assert.deepEqual(JSON.parse(json), {
    name: 'orbitnet',
    ports: [80, 443],
    settings: { debug: false },
  });

  const output = context.jsonToYaml('{"name":"orbitnet","enabled":true,"list":[1,null]}');
  assert.deepEqual(yaml.load(output), { name: 'orbitnet', enabled: true, list: [1, null] });
  assert.throws(() => context.yamlToJson(''), /enter YAML/);
  assert.throws(() => context.jsonToYaml('{'), /JSON error/);
});

test('JSON to CSV flattens objects and escapes delimiters', () => {
  const { context } = loadTool(tool('developer', 'json-csv'), {
    jsonInput: '[{"a":1}]', delimiter: ',', flatten: true, header: true,
    protectFormulas: true, bom: false, csvOutput: '', stats: '', errorMsg: '',
  });

  const basic = context.jsonToCsv('[{"a":1,"b":"x,y"},{"a":2,"b":"q\\"z"}]', {
    flatten: true, header: true, bom: false,
  });
  assert.equal(basic.csv, 'a,b\r\n1,"x,y"\r\n2,"q""z"');
  assert.equal(basic.rows, 2);
  assert.equal(basic.columns, 2);

  const nested = context.jsonToCsv('[{"a":{"b":1},"c":[1,2]}]', { flatten: true, header: true });
  assert.equal(nested.csv, 'a.b,c\r\n1,"[1,2]"');

  const tab = context.jsonToCsv('[{"a":1,"b":2}]', { delimiter: '\t', flatten: true, header: true });
  assert.equal(tab.csv, 'a\tb\r\n1\t2');

  assert.equal(context.jsonToCsv('[{"a":1}]', { bom: true }).csv.startsWith('\uFEFF'), true);
  assert.equal(
    context.jsonToCsv('[{"a":"=1+1","b":"-5","c":"@x","d":"safe","e":false,"t":-5,"u":-0.5}]', { protectFormulas: true }).csv,
    'a,b,c,d,e,t,u\r\n\'=1+1,-5,\'@x,safe,false,-5,-0.5'
  );
  assert.equal(
    context.jsonToCsv('[{"a":"=1+1"}]', { protectFormulas: false }).csv,
    'a\r\n=1+1'
  );
  assert.throws(() => context.jsonToCsv('[]'), /array is empty/);
  assert.throws(() => context.jsonToCsv('[1]'), /Row 1 is not an object/);
});

test('JSON diff reports structural paths, not key order', () => {
  const { context } = loadTool(tool('developer', 'json-diff'), {
    leftInput: '{}', rightInput: '{}', results: '', errorMsg: '',
  });

  const changes = context.diffJson({ a: 1, b: [1, 2] }, { a: 2, b: [1, 2, 3], c: true }, '$', []);
  assert.deepEqual(
    Array.from(changes, change => ({ path: change.path, type: change.type })),
    [
      { path: '$.a', type: 'changed' },
      { path: '$.b[2]', type: 'added' },
      { path: '$.c', type: 'added' },
    ]
  );
  assert.equal(context.diffJson({ a: 1, b: 2 }, { b: 2, a: 1 }, '$', []).length, 0);
  assert.equal(context.valueText(undefined), '—');
});

test('redirect generator builds nginx and Apache rules', () => {
  const { context } = loadTool(tool('developer', 'redirect-generator'), {
    rules: '/old -> /new', status: '301', server: 'nginx', keepQuery: true,
    output: '', stats: '', errorMsg: '',
  });

  const rules = context.parseRules('/old -> /new\n/blog/* -> https://example.com/articles/$1 301', '301');
  assert.equal(rules.length, 2);
  assert.equal(rules[1].code, '301');
  assert.equal(rules[1].wildcard, true);
  assert.equal(rules[1].from, '/blog/');

  const nginx = context.generateRedirects(rules, { server: 'nginx', keepQuery: true });
  assert.ok(nginx.includes('location = /old {'));
  assert.ok(nginx.includes('return 301 /new$is_args$args;'));
  assert.ok(nginx.includes('rewrite ^/blog/(.*)$ https://example.com/articles/$1 permanent;'));
  assert.ok(!context.generateRedirects(rules, { server: 'nginx', keepQuery: false }).includes('$is_args'));

  const apache = context.generateRedirects(rules, { server: 'apache' });
  assert.ok(apache.includes('RedirectMatch 301 ^/old$ /new'));
  assert.ok(apache.includes('RedirectMatch 301 ^/blog/(.*)$ https://example.com/articles/$1'));

  const escaped = context.parseRules('/old.html* -> /new/$1', '301');
  assert.ok(context.generateRedirects(escaped, { server: 'nginx' }).includes('rewrite ^/old\\.html(.*)$ /new/$1 permanent;'));

  assert.throws(() => context.parseRules('old -> /new'), /must start with/);
  assert.throws(() => context.parseRules('/old -> /new 200'), /status must be/);
  assert.throws(() => context.parseRules('/old -> /new%0d%0a'), /encoded CR\/LF/);
  assert.throws(() => context.parseRules('/a;b -> /new'), /unsafe/);
  assert.throws(() => context.parseRules("/it's -> /x"), /unsafe/);
  assert.throws(() => context.parseRules('/old -> /x`'), /unsafe/);
  assert.throws(() => context.parseRules('/old -> /new$evil'), /only allowed/);
  assert.throws(
    () => context.generateRedirects(context.parseRules('/blog/* -> /new 308'), { server: 'nginx' }),
    /support 301 and 302/
  );
  assert.throws(() => context.parseRules(''), /at least one/);
});

test('robots generator validates paths and emits directives', () => {
  const { context } = loadTool(tool('developer', 'robots-generator'), {
    userAgent: '*', allowPaths: '/', disallowPaths: '/admin/', crawlDelay: '10',
    sitemap: 'https://example.com/sitemap.xml', output: '', stats: '', errorMsg: '',
  });

  const output = context.buildRobots({
    userAgent: '*',
    allow: ['/'],
    disallow: ['/admin/', '/private/'],
    crawlDelay: '10',
    sitemap: 'https://example.com/sitemap.xml',
  });
  assert.equal(
    output,
    'User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /private/\nCrawl-delay: 10\nSitemap: https://example.com/sitemap.xml\n'
  );

  assert.match(context.buildRobots({ userAgent: 'Googlebot', allow: [], disallow: ['/tmp/'], crawlDelay: '0' }), /Crawl-delay: 0/);
  assert.equal(
    context.buildRobots({ userAgent: '*', allow: [], disallow: [], emptyDisallow: true }),
    'User-agent: *\nDisallow:\n'
  );
  const multiple = context.buildRobots({
    userAgent: 'Googlebot, Bingbot',
    allow: [],
    disallow: [],
    emptyDisallow: true,
    extraGroups: 'User-agent: Yandex\nDisallow: /private/',
  });
  assert.match(multiple, /User-agent: Googlebot\nUser-agent: Bingbot\nDisallow:/);
  assert.match(multiple, /\n\nUser-agent: Yandex\nDisallow: \/private\//);
  const commented = context.buildRobots({
    userAgent: '*',
    extraGroups: '# crawler override\nUser-agent: Yandex\nDisallow: /private/',
  });
  assert.match(commented, /# crawler override\nUser-agent: Yandex\nDisallow: \/private\//);
  assert.throws(() => context.buildRobots({ userAgent: '*', allow: [], disallow: ['admin'] }), /must start with/);
  assert.throws(() => context.buildRobots({ userAgent: 'bad agent' }), /must not contain spaces/);
  assert.throws(() => context.buildRobots({ userAgent: '*', sitemap: 'sitemap.xml' }), /absolute http/);
  assert.throws(() => context.buildRobots({ userAgent: '*', crawlDelay: '-1' }), /non-negative/);
  assert.throws(() => context.buildRobots({ userAgent: '*', extraGroups: 'Not a directive' }), /expected a robots.txt directive/);
});

test('security header sanitizer normalizes names, values and duplicates', () => {
  const { context } = loadTool(tool('developer', 'security-headers'), {
    headersInput: '', results: '', errorMsg: '',
  });

  const headers = context.parseHeaders("Content-Security-Policy: default-src 'self'\nX-Test:   yes   \n");
  assert.equal(headers.length, 2);
  assert.equal(headers[0].name, 'content-security-policy');
  assert.equal(headers[0].value, "default-src 'self'");
  assert.equal(headers[1].value, 'yes');
  assert.throws(() => context.parseHeaders('bad line'), /expected "Name: value"/);

  const report = context.analyzeHeaders(context.parseHeaders(
    "Content-Security-Policy: default-src 'self'; frame-ancestors 'none'\n" +
    'Strict-Transport-Security: max-age=31536000; includeSubDomains\n' +
    'X-Content-Type-Options: nosniff\n' +
    'Referrer-Policy: strict-origin-when-cross-origin\n'
  ));
  assert.ok(report.findings.some(item => item.name === 'Content-Security-Policy' && item.severity === 'good'));
  assert.ok(report.findings.some(item => item.name === 'X-Frame-Options' && item.message.includes('frame-ancestors')));
  assert.ok(report.findings.some(item => item.name === 'X-Frame-Options' && item.severity === 'good'));

  const duplicate = context.analyzeHeaders(context.parseHeaders('X-Test: a\nX-Test: b\n'));
  assert.equal(duplicate.sanitized.get('x-test'), 'a');
  assert.deepEqual(Array.from(duplicate.duplicates), ['x-test']);

  const snippet = context.nginxSnippet(new Map([
    ['x-frame-options', 'DENY'],
    ['content-security-policy', "default-src 'self'"],
  ]));
  assert.ok(snippet.includes('add_header Content-Security-Policy "default-src \'self\'" always;'));
  assert.ok(snippet.includes('add_header X-Frame-Options "DENY" always;'));
  assert.ok(context.nginxSnippet(new Map([['x-test', 'a"b\\c$d']]))
    .includes('add_header X-Test "a\\"b\\\\c$d" always;'));
  const dollarHeader = context.analyzeHeaders(context.parseHeaders('X-Test: $value\n'));
  assert.ok(dollarHeader.findings.some(item => item.name === 'x-test' && /expands it as a variable/.test(item.message)));

  const disabledHsts = context.analyzeHeaders(context.parseHeaders('Strict-Transport-Security: max-age=0\n'));
  assert.ok(disabledHsts.findings.some(item => item.name === 'Strict-Transport-Security' && item.severity === 'error' && /disables HSTS/.test(item.message)));

  const nonceCsp = context.analyzeHeaders(context.parseHeaders(
    "Content-Security-Policy: default-src 'self'; script-src 'nonce-abc123' 'unsafe-inline'\n"
  ));
  assert.ok(!nonceCsp.findings.some(item => item.name === 'Content-Security-Policy' && /unsafe-inline/.test(item.message)));

  const wildcardFrames = context.analyzeHeaders(context.parseHeaders(
    "Content-Security-Policy: default-src 'self'; frame-ancestors *\n"
  ));
  assert.ok(wildcardFrames.findings.some(item => item.name === 'Content-Security-Policy' && /does not restrict framing/.test(item.message)));
  assert.ok(!wildcardFrames.findings.some(item => item.name === 'X-Frame-Options' && item.severity === 'good'));
});

test('IPv6 subnet parser handles compression, ranges and address types', () => {
  const { context } = loadTool(tool('networks', 'ipv6-subnet-calculator'), {
    ipv6: '2001:db8:1234:5678::1', prefix: '64', errorMsg: '', results: '',
  });

  const address = context.parseIPv6('2001:db8::1');
  assert.equal(address, 0x20010db8000000000000000000000001n);
  assert.equal(context.expandIPv6(address), '2001:0db8:0000:0000:0000:0000:0000:0001');
  assert.equal(context.compressIPv6('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(context.compressIPv6('2001:0:0:1:0:0:1:1'), '2001::1:0:0:1:1');
  assert.equal(context.compressIPv6('::'), '::');

  const info = context.subnetInfo(address, 64);
  assert.equal(context.compressIPv6(info.network), '2001:db8::');
  assert.equal(context.compressIPv6(info.last), '2001:db8::ffff:ffff:ffff:ffff');
  assert.equal(info.count.toString(), '18446744073709551616');
  assert.equal(context.formatCount(info.count), '18,446,744,073,709,551,616');

  assert.equal(context.addressType(context.parseIPv6('::')), 'Unspecified (::)');
  assert.equal(context.addressType(context.parseIPv6('::1')), 'Loopback (::1)');
  assert.equal(context.addressType(context.parseIPv6('fe80::1')), 'Link-local');
  assert.equal(context.addressType(context.parseIPv6('fc00::1')), 'Unique local (ULA)');
  assert.equal(context.addressType(context.parseIPv6('ff02::1')), 'Multicast');
  assert.equal(context.addressType(context.parseIPv6('::ffff:192.0.2.1')), 'IPv4-mapped');

  assert.throws(() => context.parseIPv6('2001:db8::1::2'), /only one/);
  assert.throws(() => context.parseIPv6('2001:db8::gg'), /Invalid IPv6 group/);
  assert.throws(() => context.parsePrefix('129'), /between 0 and 128/);
});

test('IPv6 converter exposes every common representation', () => {
  const { context } = loadTool(tool('networks', 'ipv6-converter'), {
    ipv6: '2001:db8::1', errorMsg: '', results: '',
  });

  const address = context.parseIPv6('::ffff:192.0.2.1');
  assert.equal(context.compressIPv6(address), '::ffff:c000:201');
  assert.equal(context.addressType(address), 'IPv4-mapped');
  assert.equal(context.binaryString(1n).length, 135);
  assert.ok(context.binaryString(1n).endsWith('0000000000000001'));
  assert.ok(context.reverseDns(1n).startsWith('1.0.0.0.'));
  assert.ok(context.reverseDns(1n).endsWith('.ip6.arpa'));
});

test('Unicode inspector counts code points, bytes and invisible controls', () => {
  const { context } = loadTool(tool('text', 'unicode-inspector'), {
    input: '', errorMsg: '', results: '',
  });

  const report = context.inspectText('A\u200B\u202E👋');
  assert.equal(report.codePoints, 4);
  assert.equal(report.utf16Units, 5);
  assert.equal(report.bytes, 11);
  assert.deepEqual(Array.from(report.suspicious, item => item.hex), ['U+200B', 'U+202E']);
  assert.equal(context.stripInvisible('A\u200B\u202E👋'), 'A👋');

  const emoji = context.inspectText('👋');
  assert.equal(emoji.codePoints, 1);
  assert.equal(emoji.utf16Units, 2);
  assert.equal(emoji.bytes, 4);

  const accent = context.inspectText('é');
  assert.equal(accent.nfc, 'é');
  assert.equal(accent.nfd, 'e\u0301');
  assert.equal(context.charInfo('\u202E').risk, 'high');
  assert.equal(context.displayChar('\u200B'), '∅');
});

test('JWT decoder highlights time claims and verifies HMAC signatures', async () => {
  const secret = 'a-long-test-secret';
  const now = Math.floor(Date.now() / 1000);
  const token = makeJwt(secret, { sub: '42', iat: now - 60, nbf: now - 30, exp: now + 3600 });
  const { context, get } = loadTool(tool('developer', 'jwt-decoder'), {
    token, secret, secretIsBase64: false, results: '', errorMsg: '', verifyError: '', verifyResult: '',
  });

  context.decode();
  const html = get('results').innerHTML;
  assert.match(html, /Token expires on/);
  assert.match(html, /expires in/);
  assert.match(html, /iat/);
  assert.match(html, /nbf/);
  assert.match(html, /Not verified/);

  await context.verifySignature();
  assert.match(get('verifyResult').innerHTML, /Signature is valid for HS256/);

  get('secret').value = 'wrong-secret';
  await context.verifySignature();
  assert.match(get('verifyResult').innerHTML, /Signature does not match/);

  get('secret').value = secret;
  const parts = token.split('.');
  const tampered = Buffer.from(JSON.stringify({ sub: '43', iat: now - 60, nbf: now - 30, exp: now + 3600 })).toString('base64url');
  get('token').value = parts[0] + '.' + tampered + '.' + parts[2];
  await context.verifySignature();
  assert.match(get('verifyResult').innerHTML, /Signature does not match/);

  get('token').value = makeJwt(secret, { sub: '1', exp: now - 10 });
  context.decode();
  assert.match(get('results').innerHTML, /Token expired on/);

  get('token').value = makeJwt(secret, { sub: '1', nbf: now + 600 });
  context.decode();
  assert.match(get('results').innerHTML, /Token is not valid yet/);

  const unsupportedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const unsupportedBody = Buffer.from(JSON.stringify({ sub: '1' })).toString('base64url');
  get('token').value = unsupportedHeader + '.' + unsupportedBody + '.x';
  await context.verifySignature();
  assert.match(get('verifyError').innerHTML, /supports HS256/);

  const oddHeader = Buffer.from(JSON.stringify({ alg: 'RS<256>', typ: 'JWT' })).toString('base64url');
  get('token').value = oddHeader + '.' + unsupportedBody + '.x';
  await context.verifySignature();
  const oddError = get('verifyError').children[get('verifyError').children.length - 1];
  assert.match(oddError.textContent, /RS<256>/);
  assert.doesNotMatch(oddError.textContent, /&lt;/);

  const key = Buffer.from('base64-encoded-test-key');
  get('token').value = makeJwt(key, { sub: 'base64' });
  get('secret').value = key.toString('base64');
  get('secretIsBase64').checked = true;
  await context.verifySignature();
  assert.match(get('verifyResult').innerHTML, /Signature is valid/);

  get('secret').value = 'not base64!';
  await context.verifySignature();
  assert.match(get('verifyError').children[get('verifyError').children.length - 1].textContent, /not valid base64/);
});

test('DNSSEC checker renders statuses, the chain and escapes detail text', () => {
  const { context, get } = loadTool(tool('networks', 'dnssec-checker'), {
    host: 'example.com', type: 'A', results: '', errorMsg: '',
  });

  context.renderDnssec('example.com', 'A', {
    status: 'secure',
    ad: true,
    dnsStatus: 0,
    zone: 'example.com',
    resolver: 'Cloudflare 1.1.1.1',
    detail: 'The resolver set the Authenticated Data (AD) bit.',
    zones: [{
      name: 'example.com',
      ds: [{ keyTag: 2371, algorithm: 13, digestType: 2, digest: 'ABCD' }],
      dnskey: [{ flags: 257, protocol: 3, algorithm: 13 }],
      rrsig: [{ typeCovered: 'DNSKEY', algorithm: 13, keyTag: 2371, signer: 'example.com' }],
      dsOk: true,
      dnskeyOk: true,
    }],
    answer: [{ name: 'example.com', type: 'A', ttl: 300, data: '192.0.2.1' }],
    rrsig: [{ typeCovered: 'A', algorithm: 13, keyTag: 2371, signer: 'example.com', expiration: 1792997346 }],
  });
  let html = get('results').innerHTML;
  assert.match(html, /<strong>Secure<\/strong>/);
  assert.match(html, /AD bit: set/);
  assert.match(html, /DS keyTag=2371/);
  assert.match(html, /DNSKEY flags=257/);
  assert.match(html, /RRSIG DNSKEY/);
  assert.match(html, /192\.0\.2\.1/);

  context.renderDnssec('bad.example.com', 'A', {
    status: 'bogus',
    ad: false,
    dnsStatus: 2,
    zone: '',
    resolver: 'Cloudflare 1.1.1.1',
    detail: '<script>alert(1)</script>',
    zones: [],
    answer: [],
    rrsig: [],
  });
  html = get('results').innerHTML;
  assert.match(html, /<strong>Bogus<\/strong>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /No answer records/);
});
