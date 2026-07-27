// Vercel 서버리스 함수 — /api/chat
//
// 프런트는 Anthropic Messages 형식으로 요청을 보내고 `data.content[0].text`로
// 응답을 읽는다. 그 계약을 유지한 채 여기서만 제공자를 바꾼다.
// 그래서 App.jsx는 한 줄도 안 고쳐도 되고, 나중에 되돌리기도 쉽다.
//
// 환경변수
//   AI_PROVIDER          "gemini"(기본) | "anthropic"
//   GEMINI_API_KEY       Google AI Studio 키
//   GEMINI_TEXT_MODEL    비우면 gemini-flash-latest 부터 자동으로 찾아 쓴다
//   GEMINI_VISION_MODEL  위와 같음
//   ANTHROPIC_API_KEY    AI_PROVIDER=anthropic 일 때만

export const config = { runtime: "edge" };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Anthropic 메시지 → Gemini contents.
 *
 * 프런트가 보내는 형태는 두 가지뿐이다.
 *   content: "문자열"
 *   content: [{type:"text"...}, {type:"image", source:{type:"base64",...}}]
 */
const toGeminiContents = (messages = []) =>
  messages.map((m) => {
    const parts = [];
    const c = m.content;

    if (typeof c === "string") {
      parts.push({ text: c });
    } else if (Array.isArray(c)) {
      for (const block of c) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "image" && block.source?.type === "base64") {
          parts.push({
            inline_data: {
              mime_type: block.source.media_type || "image/jpeg",
              data: block.source.data,
            },
          });
        }
      }
    }

    // Gemini는 assistant를 "model"이라고 부른다
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

