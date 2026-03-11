// 英語フレーズ練習 - ローカルHTTPサーバー
// 使い方: node server.js
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const ROOT = __dirname;

// Gemini APIキーを取得（環境変数 or .envファイル）
function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
    const match = envFile.match(/GEMINI_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch {}
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function generateFallback(text) {
  return {
    fallback: true,
    translations: [`※ AIが利用できないため翻訳を生成できません`],
    examples: [
      { en: `（AIが利用できないため例文を生成できません）`, ja: `` },
    ]
  };
}

// 最後にAPIを呼んだ時刻（連続リクエスト防止）
let lastApiCall = 0;
const MIN_INTERVAL = 2000; // 最低2秒間隔

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function singleGeminiRequest(apiKey, body, model = 'gemini-2.0-flash') {
  return new Promise((resolve) => {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`);

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('error', (e) => resolve({ statusCode: 0, body: '', error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ statusCode: 0, body: '', error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// 試すモデルの優先順（429/エラーの場合に次のモデルへ）
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

async function callGeminiApi(text) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return generateFallback(text);

  // 連続リクエスト防止
  const now = Date.now();
  const wait = MIN_INTERVAL - (now - lastApiCall);
  if (wait > 0) await sleep(wait);
  lastApiCall = Date.now();

  const prompt = `あなたは英語学習アシスタントです。以下の英語の表現・単語について回答してください。
必ずJSON形式のみで回答し、他の説明文は一切付けないでください。

入力: "${text}"

以下のJSON形式で回答してください:
{
  "translations": ["日本語訳1", "日本語訳2", "日本語訳3"],
  "examples": [
    {"en": "入力された表現を自然に使った英語の例文1", "ja": "その日本語訳（カジュアルな口語体で）"},
    {"en": "入力された表現を自然に使った英語の例文2", "ja": "その日本語訳（カジュアルな口語体で）"},
    {"en": "入力された表現を自然に使った英語の例文3", "ja": "その日本語訳（カジュアルな口語体で）"}
  ]
}

注意:
- translationsは、その表現の代表的な日本語訳を3つ挙げてください
- 例文は日常会話で実際に使われるような自然な短い文にしてください
- 日本語訳はカジュアルな話し言葉にしてください
- 入力された表現を""で囲んだりせず、文の中に自然に組み込んでください`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7 }
  });

  for (const model of GEMINI_MODELS) {
    const res = await singleGeminiRequest(apiKey, body, model);

    if (res.statusCode === 200) {
      try {
        const json = JSON.parse(res.body);
        const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) continue;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          console.log(`Gemini API 成功 (${model})`);
          return result;
        }
      } catch {}
    } else if (res.statusCode === 429) {
      console.log(`Gemini API 429 (${model}) - 次のモデルを試行`);
      continue;
    } else {
      console.log(`Gemini API エラー (${model}): ${res.statusCode}`);
    }
  }

  console.log('全モデル失敗 - フォールバック使用');
  return generateFallback(text);
}

const server = http.createServer((req, res) => {
  // CORS対応
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API endpoint: POST /api/translate
  if (req.method === 'POST' && req.url === '/api/translate') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      };
      try {
        const { text } = JSON.parse(body);
        if (!text || !text.trim()) {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ error: 'テキストを入力してください' }));
          return;
        }
        const result = await callGeminiApi(text.trim());
        res.writeHead(200, headers);
        res.end(JSON.stringify(result));
      } catch (e) {
        console.log('API処理エラー:', e);
        res.writeHead(200, headers);
        res.end(JSON.stringify(generateFallback('')));
      }
    });
    return;
  }

  // Static file serving
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // Service Worker は必ずブラウザに再検証させる
    if (urlPath === '/sw.js') {
      headers['Cache-Control'] = 'no-cache';
      headers['Service-Worker-Allowed'] = '/';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const apiKey = getGeminiApiKey();
  console.log('英語フレーズ練習 サーバー起動');
  console.log(`ローカル:    http://localhost:${PORT}/`);
  console.log(`Tailscale:   http://[TailscaleのIP]:${PORT}/`);
  console.log(`Gemini API:  ${apiKey ? '有効' : '未設定（フォールバックモード）'}`);
  console.log('停止: Ctrl+C');
});
