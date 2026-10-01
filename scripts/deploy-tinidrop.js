'use strict';
// Publishes the website to TiniDrop using their upload API (same calls as the official TiniDrop CLI).
//   TINIDROP_API_KEY=td_...  node scripts/deploy-tinidrop.js            -> first upload, prints the slug
//   TINIDROP_SLUG=<slug>     node scripts/deploy-tinidrop.js            -> updates the same link in place
// Optional: RB21_API (game server address), TINIDROP_API_URL (default https://tinidrop.com).
const { packSite } = require('./pack-site');

async function deploy({ apiKey, slug, apiUrl = 'https://tinidrop.com', api } = {}) {
  if (!apiKey) throw new Error('Missing TINIDROP_API_KEY (TiniDrop Dashboard → Settings → API Keys)');
  const form = new FormData();
  form.append('file', new Blob([packSite({ api })]), 'riverboat21-site.zip');
  if (slug) form.append('slug', slug);
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/upload`, { method: slug ? 'PUT' : 'POST', headers: { 'x-api-key': apiKey }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `TiniDrop upload failed (${res.status})`);
  return data;
}
module.exports = { deploy };
if (require.main === module) {
  deploy({ apiKey: process.env.TINIDROP_API_KEY, slug: process.env.TINIDROP_SLUG, apiUrl: process.env.TINIDROP_API_URL, api: process.env.RB21_API })
    .then((r) => {
      console.log('Deployed to TiniDrop');
      for (const k of ['liveSiteUrl', 'siteUrl', 'url', 'slug']) if (r[k]) console.log(`  ${k}: ${r[k]}`);
      if (!process.env.TINIDROP_SLUG && r.slug) console.log(`\nSave this slug as TINIDROP_SLUG so future deploys update the same link: ${r.slug}`);
    })
    .catch((e) => { console.error('Error:', e.message); process.exit(1); });
}
