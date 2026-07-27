// Vercel 서버리스 함수 — /api/chat
//
// 프런트는 Anthropic Messages 형식으로 요청을 보내고 `data.content[0].text`로
// 응답을 읽는다. 그 계약을 유지한 채 여기서만 제공자를 바꾼다.
// 그래서 App.jsx는 한 줄도 안 고쳐도 되고, 나중에 되돌리기도 쉽다.
//
// 환경변수
//   AI_PROVIDER          "gemini"(기본) | "anthropic"
//   GEMINI_API_KEY       Google AI Studio 키
//   GEMINI_TEXT_MODEL    기본 gemini-2.5-flash-lite  (무료 1,000회/일)
//   GEMINI_VISION_MODEL  기본 gemini-2.5-flash       (무료   250회/일)
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

const callGemini = async (body) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return json({ error: "GEMINI_API_KEY 환경 변수가 설정되지 않았습니다." }, 500);
  }

  // 사진 분석만 상위 모델을 쓴다. 텍스트 작업(카톡 추출·액션카드·상담)은
  // flash-lite로 충분한데 무료 한도가 4배라, 이렇게 나눠야 하루가 버틴다.
  const model = hasImage(body.messages)
    ? process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash"
    : process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-lite";

  const payload = {
    contents: toGeminiContents(body.messages),
    generationConfig: {
      maxOutputTokens: body.max_tokens ?? 1000,
      // 2.5 계열은 기본으로 "생각"을 하는데 그 토큰도 maxOutputTokens에서
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

  let res = await fetch(url(model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // thinkingConfig를 아직 안 받는 모델이면 그것만 빼고 한 번 더 시도한다.
  // 이 필드 하나 때문에 앱 전체가 죽는 걸 막는 안전장치다.
  if (res.status === 400) {
    const { thinkingConfig, ...restCfg } = payload.generationConfig;
    res = await fetch(url(model), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, generationConfig: restCfg }),
    });
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    // 429는 무료 한도 소진이다. 사장님 화면에 영어 에러가 뜨면 고장난 걸로
    // 오해하니 한국어로 바꿔서 내려준다.
    const msg =
      res.status === 429
        ? "오늘 AI 사용량이 모두 찼어요. 내일 다시 이용해주세요."
        : data?.error?.message || "AI 응답에 실패했어요.";
    return json({ error: msg, status: res.status, detail: data }, res.status);
  }

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