const hasImage = (messages = []) =>
  messages.some(
    (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image")
  );

/**
 * 이번 요청에 쓸 모델 후보들.
 *
 * 모델 이름을 박아두면 구글이 갈아치울 때마다 앱이 멈춘다. 실제로
 * 2.0은 셧다운됐고 2.5-flash-lite는 "신규 사용자에게 더 이상 제공되지
 * 않는다"며 거절당했다. 그래서 버전이 안 박힌 별칭을 맨 앞에 둔다.
 */
const modelChain = (forVision) => {
  const pinned = forVision
    ? process.env.GEMINI_VISION_MODEL
    : process.env.GEMINI_TEXT_MODEL;
  return [
    pinned,
    "gemini-flash-latest", // 항상 현재 GA flash를 가리키는 별칭
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    discovered, // 아래에서 실제 목록을 조회해 찾아낸 모델
  ].filter((m, i, a) => m && a.indexOf(m) === i);
};

/**
 * 후보가 전부 막혔을 때 실제로 쓸 수 있는 모델을 API에 물어본다.
 *
 * 이게 있어야 다음번에 구글이 또 이름을 바꿔도 코드를 안 고친다.
 * 한 번 찾으면 인스턴스가 살아있는 동안 재사용한다.
 */
let discovered = null;

const discoverFlashModel = async (key) => {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`
    );
    if (!res.ok) return null;
    const { models = [] } = await res.json();
    const usable = models.filter(
      (m) =>
        (m.supportedGenerationMethods || []).includes("generateContent") &&
        /flash/i.test(m.name) &&
        !/preview|exp|image|tts|live/i.test(m.name)
    );
    // 이름이 짧은 쪽이 대체로 상위 별칭이라 먼저 시도한다
    usable.sort((a, b) => a.name.length - b.name.length);
    const found = usable[0]?.name?.replace(/^models\//, "") || null;
    if (found) discovered = found;
    return found;
  } catch {
    return null;
  }
};

const callGemini = async (body) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return json({ error: "GEMINI_API_KEY 환경 변수가 설정되지 않았습니다." }, 500);
  }

  const payload = {
    contents: toGeminiContents(body.messages),
    generationConfig: {
      maxOutputTokens: body.max_tokens ?? 1000,
      // 최근 Gemini는 기본으로 "생각"을 하는데 그 토큰도 maxOutputTokens에서
      // 깎인다. 짧은 JSON을 뽑는 용도라, 생각하다 예산이 떨어지면 본문이
      // 빈 채로 돌아온다. 그래서 꺼둔다.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (body.system) {
    payload.systemInstruction = { parts: [{ text: body.system }] };
  }

  const url = (m) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const callOnce = async (m, cfg) => {
    const res = await fetch(url(m), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, generationConfig: cfg }),
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
    return { res, data };
  };

  // 503(붐빔) · 429(한도) · 5xx는 잠시 뒤에 되는 경우가 많다
  const retryable = (s) => s === 429 || s === 500 || s === 503 || s === 504;

  const tried = [];
  let last = null;

  const attemptModel = async (model) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let { res, data } = await callOnce(model, payload.generationConfig);

      // thinkingConfig는 세대마다 이름이 달라서 거부당할 수 있다. 그것만 빼고
      // 다시 부르되, 생각에 토큰을 쓰고 본문이 비지 않도록 예산을 늘려준다.
      if (res.status === 400) {
        const { thinkingConfig, ...restCfg } = payload.generationConfig;
        ({ res, data } = await callOnce(model, {
          ...restCfg,
          maxOutputTokens: Math.min((body.max_tokens ?? 1000) * 4, 8000),
        }));
      }

      if (res.ok) return { ok: true, data, model };

      last = { status: res.status, data, model };
      tried.push(`${model}:${res.status}`);
      if (!retryable(res.status)) return { ok: false }; // 다시 해도 같은 실패
      if (attempt === 0) await sleep(900);
    }
    return { ok: false };
  };

  const finish = ({ data, model }) => {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const out = parts
      .map((p) => p.text || "")
      .join("")
      .trim();
    // 프런트가 기대하는 Anthropic 응답 모양으로 되돌린다
    return json({
      content: [{ type: "text", text: out }],
      model,
      provider: "gemini",
      finishReason: data?.candidates?.[0]?.finishReason,
    });
  };

  for (const model of modelChain(hasImage(body.messages))) {
    const r = await attemptModel(model);
    if (r.ok) return finish(r);
  }

  // 후보가 전부 막혔다. 쓸 수 있는 모델을 직접 물어보고 한 번 더 시도한다.
  const fresh = await discoverFlashModel(key);
  if (fresh && !tried.some((x) => x.startsWith(`${fresh}:`))) {
    const r = await attemptModel(fresh);
    if (r.ok) return finish(r);
  }

  const status = last?.status ?? 500;
  // 사장님 화면에 영어 에러가 뜨면 고장난 걸로 오해하니 한국어로 바꾼다.
  const msg =
    status === 429
      ? "오늘 AI 사용량이 모두 찼어요. 내일 다시 이용해주세요."
      : retryable(status)
        ? "AI 서버가 지금 붐벼요. 잠시 뒤에 다시 눌러주세요."
        : "AI 연결에 문제가 있어요. 잠시 뒤에 다시 시도해주세요.";

  return json(
    { error: msg, status, tried, detail: last?.data?.error?.message },
    status
  );
};

const callAnthropic = async (body) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json({ error: "ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다." }, 500);
  }

  const payload = {
    model: body.model || "claude-haiku-4-5-20251001",
    max_tokens: body.max_tokens ?? 1000,
    messages: body.messages,
  };
  if (body.system) payload.system = body.system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    return json(
      { error: data?.error?.message || "AI 응답에 실패했어요.", detail: data },
      res.status
    );
  }
  return json(data);
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  try {
    const body = await req.json();
    const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
    return provider === "anthropic"
      ? await callAnthropic(body)
      : await callGemini(body);
  } catch (err) {
    return json({ error: err.message || "서버리스 함수 오류" }, 500);
  }
}
