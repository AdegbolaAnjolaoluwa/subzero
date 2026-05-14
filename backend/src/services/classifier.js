import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function classifySubscriptions(senders) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Process in batches of 30 to stay within token limits
  const batches = chunk(senders, 30);
  const results = [];

  for (const batch of batches) {
    const classified = await classifyBatch(model, batch);
    results.push(...classified);
  }

  return results;
}

async function classifyBatch(model, senders) {
  const senderList = senders.map((s, i) =>
    `${i + 1}. From: "${s.senderName}" <${s.senderEmail}> | Latest subject: "${s.latestSubject}" | Emails in past year: ${s.emailCount} | Has unsubscribe: ${!!s.unsubscribeHeader}`
  ).join('\n');

  const prompt = `You are an email subscription classifier. Analyze these email senders and classify each one.

For each sender, determine:
1. Is this a subscription/newsletter/marketing email? (true/false) - if it has an unsubscribe header, lean toward true
2. Service name (clean, human-readable name e.g. "Notion" not "ivan@mail.notion.so")
3. Category: one of [productivity, finance, shopping, food_delivery, social, news, tech, entertainment, banking, travel, health, other]
4. Is it likely a paid subscription? (true/false) - look for billing/receipt patterns
5. Frequency: one of [daily, weekly, monthly, occasional]

Senders to classify:
${senderList}

Respond with ONLY a JSON array (one entry per sender), no markdown, no explanation:
[
  {
    "index": 1,
    "isSubscription": true,
    "serviceName": "Notion",
    "category": "productivity",
    "isPaid": false,
    "frequency": "weekly"
  }
]`;

  let classifications = [];
  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const clean = text.replace(/```json|```/g, '').trim();
    classifications = JSON.parse(clean);
    console.log(`[classifier] Gemini classified ${classifications.length} senders, ${classifications.filter(c => c.isSubscription).length} are subscriptions`);
  } catch (err) {
    console.error('Gemini classification error:', err);
    // Fallback: treat all senders with unsubscribe headers as subscriptions
    classifications = senders.map((s, i) => ({
      index: i + 1,
      isSubscription: !!s.unsubscribeHeader,
      serviceName: s.senderName || s.domain,
      category: 'other',
      isPaid: false,
      frequency: 'occasional',
    }));
  }

  // Build subscription objects — include any sender Gemini flagged OR any with unsubscribe header OR any with billing emails
  return senders.map((sender, i) => {
    const c = classifications.find(x => x.index === i + 1);
    const hasUnsub = !!sender.unsubscribeHeader;
    const hasBilling = !!sender.hasBillingEmails;

    // Include if Gemini says yes OR has unsubscribe header OR has billing emails
    const include = (c?.isSubscription) || hasUnsub || hasBilling;
    if (!include) return null;

    const { url: unsubscribeUrl, method: unsubscribeMethod, email: unsubscribeEmail } =
      parseUnsubscribeHeader(sender.unsubscribeHeader);

    // If we saw receipts/invoices, this is definitely paid regardless of Gemini's guess
    const isPaid = hasBilling || c?.isPaid || false;

    return {
      id: `sub_${sender.domain.replace(/\./g, '_')}_${Date.now()}_${i}`,
      serviceName: c?.serviceName || sender.senderName || sender.domain,
      category: c?.category || 'other',
      isPaid,
      frequency: c?.frequency || 'occasional',
      senderEmail: sender.senderEmail,
      senderName: sender.senderName,
      domain: sender.domain,
      emailCount: sender.emailCount,
      billingEmailCount: sender.billingEmailCount || 0,
      hasBillingEmails: hasBilling,
      latestSubject: sender.latestSubject,
      latestDate: sender.latestDate,
      unsubscribeUrl,
      unsubscribeEmail,
      unsubscribeMethod,
      oneClickSupported: sender.oneClickSupported,
      status: 'active',
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
