const https = require('https');

function generateFallback() {
  return {
    fallback: true,
    translations: [`※ AIが利用できないため翻訳を生成できません`],
    examples: [
      { en: `（AIが利用できないため例文を生成できません）`, ja: `` },
    ]
  };
}

function singleGeminiRequest(apiKey, body, model) {
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

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

async function callGeminiApi(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return generateFallback();

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
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
      } catch {}
    } else if (res.statusCode === 429) {
      continue;
    }
  }

  return generateFallback();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { text } = req.body || {};
  if (!text || !text.trim()) {
    res.status(400).json({ error: 'テキストを入力してください' });
    return;
  }

  const result = await callGeminiApi(text.trim());
  res.status(200).json(result);
};
