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
  const senderList = senders.map((s, i) => {
    const subjects = (s.subjects && s.subjects.length ? s.subjects : [s.latestSubject]).slice(0, 5);
    const snippets = (s.snippets || []).join(' | ');
    return `${i + 1}. From: "${s.senderName}" <${s.senderEmail}>
   Subjects: ${subjects.map(x => `"${x}"`).join(', ')}
   Emails in past year: ${s.emailCount}
   Billing-related emails: ${s.billingEmailCount || 0}
   Has unsubscribe: ${!!s.unsubscribeHeader}
   Snippet hints: ${snippets || 'none'}`;
  }).join('\n\n');

  const prompt = `You are an email subscription analyst.

I will give you a list of email senders and subjects from the past 12 months.

For each sender analyze:
- Sender name and email address
- Subject lines
- Any snippets mentioning amounts, billing, renewal, subscription

Then classify each one as:
1. Is this a subscription? (true/false) — a recurring service the user signed up for. Newsletters from companies count.
2. Service name (clean human readable, e.g. "Netflix" not "billing@mail.netflix.com")
3. Category: one of [productivity, finance, shopping, food_delivery, banking, tech, entertainment, news, travel, health, other]
4. Is it paid? (true/false) — look for Paystack, Flutterwave, amounts in NGN/USD/$/₦/€/£, words like "receipt", "invoice", "charged", "renewal"
5. Billing amount if visible (string like "$9.99/mo" or "NGN 5000" or null if no amount)
6. Status: "active" if the latest email is within 60 days AND no cancellation/expired wording, otherwise "inactive"
7. isBankAlert: (true/false) — TRUE if this is a bank credit/debit transaction alert (e.g. "Credit Alert", "Debit Alert", "Account Debited", standalone transaction notifications from banks) that is NOT a subscription. Banks themselves are not subscriptions.

Senders:
${senderList}

Respond with ONLY a JSON array (one entry per sender, same order), no markdown:
[
  {
    "index": 1,
    "isSubscription": true,
    "serviceName": "Netflix",
    "category": "entertainment",
    "isPaid": true,
    "billingAmount": "$15.49/mo",
    "status": "active",
    "isBankAlert": false
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
    classifications = senders.map((s, i) => ({
      index: i + 1,
      isSubscription: !!s.unsubscribeHeader || !!s.hasBillingEmails,
      serviceName: s.senderName || s.domain,
      category: 'other',
      isPaid: !!s.hasBillingEmails,
      billingAmount: null,
      status: 'active',
      isBankAlert: false,
    }));
  }

  return senders.map((sender, i) => {
    const c = classifications.find(x => x.index === i + 1);
    const hasUnsub = !!sender.unsubscribeHeader;
    const hasBilling = !!sender.hasBillingEmails;

    // Exclude pure bank credit/debit alerts — these are transactional, not subscriptions
    if (c?.isBankAlert && !hasUnsub) return null;

    // Include if Gemini says yes OR has unsubscribe header OR has billing emails
    const include = (c?.isSubscription) || hasUnsub || hasBilling;
    if (!include) return null;

    const { url: unsubscribeUrl, method: unsubscribeMethod, email: unsubscribeEmail } =
      parseUnsubscribeHeader(sender.unsubscribeHeader);

    const isPaid = hasBilling || c?.isPaid || false;

    // Determine status based on recency if Gemini didn't provide one
    let status = c?.status;
    if (!status) {
      const daysSinceLatest = (Date.now() - new Date(sender.latestDate).getTime()) / (1000 * 60 * 60 * 24);
      status = daysSinceLatest <= 60 ? 'active' : 'inactive';
    }

    return {
      id: `sub_${sender.domain.replace(/\./g, '_')}_${Date.now()}_${i}`,
      serviceName: c?.serviceName || sender.senderName || sender.domain,
      category: c?.category || 'other',
      isPaid,
      billingAmount: c?.billingAmount || null,
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
      status,
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
