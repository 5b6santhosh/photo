'use strict';

// ─────────────────────────────────────────────
//  gimbi.service.js  (CommonJS — your project style)
//  v3.1.0 — streak, validation, full replies
// ─────────────────────────────────────────────

const EXPR = {
  idle: 'idle',
  excited: 'excited',
  analyzing: 'analyzing',
  curious: 'curious',
  proud: 'proud',
  concerned: 'concerned',
};

// ── In-memory store ──────────────────────────
const store = new Map();

function getUser(id) {
  if (!store.has(id)) {
    store.set(id, {
      id,
      shots: [],
      totalShots: 0,
      streak: 0,
      lastShotDate: null,   // NEW — required for streak
      history: [],
      joinedAt: Date.now(),
    });
  }
  return store.get(id);
}

// ── Clamp scores 0–100 ───────────────────────
function clampScore(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ── Streak update ────────────────────────────
function updateStreak(user) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const last = user.lastShotDate;

  if (last === today) return user;                // already shot today
  if (last === yesterday) user.streak += 1;           // consecutive day
  else user.streak = 1;            // gap — reset

  user.lastShotDate = today;
  return user;
}

// ── Weakest dimension ────────────────────────
function weakest(scores) {
  return Object.entries(scores).sort(([, a], [, b]) => a - b)[0][0];
}

// ── Analysis reply ───────────────────────────
function analysisReply(avg, weak) {
  if (avg >= 80) return { expression: EXPR.excited, message: "Wow, this shot is incredible! You're really growing! 🌟", tip: "Try a brand new perspective next time!" };
  if (avg >= 65) return { expression: EXPR.proud, message: "Great capture! A small tweak and this will be stunning.", tip: `Keep working on your ${weak} — it'll shine.` };
  if (avg >= 45) return { expression: EXPR.curious, message: "Good effort! Let's dig into what we can improve together.", tip: `Your ${weak} is the biggest opportunity right now.` };
  return { expression: EXPR.analyzing, message: "Every master started exactly here — let's build the foundation.", tip: `Start with ${weak}: fixing it will unlock everything.` };
}

// ── Rule-based chat reply ────────────────────
function ruleReply(message, userLevel) {
  const m = message.toLowerCase();
  if (/\b(hi|hello|hey)\b/.test(m)) return { expression: EXPR.excited, message: "Hey there! Ready to capture something amazing? 📸", tip: "Start with a subject you love — passion always shows!" };
  if (/composition/.test(m)) return { expression: EXPR.curious, message: "Great topic! Composition is the foundation of every strong image.", tip: "Try the rule of thirds — place subjects at grid intersections." };
  if (/light/.test(m)) return { expression: EXPR.analyzing, message: "Lighting is absolutely everything in photography.", tip: "Golden hour light is warm, soft and incredibly forgiving." };
  if (/focus|sharp|blur/.test(m)) return { expression: EXPR.analyzing, message: "Sharp focus makes your subject demand attention!", tip: "Half-press shutter to lock focus before the full press." };
  if (/portrait/.test(m)) return { expression: EXPR.excited, message: "Portraits capture personality — that's the real magic!", tip: "f/1.8–2.8 gives beautiful background separation (bokeh)." };
  if (/landscape/.test(m)) return { expression: EXPR.curious, message: "Landscapes reward patience and early mornings!", tip: "f/8–f/11 keeps foreground and background both sharp." };
  if (/colou?r/.test(m)) return { expression: EXPR.proud, message: "Colour tells a powerful emotional story in every frame.", tip: "Complementary colours create striking visual tension." };
  if (/improve|better|grow|tips/.test(m)) return { expression: EXPR.curious, message: "Love the growth mindset — here's where to begin:", tip: userLevel === 'pro' ? "Study the masters and analyse their framing choices." : "Shoot at least one intentional frame every single day." };
  if (/challenge/.test(m)) return { expression: EXPR.excited, message: "Challenges are where growth happens — I love the energy!", tip: "Pick one technique and commit to it for a full week." };
  return { expression: EXPR.idle, message: "Interesting! Tell me more and I'll help you nail it perfectly.", tip: "Every photo tells a story — what story is yours?" };
}

// ── OpenAI reply (optional) ──────────────────
async function openaiReply(message, userLevel) {
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const system = `
You are Gimbi — a tiny, cute, flat-vector robot pet that is a photography companion.
User level: ${userLevel}.
Respond ONLY in valid JSON with NO markdown fences:
{
  "expression": one of [idle, excited, analyzing, curious, proud, concerned],
  "message": string (max 110 chars),
  "tip": string or null (max 90 chars)
}`;

  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: message }],
      max_tokens: 160,
    });
    const raw = r.choices[0].message.content.replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return ruleReply(message, userLevel);
  }
}

// ─────────────────────────────────────────────
//  Exported service functions
// ─────────────────────────────────────────────

exports.getStatus = () => ({
  online: true,
  name: 'Gimbi',
  version: '3.1.0-headset',
  expression: EXPR.idle,
  message: "Hey! I'm Gimbi — let's create something amazing! 📷",
});

