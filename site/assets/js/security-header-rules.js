(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SecurityHeaderRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function parseMaxAge(value) {
    const match = /max-age\s*=\s*(\d+)/i.exec(String(value || ''));
    return match ? parseInt(match[1], 10) : null;
  }

  function parseCspDirectives(csp) {
    const directives = Object.create(null);
    String(csp || '').split(';').forEach(function (part) {
      const trimmed = part.trim();
      if (!trimmed) return;
      const bits = trimmed.split(/\s+/);
      const name = bits.shift().toLowerCase();
      if (!name || directives[name]) return;
      directives[name] = bits;
    });
    return directives;
  }

  function evaluateCsp(csp) {
    const text = String(csp || '');
    const present = text.trim().length > 0;
    const directives = parseCspDirectives(text);
    const hasDefaultSrc = Object.prototype.hasOwnProperty.call(directives, 'default-src');
    const hasScriptSrc = Object.prototype.hasOwnProperty.call(directives, 'script-src');
    const nonceOrStrictDynamic = /'nonce-[^']+'/i.test(text) || /'strict-dynamic'/i.test(text);
    const frameValues = directives['frame-ancestors'] || [];
    const frameWildcard = frameValues.indexOf('*') !== -1;

    return {
      present: present,
      directives: directives,
      hasDefaultSrc: hasDefaultSrc,
      hasScriptSrc: hasScriptSrc,
      hasScriptPolicy: hasDefaultSrc || hasScriptSrc,
      nonceOrStrictDynamic: nonceOrStrictDynamic,
      unsafeInline: /unsafe-inline/i.test(text) && !nonceOrStrictDynamic,
      unsafeEval: /unsafe-eval/i.test(text),
      wildcard: /(^|[\s;])\*([\s;]|$)/.test(text),
      frameValues: frameValues,
      frameWildcard: frameWildcard,
      frameRestrictive: frameValues.length > 0 && !frameWildcard
    };
  }

  function evaluateHsts(value) {
    const text = String(value || '');
    const present = text.trim().length > 0;
    const maxAge = present ? parseMaxAge(text) : null;
    const includeSubDomains = /includesubdomains/i.test(text);
    const preload = /\bpreload\b/i.test(text);
    let status = 'fail';
    let score = 0;

    if (present && maxAge != null && maxAge > 0) {
      if (maxAge >= 31536000) score = includeSubDomains ? 1 : 0.7;
      else if (maxAge >= 15768000) score = includeSubDomains ? 0.8 : 0.7;
      else score = 0.6;
      status = score >= 0.8 && includeSubDomains ? 'pass' : 'warn';
    }

    return {
      present: present,
      maxAge: maxAge,
      includeSubDomains: includeSubDomains,
      preload: preload,
      preloadReady: present && maxAge != null && maxAge >= 31536000 && includeSubDomains && preload,
      status: status,
      score: score
    };
  }

  function evaluateFrameProtection(xfo, csp) {
    const cspInfo = typeof csp === 'string' ? evaluateCsp(csp) : (csp || evaluateCsp(''));
    const xfoValue = String(xfo || '').trim().toLowerCase();
    const xfoValid = xfoValue === 'deny' || xfoValue === 'sameorigin';
    return {
      xfoPresent: xfoValue.length > 0,
      xfoValid: xfoValid,
      cspRestrictive: cspInfo.frameRestrictive,
      wildcard: cspInfo.frameWildcard,
      protected: xfoValid || cspInfo.frameRestrictive
    };
  }

  return {
    parseMaxAge: parseMaxAge,
    parseCspDirectives: parseCspDirectives,
    evaluateCsp: evaluateCsp,
    evaluateHsts: evaluateHsts,
    evaluateFrameProtection: evaluateFrameProtection
  };
});
