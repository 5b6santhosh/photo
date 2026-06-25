'use strict';

const fs = require('fs');
const ChatSession = require('../models/ChatSession');
const { uploadToProvider } = require('./storageService');

// ─────────────────────────────────────────────
//  gimbi.service.js  (CommonJS — your project style)
//  v3.2.0 — Gemini + Groq (free tiers), streak, validation, full replies
//
//  Free tier limits (as of 2025):
//  • Google Gemini (gemini-1.5-flash): 1,500 req/day, 1M tokens/day (free)
//  • Groq (llama-3.1-8b-instant):     14,400 req/day, 500K tokens/day (free)
//
//  Priority: Groq → Gemini → rule-based fallback
//
//  Env vars needed:
//    GROQ_API_KEY      — https://console.groq.com/keys
//    GEMINI_API_KEY_CHAT    — https://aistudio.google.com/app/apikey
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
      lastShotDate: null,
      history: [],
      joinedAt: Date.now(),
      lastChatDate: null,
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

  if (last === today) return user;             // already shot today
  if (last === yesterday) user.streak += 1;    // consecutive day
  else user.streak = 1;                        // gap — reset

  user.lastShotDate = today;
  return user;
}

// ── Weakest dimension ────────────────────────
function weakest(scores) {
  return Object.entries(scores).sort(([, a], [, b]) => a - b)[0][0];
}

// ── Analysis reply ───────────────────────────
function analysisReply(avg, weak) {
  if (avg >= 80) {
    return {
      expression: EXPR.excited,
      message: "Wow, this shot is incredible — seriously impressive work! 🌟\nYour composition, lighting, and focus are all clicking together.\nYou're not just taking photos; you're creating art.\nKeep experimenting — your next shot could be even better!",
      tip: "Try a brand new perspective: shoot from ground level or overhead!"
    };
  }
  if (avg >= 65) {
    return {
      expression: EXPR.proud,
      message: "Great capture! You're clearly developing your eye for photography. 👏\nA small tweak in your weakest area will make this stunning.\nReview what worked here — then apply it to your next shot.\nConsistency is your superpower right now!",
      tip: `Focus on ${weak} this week — master it, and your whole portfolio lifts.`
    };
  }
  if (avg >= 45) {
    return {
      expression: EXPR.curious,
      message: "Good effort — and I see real potential here! Let's level up together. 🔍\nYour ${weak} is the biggest opportunity for quick improvement.\nTry this: review 3 photos you love — what do they do differently?\nSmall, focused practice beats random shooting every time.",
      tip: `Spend 10 minutes today studying ${weak} — watch one tutorial or analyze a pro shot.`
    };
  }
  return {
    expression: EXPR.analyzing,
    message: "Every master started exactly where you are — this is your foundation! 🌱\nLet's build up your ${weak} first; fixing it unlocks everything else.\nDon't compare your chapter 1 to someone else's chapter 20.\nOne intentional shot today > 100 careless ones. You've got this!",
    tip: `Start here: ${weak === 'lighting' ? 'Shoot near a window for soft, even light.' : weak === 'composition' ? 'Enable your camera grid and practice rule of thirds.' : weak === 'focus' ? 'Half-press to lock focus before shooting.' : 'Pick one color theme and stick to it for today.'}`
  };
}