exports.chat = async ({ userId, message, userLevel = 'new_user' }) => {
  if (!message?.trim()) throw new Error('message required');

  if (userId) {
    const u = getUser(userId);
    u.history.push({ role: 'user', text: message.slice(0, 1000), ts: Date.now() });
    if (u.history.length > 50) u.history = u.history.slice(-50);
    store.set(userId, u);
  }

  const reply = process.env.OPENAI_API_KEY
    ? await openaiReply(message, userLevel)
    : ruleReply(message, userLevel);

  if (userId) {
    const u = getUser(userId);
    u.history.push({ role: 'gimbi', text: reply.message, ts: Date.now() });
    store.set(userId, u);
  }

  return reply;
};

exports.analyze = ({ userId, composition, lighting, focus, colors }) => {
  // Validate + clamp all scores
  const c = clampScore(composition);
  const l = clampScore(lighting);
  const f = clampScore(focus);
  const k = clampScore(colors);

  const avg = (c + l + f + k) / 4;
  const weak = weakest({ composition: c, lighting: l, focus: f, colors: k });

  const reply = analysisReply(avg, weak);

  let streak = 0;
  if (userId) {
    let u = getUser(userId);
    u = updateStreak(u);                          // ← streak logic added
    u.shots.push({ ts: Date.now(), avg, composition: c, lighting: l, focus: f, colors: k });
    u.totalShots++;
    store.set(userId, u);
    streak = u.streak;
  }

  return {
    ...reply,
    breakdown: { composition: c, lighting: l, focus: f, colors: k },
    streak,
  };
};

exports.getChallenge = () => {
  const challenges = [
    { title: 'Golden hour', desc: 'Shoot in the first or last hour of daylight.', difficulty: 'easy', tip: 'Warm light flatters every subject.' },
    { title: 'Rule of thirds', desc: 'Place your subject at a grid intersection.', difficulty: 'easy', tip: 'Enable the grid in your camera app.' },
    { title: 'Leading lines', desc: 'Use roads, rivers or fences to guide the eye.', difficulty: 'medium', tip: 'Diagonal lines add energy and depth.' },
    { title: 'Reflections', desc: 'Find a reflection and make it the hero.', difficulty: 'medium', tip: 'Puddles work brilliantly on cloudy days.' },
    { title: 'Long exposure', desc: 'Capture silky water or light trails.', difficulty: 'hard', tip: 'Use a tripod and shutter speed ≥ 1/4 s.' },
    { title: 'Silhouette', desc: 'Shoot your subject against a bright background.', difficulty: 'easy', tip: 'Expose for the background, not the subject.' },
    { title: 'Macro world', desc: 'Get extremely close — reveal invisible details.', difficulty: 'medium', tip: 'Even phone macro mode works great here.' },
  ];
  const idx = new Date().getDay() % challenges.length;
  return {
    expression: EXPR.excited,
    message: "Today's challenge is ready for you — let's go! 💪",
    challenge: challenges[idx],
  };
};

exports.getProgress = (userId) => {
  const u = getUser(userId);
  const shots = u.shots;
  const avg = shots.length
    ? Math.round(shots.reduce((a, s) => a + s.avg, 0) / shots.length)
    : 0;

  const level = avg >= 80 ? 'pro' : avg >= 60 ? 'growing' : avg >= 40 ? 'learning' : 'new_user';
  const nextLv = { new_user: 'learning', learning: 'growing', growing: 'pro', pro: 'pro' }[level];

  const recentShots = shots.slice(-4);
  const timeline = recentShots.map((s, i) => ({ week: `W${i + 1}`, score: Math.round(s.avg) }));
  while (timeline.length < 4) timeline.unshift({ week: `W${timeline.length + 1}`, score: 0 });
  timeline.reverse();

  const expression = avg >= 70 ? EXPR.proud : avg >= 45 ? EXPR.idle : EXPR.curious;

  return {
    expression,
    message: avg >= 60
      ? `You've improved so much — keep pushing! 🏆`
      : `Every shot teaches you something new — keep going!`,
    stats: {
      totalShots: u.totalShots,
      avgScore: avg,
      streak: u.streak,
      level,
      nextLevel: nextLv,
      improvement: shots.length >= 2
        ? Math.round(shots[shots.length - 1].avg - shots[0].avg)
        : 0,
    },
    timeline,
  };
};

exports.getNudge = ({ context = 'general' } = {}) => {
  const nudges = {
    general: { expression: EXPR.curious, message: "Hey! The horizon looks slightly tilted — want help?", tip: "Use your camera's grid overlay to straighten." },
    composition: { expression: EXPR.analyzing, message: "Try moving your subject to the left third for stronger impact.", tip: "Rule of thirds creates natural visual flow." },
    lighting: { expression: EXPR.curious, message: "The shadows look a bit harsh here.", tip: "Open shade gives soft, even, flattering light." },
    focus: { expression: EXPR.concerned, message: "Looks like focus missed slightly — let me help!", tip: "Tap your subject on screen before shooting." },
    color: { expression: EXPR.curious, message: "Interesting colour palette — have you tried boosting saturation?", tip: "A light HSL tweak can make colours pop." },
    encourage: { expression: EXPR.excited, message: "You're on a streak! Keep it up — you're growing fast! 🌟", tip: null },
  };
  return nudges[context] ?? nudges.general;
};

exports.clearUser = (userId) => {
  store.delete(userId);
};