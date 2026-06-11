const fs = require('fs');
const path = require('path');

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!repo || !token) {
  console.error('GITHUB_REPOSITORY/GITHUB_TOKEN ausente');
  process.exit(1);
}

const filePath = path.join(process.env.GITHUB_WORKSPACE || process.cwd(), 'estado.json');
const content = fs.readFileSync(filePath, 'utf8');
const encoded = Buffer.from(content, 'utf8').toString('base64');
const url = 'https://api.github.com/repos/' + repo + '/contents/estado.json';

const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'monitor-proposicoes-aracaju',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(target, options, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(target, options);
      if (res.status !== 429 && res.status < 500) return res;
      lastError = new Error(label + ' HTTP ' + res.status + ' ' + await res.text());
    } catch (err) {
      lastError = err;
    }
    await sleep(attempt * 5000);
  }
  throw lastError;
}

async function main() {
  const getRes = await fetchWithRetry(url, { headers }, 'GET estado.json');
  let sha = null;
  if (getRes.status === 200) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    throw new Error('GET estado.json failed: ' + getRes.status + ' ' + await getRes.text());
  }

  const body = { message: 'chore: atualiza estado [skip ci]', content: encoded, branch: 'main' };
  if (sha) body.sha = sha;

  const putRes = await fetchWithRetry(url, { method: 'PUT', headers, body: JSON.stringify(body) }, 'PUT estado.json');
  if (!putRes.ok) throw new Error('PUT estado.json failed: ' + putRes.status + ' ' + await putRes.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
