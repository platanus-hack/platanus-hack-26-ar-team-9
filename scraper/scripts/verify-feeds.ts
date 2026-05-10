import feeds from '../feeds.json' with { type: 'json' };

const results = await Promise.allSettled(
  feeds.map(async (feed) => {
    const res = await fetch(feed.feedUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'scraper/1.0' },
      signal: AbortSignal.timeout(8000),
    }).catch(() =>
      fetch(feed.feedUrl, {
        headers: { 'User-Agent': 'scraper/1.0' },
        signal: AbortSignal.timeout(8000),
      })
    );
    const ct = res.headers.get('content-type') ?? '';
    const ok = res.ok && (ct.includes('xml') || ct.includes('rss') || ct.includes('atom'));
    return { name: feed.name, status: res.status, contentType: ct, ok };
  })
);

let passed = 0;
for (const [i, r] of results.entries()) {
  const feed = feeds[i]!;
  if (r.status === 'fulfilled') {
    const { name, status, contentType, ok } = r.value;
    const mark = ok ? '✅' : '⚠️ ';
    console.log(`${mark} ${name.padEnd(20)} HTTP ${status}  ${contentType.slice(0, 50)}`);
    if (ok) passed++;
  } else {
    console.log(`❌ ${feed.name.padEnd(20)} ERROR: ${r.reason}`);
  }
}

console.log(`\n${passed}/${feeds.length} feeds OK`);
