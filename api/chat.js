// Vercel 서버리스 함수 — /api/chat
//
// 프런트는 Anthropic Messages 형식으로 요청을 보내고 `data.content[0].text`로
// 응답을 읽는다. 그 계약을 유지한 채 여기서만 제공자를 바꾼다.
// 그래서 App.jsx는 한 줄도 안 고쳐도 되고, 나중에 되돌리기도 쉽다.
//
// 환경변수
//   AI_PROVIDER          "gemini"(기본) | "anthropic"
//   GEMINI_API_KEY       Google AI Studio 키
//   GEMINI_TEXT_MODEL    기본 gemini-3.5-flash  (무료 15 RPM / 1,500회 하루)
//   GEMINI_VISION_MODEL  기본 gemini-3.5-flash
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

  // 3.5 flash는 무료 한도가 하루 1,500회라 텍스트·사진을 나눌 이유가 없다.
  // 그래도 둘을 따로 둔 건, 나중에 사진만 상위 모델로 올리고 싶을 때
  // 환경변수만 바꾸면 되게 하려는 것이다.
  const primary = hasImage(body.messages)
    ? process.env.GEMINI_VISION_MODEL || "gemini-3.5-flash"
    : process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash";

  // 무료 티어에서는 인기 모델이 자주 붐빈다("high demand"). 그때 그냥 죽으면
  // 사장님 입장에선 앱이 고장난 것과 구분이 안 되므로, 같은 모델로 한 번 더
  // 시도해보고 그래도 안 되면 한 급 아래 모델로 내려간다. 카톡에서 이름·
  // 전화번호를 뽑는 정도는 아래 모델로도 충분하다.
  const chain = [primary, "gemini-2.5-flash", "gemini-2.5-flash-lite"].filter(
    (m, i, a) => a.indexOf(m) === i
  );

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

  // 503(과부하) · 429(한도) · 500은 잠시 뒤에 되는 경우가 많다.
  const retryable = (s) => s === 429 || s === 500 || s === 503 || s === 504;

  let last = null;

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let { res, data } = await callOnce(model, payload.generationConfig);

      // thinkingConfig를 안 받는 모델이면(세대마다 필드 이름이 다르다) 그것만
      // 빼고 다시 부른다. 이 필드 하나로 앱 전체가 죽는 걸 막는 장치다.
      // 다만 그냥 빼면 생각하는 데 토큰을 쓰고 본문이 빈 채로 올 수 있어서,
      // 이때는 출력 예산을 넉넉히 준다.
      if (res.status === 400) {
        const { thinkingConfig, ...restCfg } = payload.generationConfig;
        ({ res, data } = await callOnce(model, {
          ...restCfg,
          maxOutputTokens: Math.min((body.max_tokens ?? 1000) * 4, 8000),
        }));
      }

      if (res.ok) {
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
      }

      last = { status: res.status, data, model };
      if (!retryable(res.status)) break; // 키 오류 같은 건 다시 해도 똑같다
      if (attempt === 0) await sleep(900);
    }
  }

  // 여기까지 왔으면 체인의 모든 모델이 실패했다.
  // 사장님 화면에 영어 에러가 뜨면 고장난 걸로 오해하니 한국어로 바꾼다.
  const status = last?.status ?? 500;
  const msg =
    status === 429
      ? "오늘 AI 사용량이 모두 찼어요. 내일 다시 이용해주세요."
      : retryable(status)
        ? "AI 서버가 지금 붐벼요. 잠시 뒤에 다시 눌러주세요."
        : last?.data?.error?.message || "AI 응답에 실패했어요.";

  return json({ error: msg, status, triedModels: chain, detail: last?.data }, status);
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
