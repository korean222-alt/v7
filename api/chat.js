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
 * 이 키로 실제로 쓸 수 있다고 확인된 모델. 성공하면 여기에 기억해둔다.
 *
 * 이게 없으면 요청할 때마다 못 쓰는 모델부터 차례로 두드리게 된다.
 * 무료 티어에 없는 모델은 매번 429를 돌려주므로 그게 곧 낭비다.
 */
let working = null;

/** 목록 조회로 알아낸 후보들 (버전 내림차순). */
let discoveredList = [];

/**
 * 정적 후보. 좋은 것부터, 마지막은 오래됐지만 무료 티어에 남아 있는 것들.
 *
 * 무료 티어에 최신 모델이 없는 계정이 많다. 그럴 때 3.x만 늘어놓으면
 * 전부 429가 나서 "한도 초과"처럼 보이는데, 실제로는 1.5로 내려가면 된다.
 */
const STATIC_CHAIN = [
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
];

const modelChain = (forVision) => {
  const pinned = forVision
    ? process.env.GEMINI_VISION_MODEL
    : process.env.GEMINI_TEXT_MODEL;
  return [pinned, working, ...STATIC_CHAIN, ...discoveredList].filter(
    (m, i, a) => m && a.indexOf(m) === i
  );
};

/**
 * 이 키로 쓸 수 있는 모델 목록을 API에 물어본다.
 *
 * 하나만 고르면 안 된다. 제일 높은 버전이 무료 티어에 없으면 거기서
 * 끝나버리고, 정작 되는 구형까지 못 내려간다 (실제로 그 버그가 있었다).
 * 그래서 순위를 매긴 목록 전체를 돌려준다.
 */
const discoverModels = async (key) => {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`
    );
    if (!res.ok) return [];
    const { models = [] } = await res.json();
    const usable = models.filter(
      (m) =>
        (m.supportedGenerationMethods || []).includes("generateContent") &&
        /flash|pro/i.test(m.name) &&
        !/preview|exp|image|tts|live|embedding/i.test(m.name)
    );
    const ver = (name) => {
      const m = name.match(/gemini-(\d+)(?:\.(\d+))?/);
      return m ? Number(m[1]) * 100 + Number(m[2] || 0) : 0;
    };
    usable.sort((a, b) => {
      const d = ver(b.name) - ver(a.name);
      if (d !== 0) return d;
      return /lite/i.test(a.name) - /lite/i.test(b.name);
    });
    discoveredList = usable
      .map((m) => m.name.replace(/^models\//, ""))
      .slice(0, 8);
    return discoveredList;
  } catch {
    return [];
  }
};

/**
 * 429가 "다 썼다"인지 "이 모델을 쓸 권한이 없다"인지 가른다.
 *
 * 무료 티어에 없는 모델을 부르면 사용량이 0이어도 429에 limit: 0이 붙어 온다.
 * 둘을 같은 문구로 안내하면 사장님은 멀쩡한 한도를 다 썼다고 오해한다.
 */
const isQuotaZero = (data) => {
  const blob = JSON.stringify(data?.error ?? {});
  return /"?limit"?:\s*"?0"?/i.test(blob) || /limit:\s*0\b/i.test(blob);
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

  // 503·500·504는 서버 쪽 순간 장애라 잠깐 뒤엔 될 수 있다.
  // 429(한도 초과)는 0.9초 기다린다고 절대 안 풀린다 — 같은 모델을 다시
  // 두드리는 건 남은 분당 한도만 갉아먹는 헛수고다. 그래서 429는 로컬
  // 재시도 없이 바로 다음 모델로 넘긴다. 후보 4개를 전부 2번씩 두드리면
  // 사용자 액션 한 번에 요청 8개가 나가는데, 그게 오히려 분당 15회 한도를
  // 스스로 태우는 원인이었다. 이 수정으로 최악의 경우도 4~5개로 줄어든다.
  const retryableTransient = (s) => s === 500 || s === 503 || s === 504;
  const retryableChain = (s) => s === 429 || retryableTransient(s);

  const tried = [];
  let last = null;

  const attemptModel = async (model) => {
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

    // 순간 장애일 때만 같은 모델로 한 번 더 (429는 여기 안 옴)
    if (retryableTransient(res.status)) {
      await sleep(900);
      ({ res, data } = await callOnce(model, payload.generationConfig));
      if (res.ok) return { ok: true, data, model };
    }

    last = { status: res.status, data, model };
    tried.push(`${model}:${res.status}`);
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

  const attempted = new Set();
  const run = async (model) => {
    if (!model || attempted.has(model)) return null;
    attempted.add(model);
    const r = await attemptModel(model);
    if (r.ok) {
      working = model; // 다음 요청은 여기부터 시작한다
      return finish(r);
    }
    if (working === model) working = null; // 되던 게 안 되면 기억을 지운다
    return null;
  };

  for (const model of modelChain(hasImage(body.messages))) {
    const done = await run(model);
    if (done) return done;
  }

  // 후보가 전부 막혔다. 이 키로 뭘 쓸 수 있는지 직접 물어보고
  // 돌아온 목록을 위에서부터 끝까지 시도한다.
  for (const model of await discoverModels(key)) {
    const done = await run(model);
    if (done) return done;
  }

  const status = last?.status ?? 500;
  // 사장님 화면에 영어 에러가 뜨면 고장난 걸로 오해하니 한국어로 바꾼다.
  // 다만 429는 두 가지 뜻이 섞여 있어서 갈라줘야 한다. 권한이 없어서 나는
  // 429를 "다 썼다"고 알리면, 멀쩡한 한도를 두고 하루를 기다리게 된다.
  const msg =
    status === 429
      ? isQuotaZero(last?.data)
        ? "지금 이 앱에서 쓸 수 있는 AI 모델이 없어요. 관리자에게 알려주세요."
        : "오늘 AI 사용량이 모두 찼어요. 내일 다시 이용해주세요."
      : retryableTransient(status)
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