// ── Rule-based chat reply (final fallback) ───
function ruleReply(message, userLevel) {
  const m = message.toLowerCase();

  if (/\b(hi|hello|hey)\b/.test(m)) {
    return {
      expression: EXPR.excited,
      message: "Hey there, photographer! 👋\nReady to capture something amazing today?\nI'm Gimbi, your tiny photo companion.\nLet's make every shot count! 📸✨",
      tip: "Start with a subject you love — passion always shows in your photos!"
    };
  }

  if (/composition|rule of thirds|framing/.test(m)) {
    return {
      expression: EXPR.curious,
      message: "Composition is the backbone of powerful photography! 🎨\nTry placing your subject off-center using the rule of thirds.\nEnable your camera's grid overlay to help align shots.\nSmall tweaks = huge visual impact!",
      tip: "Place key elements at grid intersections for balanced, dynamic frames."
    };
  }

  if (/light|golden hour|sunlight/.test(m)) {
    return {
      expression: EXPR.analyzing,
      message: "Lighting is EVERYTHING in photography — you've asked a great question! 💡\nGolden hour (sunrise/sunset) gives warm, soft, flattering light.\nAvoid harsh midday sun — it creates unflattering shadows.\nWhen in doubt: face your subject toward the light source!",
      tip: "Shoot during golden hour for dreamy, professional-looking results."
    };
  }

  if (/focus|sharp|blur|bokeh/.test(m)) {
    return {
      expression: EXPR.analyzing,
      message: "Sharp focus makes your subject pop and demand attention! 🔍\nHalf-press your shutter to lock focus before the full press.\nFor blurry backgrounds (bokeh), use a wide aperture like f/1.8–f/2.8.\nSteady hands or a tripod help avoid camera shake!",
      tip: "Tap your subject on-screen (phones) or use single-point AF (cameras) for precision."
    };
  }

  if (/portrait|people|face/.test(m)) {
    return {
      expression: EXPR.excited,
      message: "Portraits capture personality — that's where the magic happens! 😊\nGet to eye level with your subject for a natural, engaging look.\nUse a wide aperture (f/1.8–f/2.8) to blur distracting backgrounds.\nMost importantly: make your subject feel comfortable!",
      tip: "Focus on the eyes — they're the window to emotion in portraits."
    };
  }

  if (/landscape|nature|scenery/.test(m)) {
    return {
      expression: EXPR.curious,
      message: "Landscapes reward patience, planning, and early mornings! 🏔️\nUse a narrow aperture (f/8–f/11) to keep foreground AND background sharp.\nInclude a foreground element (rock, flower) to add depth and scale.\nCheck the weather — dramatic clouds can transform an ordinary scene!",
      tip: "Arrive 30 mins before sunrise/sunset to catch the best light and avoid crowds."
    };
  }

  if (/colou?r|saturation|vibrant/.test(m)) {
    return {
      expression: EXPR.proud,
      message: "Color tells an emotional story in every single frame! 🌈\nComplementary colors (blue/orange, purple/yellow) create striking tension.\nShoot in RAW to preserve color data for flexible editing later.\nDon't overdo saturation — subtlety often feels more professional!",
      tip: "Use the HSL panel in editing to tweak individual colors without affecting the whole image."
    };
  }

  if (/improve|better|grow|tips|help/.test(m)) {
    return {
      expression: EXPR.curious,
      message: "Love that growth mindset — here's your quick-start guide! 🌱\n🎯 Shoot ONE intentional photo every day (quality > quantity).\n📚 Study one photo you admire — what makes it work?\n🔄 Review your shots weekly: what improved? what needs work?\n✨ Progress compounds — tiny steps lead to big leaps!",
      tip: userLevel === 'pro'
        ? "Challenge yourself: recreate a master's shot to learn their technique."
        : "Keep a photo journal — note what you tried and what you learned each day."
    };
  }

  if (/challenge|contest|exercise/.test(m)) {
    return {
      expression: EXPR.excited,
      message: "Challenges are where growth happens — I love your energy! 🔥\nPick ONE technique (e.g., leading lines) and practice it all week.\nDon't judge the results — focus on the learning process.\nShare your favorite shot with a friend for fresh perspective!\nRemember: every pro was once a beginner who didn't quit.",
      tip: "Set a mini-challenge: 'Today I only shoot in black & white' to see composition differently."
    };
  }

  // Default fallback — still multi-line & helpful
  return {
    expression: EXPR.idle,
    message: "Interesting question — tell me more and I'll help you nail it! 🤔\nWhat specifically are you trying to capture or improve?\nIs it about lighting, composition, gear, or editing?\nThe more details you share, the better I can help!",
    tip: "Every photo tells a story — what story do YOU want yours to tell?"
  };
}

// ── Shared system prompt ─────────────────────
function systemPrompt(userLevel) {
  return `You are Gimbi — a tiny, cute, flat-vector robot pet that is a photography companion.
User level: ${userLevel}.
Respond ONLY in valid JSON with NO markdown fences:
{
  "expression": one of [idle, excited, analyzing, curious, proud, concerned],
  "message": string (200-400 chars, use \\n for line breaks to create 4+ visual lines),
  "tip": string or null (max 120 chars, actionable & specific)
}
Make message warm, encouraging, and educational. Break into 4 short lines using \\n.`;
}

// ── Parse JSON response from any LLM ─────────
function parseJsonReply(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── Groq reply (llama-3.1-8b-instant — free) ─
async function groqReply(history, message, userLevel) {
  const messages = [
    { role: 'system', content: systemPrompt(userLevel) }
  ];

  if (history && history.length > 0) {
    for (const msg of history) {
      messages.push({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.text
      });
    }
  }

  messages.push({ role: 'user', content: message });

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: messages,
      max_tokens: 160,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return parseJsonReply(data.choices[0].message.content);
}

// ── Gemini reply (gemini-1.5-flash — free) ───
async function geminiReply(contents, userLevel) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY_CHAT}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt(userLevel) }],
      },
      contents: contents,
      generationConfig: {
        maxOutputTokens: 160,
        temperature: 0.7,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini: empty response');
  return parseJsonReply(raw);
}

