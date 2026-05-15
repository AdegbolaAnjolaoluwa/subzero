import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Payment processors and banks — never subscriptions, always receipts for other merchants
// Banks only — payment processors are handled by per-email grouping in extractor
const BLOCKED_DOMAINS = new Set([
  'gtbank.com', 'guarantytrustbank.com', 'accessbank.com', 'zenithbank.com',
  'ubagroup.com', 'firstbank.com', 'fcmb.com', 'sterlingbank.com',
  'alat.ng', 'wemabank.com', 'opay.com', 'kudabank.com', 'kuda.com',
  'moniepoint.com', 'palmpay.com', 'chipper.com', 'chipper.cash',
]);

export async function classifySubscriptions(senders) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const eligible = senders.filter(s => !BLOCKED_DOMAINS.has(s.domain));
  console.log(`[classifier] Skipping ${senders.length - eligible.length} blocked domains`);

  const batches = chunk(eligible, 30);
  const results = [];

  for (const batch of batches) {
    const classified = await classifyBatch(model, batch);
    results.push(...classified);
  }

  return results;
}


async function classifyBatch(model, senders) {
  const senderList = senders.map((s, i) => {
    const subjects = (s.subjects && s.subjects.length ? s.subjects : [s.latestSubject]).slice(0, 5);
    const snippets = (s.snippets || []).join(' | ');
    return `${i + 1}. From: "${s.senderName}" <${s.senderEmail}>
   Subjects: ${subjects.map(x => `"${x}"`).join(', ')}
   Snippets: ${snippets || 'none'}
   Latest date: ${s.latestDate}`;
  }).join('\n\n');

  const prompt = `You have email senders from a user's inbox. Analyze each and classify STRICTLY.

CRITICAL RULE: Be conservative. When in doubt, set isSubscription:false. It is FAR worse to falsely include a non-subscription than to miss one.

ONLY INCLUDE if you see PROOF of one of these:
A. Recurring paid subscription — there must be CLEAR evidence of recurring monthly OR yearly billing. Evidence = multiple charges across different months from same sender, OR explicit "your monthly subscription was renewed", OR an explicit "renews on [date]" message, OR "you have been charged $X for your [monthly/yearly] plan".
B. Active free trial — evidence = explicit "your free trial ends on [date]" or "trial expires in X days"

Reject everything else. Specifically reject:
- Single payment receipts (one-off purchases)
- Receipts forwarded from payment processors for purchases that aren't subscriptions
- Bank credit/debit alerts
- Newsletters, marketing, promo
- Free services with no payment
- Travel, hotel, food delivery receipts

STRICTLY EXCLUDE (mark isSubscription:false):
- Bank debit/credit alerts (GTB, Access, Zenith, UBA, ALAT, Wema, Opay, Kuda, Moniepoint, Sterling, FCMB, etc.)
- Payment processor transaction receipts (Paystack, Flutterwave, Stripe receipts forwarded for other purchases)
- Newsletters, marketing, promotional emails
- Free services with no payment or trial
- One-time purchases (orders, single charges)
- Flight, hotel, travel receipts
- Food delivery receipts (Uber Eats, Jumia Food, Chowdeck, etc.)
- Receipts that are NOT for a recurring service

For each sender return:
- isSubscription (true/false) — TRUE only if recurring paid OR active free trial
- serviceName (clean, human readable e.g. "Netflix", "ChatGPT Plus", "Notion", "Spotify")
- type — "paid" or "trial"
- billingAmount — string like "$15.49", "NGN 5000", "£9.99" — extract from subjects/snippets, null if not found
- frequency — "monthly" or "yearly" (only these two for paid subs; ignore one-time)
- trialExpiryDate — for trials only, in "YYYY-MM-DD" format, or null
- daysRemaining — for trials only, days until expiry (integer), or null
- lastChargeDate — most recent charge date "YYYY-MM-DD" or null
- nextBillingDate — next charge date "YYYY-MM-DD" or null
- status — "active" if recent charge OR future billing OR active trial; "inactive" otherwise
- category — one of [productivity, design, ai, entertainment, gaming, health, education, other]

Senders:
${senderList}

Respond ONLY with a JSON array (one entry per sender, same index), no markdown:
[{"index":1,"isSubscription":true,"serviceName":"Netflix","type":"paid","billingAmount":"$15.49","frequency":"monthly","trialExpiryDate":null,"daysRemaining":null,"lastChargeDate":"2026-04-12","nextBillingDate":"2026-05-12","status":"active","category":"entertainment"}]`;

  let classifications = [];
  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const clean = text.replace(/```json|```/g, '').trim();
    classifications = JSON.parse(clean);
    console.log(`[classifier] Gemini: ${classifications.length} senders, ${classifications.filter(c => c.isSubscription).length} included`);
  } catch (err) {
    console.error('Gemini classification error:', err);
    return [];
  }

  return senders.map((sender, i) => {
    const c = classifications.find(x => x.index === i + 1);
    if (!c || !c.isSubscription) return null;

    // STRICT FILTER: only include if it's a real recurring sub or active trial
    if (c.type === 'paid') {
      if (c.frequency !== 'monthly' && c.frequency !== 'yearly') return null;
      if (c.status !== 'active') return null;

      // For monthly: require 3+ consecutive months of actual charges
      if (c.frequency === 'monthly') {
        const months = distinctChargeMonths(sender.chargeDates || []);
        if (!hasNConsecutiveMonths(months, 2)) return null;
      }
      // For yearly: require at least 1 actual charge in past 12 months
      if (c.frequency === 'yearly') {
        if (!sender.chargeDates || sender.chargeDates.length < 1) return null;
      }
    } else if (c.type === 'trial') {
      if (!c.trialExpiryDate && c.daysRemaining == null) return null;
    } else {
      return null;
    }

    // Regex amount fallback if Gemini missed it
    let billingAmount = c.billingAmount;
    if (!billingAmount) {
      const allText = [sender.latestSubject, ...(sender.subjects || []), ...(sender.snippets || [])].join(' ');
      const match = allText.match(/(NGN|₦|\$|USD|EUR|€|£|GBP|₹|INR)\s?([\d,]+(?:\.\d{2})?)/i);
      if (match) billingAmount = `${match[1]} ${match[2]}`.replace(/\s+/g, ' ').trim();
    }

    const { url: unsubscribeUrl, method: unsubscribeMethod, email: unsubscribeEmail } =
      parseUnsubscribeHeader(sender.unsubscribeHeader);

    // Calc days remaining for trials if Gemini didn't provide
    let daysRemaining = c.daysRemaining;
    if (c.type === 'trial' && !daysRemaining && c.trialExpiryDate) {
      const diff = (new Date(c.trialExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      daysRemaining = Math.max(0, Math.ceil(diff));
    }

    // Skip expired trials
    if (c.type === 'trial' && daysRemaining !== null && daysRemaining <= 0) return null;

    return {
      id: `sub_${sender.domain.replace(/\./g, '_')}_${Date.now()}_${i}`,
      serviceName: c.serviceName || sender.senderName,
      category: c.category || 'other',
      type: c.type || 'paid',
      isPaid: c.type === 'paid',
      isTrial: c.type === 'trial',
      billingAmount,
      frequency: c.frequency || 'monthly',
      trialExpiryDate: c.trialExpiryDate || null,
      daysRemaining: daysRemaining ?? null,
      lastChargeDate: c.lastChargeDate || null,
      nextBillingDate: c.nextBillingDate || null,
      senderEmail: sender.senderEmail,
      senderName: sender.senderName,
      domain: sender.domain,
      latestSubject: sender.latestSubject,
      latestDate: sender.latestDate,
      unsubscribeUrl,
      unsubscribeEmail,
      unsubscribeMethod,
      oneClickSupported: sender.oneClickSupported,
      status: c.status || 'active',
    };
  }).filter(Boolean);
}

function parseUnsubscribeHeader(header) {
  if (!header) return { url: null, method: 'manual', email: null };
  const urlMatch = header.match(/<(https?:\/\/[^>]+)>/);
  const emailMatch = header.match(/<mailto:([^>]+)>/);
  if (urlMatch) return { url: urlMatch[1], method: 'link', email: null };
  if (emailMatch) return { url: null, method: 'mailto', email: emailMatch[1] };
  return { url: null, method: 'manual', email: null };
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// Return sorted array of distinct months (as YYYY-MM strings) that contain at least one charge
function distinctChargeMonths(dates) {
  const set = new Set();
  for (const d of dates) {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) continue;
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    set.add(key);
  }
  return [...set].sort();
}

// True if the months array contains N consecutive calendar months (e.g. 2025-03, 2025-04, 2025-05)
function hasNConsecutiveMonths(months, n) {
  if (months.length < n) return false;
  const toIndex = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return y * 12 + (mo - 1);
  };
  const indices = months.map(toIndex);
  let run = 1;
  for (let i = 1; i < indices.length; i++) {
    run = (indices[i] === indices[i - 1] + 1) ? run + 1 : 1;
    if (run >= n) return true;
  }
  return false;
}
