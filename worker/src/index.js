// OrbitNet external reachability checker.
//
// Called only by the OrbitNet backend, never by browsers. The shared secret is
// stored as a Worker secret (wrangler secret put CHECKER_SECRET) and is checked
// on every request.
//
// Request:  POST /  {"host":"example.com"}
// Header:   Authorization: Bearer <CHECKER_SECRET>
// Response: {reachable:true,status,protocol,title,...} or 502 {reachable:false,error}

export default {
  async fetch(request, env) {
    const json = (data, status = 200) =>
      Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store" }
      });

    // 1. Only POST requests are allowed.
    if (request.method !== "POST") {
      return json({ error: "POST required" }, 405);
    }

    // 2. Authenticate the caller.
    const secret = env.CHECKER_SECRET;
    if (
      !secret ||
      request.headers.get("Authorization") !== `Bearer ${secret}`
    ) {
      return json({ error: "Unauthorized" }, 401);
    }

    // 3. Parse and validate input.
    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (
      !input ||
      typeof input.host !== "string" ||
      input.host.length > 253
    ) {
      return json({ error: "Invalid host" }, 400);
    }

    const host = input.host.toLowerCase().replace(/\.$/, "");

    const labels = host.split(".");
    const validHost =
      labels.length >= 2 &&
      labels.every(
        (label) =>
          label.length >= 1 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
      );

    const forbiddenSuffixes = [
      "localhost",
      "local",
      "internal",
      "test",
      "invalid"
    ];

    const looksLikeIPv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

    if (
      !validHost ||
      looksLikeIPv4 ||
      forbiddenSuffixes.some(
        (suffix) => host === suffix || host.endsWith("." + suffix)
      )
    ) {
      return json({ error: "Public domain required" }, 400);
    }

    // Read at most 64 KiB of HTML. Never return the whole page.
    async function readLimitedText(response, maxBytes = 64 * 1024) {
      if (!response.body) return "";

      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      let complete = false;

      try {
        while (total < maxBytes) {
          const { done, value } = await reader.read();
          if (done) {
            complete = true;
            break;
          }

          const remaining = maxBytes - total;
          const chunk = value.subarray(0, remaining);
          chunks.push(chunk);
          total += chunk.byteLength;

          if (chunk.byteLength < value.byteLength) break;
        }

        const bytes = new Uint8Array(total);
        let offset = 0;

        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }

        return new TextDecoder().decode(bytes);
      } finally {
        if (!complete) {
          try {
            await reader.cancel();
          } catch {}
        }
      }
    }

    function extractTitle(html) {
      const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
      if (!match) return null;

      return match[1]
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300) || null;
    }

    const securityHeaderNames = {
      strictTransportSecurity: "strict-transport-security",
      contentSecurityPolicy: "content-security-policy",
      xContentTypeOptions: "x-content-type-options",
      xFrameOptions: "x-frame-options",
      referrerPolicy: "referrer-policy",
      permissionsPolicy: "permissions-policy"
    };

    const started = Date.now();
    let lastError = "Connection failed";

    // 4. Try HTTPS first, then HTTP if the connection itself fails.
    for (const protocol of ["https:", "http:"]) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(`${protocol}//${host}/`, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "OrbitNet-Website-Checker/1.0"
          }
        });

        const contentType = response.headers.get("content-type") || "";
        const contentLength = response.headers.get("content-length");
        const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);

        // Only inspect a small amount of HTML.
        let title = null;
        if (isHtml && response.status >= 200 && response.status < 300) {
          const html = await readLimitedText(response);
          title = extractTitle(html);
        } else {
          try {
            await response.body?.cancel();
          } catch {}
        }

        const securityHeaders = {};
        for (const [key, headerName] of Object.entries(securityHeaderNames)) {
          securityHeaders[key] = response.headers.has(headerName)
            ? "present"
            : "missing";
        }

        const status = response.status;

        return json({
          host,
          reachable: true,
          httpOk: status >= 200 && status < 400,
          protocol: protocol.slice(0, -1),
          status,
          statusText: response.statusText,
          responseMs: Date.now() - started,
          redirect: response.headers.get("location"),
          contentType: contentType || null,
          contentLength: contentLength && /^\d+$/.test(contentLength)
            ? Number(contentLength)
            : null,
          title,
          server: response.headers.get("server") || null,
          securityHeaders,
          source: "Cloudflare Worker"
        });
      } catch (error) {
        lastError =
          error?.name === "AbortError"
            ? "Connection timed out"
            : "Connection failed";
      } finally {
        clearTimeout(timer);
      }
    }

    return json({
      host,
      reachable: false,
      httpOk: false,
      status: null,
      responseMs: Date.now() - started,
      error: lastError,
      source: "Cloudflare Worker"
    }, 502);
  }
};