// ── AI reply with fallback chain ─────────────
//  Priority: Groq → Gemini → rule-based
async function aiReply({ message, userLevel, history, currentImageBase64, currentImageMimeType }) {
  const hasImage = !!(currentImageBase64 && currentImageMimeType);

  if (!hasImage && process.env.GROQ_API_KEY) {
    try {
      return await groqReply(history, message, userLevel);
    } catch (err) {
      console.warn('[Gimbi] Groq failed, trying Gemini:', err.message);
    }
  }

  if (process.env.GEMINI_API_KEY_CHAT) {
    try {
      const contents = [];
      if (history && history.length > 0) {
        for (const msg of history) {
          contents.push({
            role: msg.role === 'model' ? 'model' : 'user',
            parts: [{ text: msg.text }]
          });
        }
      }

      const currentParts = [];
      if (hasImage) {
        currentParts.push({
          inlineData: {
            mimeType: currentImageMimeType,
            data: currentImageBase64
          }
        });
      }
      currentParts.push({ text: message });

      contents.push({
        role: 'user',
        parts: currentParts
      });

      return await geminiReply(contents, userLevel);
    } catch (err) {
      console.warn('[Gimbi] Gemini failed, using rule-based fallback:', err.message);
    }
  }

  return ruleReply(message, userLevel);
}

// ── Check if any AI provider is configured ───
function hasAiProvider() {
  return !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY_CHAT);
}

// ─────────────────────────────────────────────
//  Exported service functions
// ─────────────────────────────────────────────

exports.getStatus = () => ({
  online: true,
  name: 'Gimbi',
  version: '3.2.0',
  expression: EXPR.idle,
  message: "Hey! I'm Gimbi — let's create something amazing! 📷",
});

exports.chat = async ({ userId, message, sessionId, imageFile, userLevel = 'new_user' }) => {
  if (!message?.trim()) throw new Error('message required');

  if (userId) {
    const u = getUser(userId);
    const today = new Date().toDateString();

    if (u.lastChatDate === today) {
      return {
        expression: EXPR.curious,
        message: "Thanks for chatting! 🌟\nGimbi is currently in beta testing.\nTo ensure quality, we're limiting chats to 1 per day.\nWe'll unlock more soon — thanks for your patience! 🤖✨",
        tip: "While you wait, try the /analyze or /challenge features — they're unlimited!"
      };
    }

    u.lastChatDate = today;
    u.history.push({ role: 'user', text: message.slice(0, 1000), ts: Date.now() });
    if (u.history.length > 50) u.history = u.history.slice(-50);
    store.set(userId, u);
  }

  let currentImageBase64 = null;
  let currentImageMimeType = null;
  let uploadedImageUrl = null;

  if (imageFile) {
    try {
      currentImageMimeType = imageFile.mimetype;
      const fileData = await fs.promises.readFile(imageFile.path);
      currentImageBase64 = fileData.toString('base64');

      const uploadResult = await uploadToProvider(imageFile);
      uploadedImageUrl = uploadResult.url;
    } catch (uploadErr) {
      console.error('[Gimbi] Image upload/processing failed:', uploadErr.message);
      if (imageFile.path && fs.existsSync(imageFile.path)) {
        await fs.promises.unlink(imageFile.path).catch(() => {});
      }
    }
  }

  let historyPayload = [];
  if (sessionId) {
    try {
      const session = await ChatSession.findOne({ sessionId });
      if (session && session.messages) {
        historyPayload = session.messages;
      }
    } catch (dbErr) {
      console.error('[Gimbi] Database session lookup failed:', dbErr.message);
    }
  } else if (userId) {
    const u = getUser(userId);
    historyPayload = u.history.map(h => ({
      role: h.role === 'gimbi' ? 'model' : 'user',
      text: h.text
    }));
  }

  const reply = hasAiProvider()
    ? await aiReply({
        message,
        userLevel,
        history: historyPayload,
        currentImageBase64,
        currentImageMimeType
      })
    : ruleReply(message, userLevel);

  if (sessionId) {
    try {
      const newMessages = [
        {
          role: 'user',
          text: message,
          imageUrl: uploadedImageUrl || null,
          createdAt: new Date()
        },
        {
          role: 'model',
          text: reply.message,
          imageUrl: null,
          createdAt: new Date()
        }
      ];

      await ChatSession.findOneAndUpdate(
        { sessionId },
        {
          $setOnInsert: { userId: userId || 'anonymous' },
          $push: { messages: { $each: newMessages } }
        },
        { upsert: true, new: true }
      );
    } catch (saveErr) {
      console.error('[Gimbi] Database save failed:', saveErr.message);
    }
  }

  if (userId) {
    const u = getUser(userId);
    u.history.push({ role: 'gimbi', text: reply.message, ts: Date.now() });
    store.set(userId, u);
  }

  return reply;
};

exports.getSessionHistory = async (sessionId, userId) => {
  if (sessionId) {
    try {
      const session = await ChatSession.findOne({ sessionId });
      if (session) {
        return {
          sessionId: session.sessionId,
          messages: session.messages
        };
      }
    } catch (err) {
      console.error('[Gimbi] Error fetching session history:', err.message);
    }
  }

  if (userId) {
    try {
      const session = await ChatSession.findOne({ userId }).sort({ updatedAt: -1 });
      if (session) {
        return {
          sessionId: session.sessionId,
          messages: session.messages
        };
      }
    } catch (err) {
      console.error('[Gimbi] Error fetching latest session history:', err.message);
    }
  }

  return {
    sessionId: null,
    messages: []
  };
};

exports.analyze = ({ userId, composition, lighting, focus, colors }) => {
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
    u = updateStreak(u);
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