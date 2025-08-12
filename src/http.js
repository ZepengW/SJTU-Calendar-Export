export function gmHttp(opts) {
  return new Promise((resolve, reject) => {
    const gm = typeof GM_xmlhttpRequest !== "undefined"
      ? GM_xmlhttpRequest
      : (window.GM && window.GM.xmlHttpRequest);
    if (!gm) {
      fetch(opts.url, {
        method: opts.method || "GET",
        headers: opts.headers || {},
        body: opts.data || undefined
      })
        .then(async (r) => {
          const text = await r.text();
          resolve({ status: r.status, responseText: text, finalUrl: r.url, ok: r.ok });
        })
        .catch(reject);
      return;
    }
    gm({
      method: opts.method || "GET",
      url: opts.url,
      headers: opts.headers || {},
      data: opts.data || undefined,
      responseType: opts.responseType || "text",
      onload(resp) {
        resolve({
          status: resp.status,
          responseText: resp.responseText,
          finalUrl: resp.finalUrl || opts.url,
          ok: resp.status >= 200 && resp.status < 300
        });
      },
      onerror(err) { reject(err); },
      ontimeout() { reject(new Error("timeout")); }
    });
  });
}
