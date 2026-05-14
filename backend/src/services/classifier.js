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

For each sender below, analyze subjects and snippets to classify:
1. isSubscription (true/false) — a RECURRING paid service (monthly/yearly). One-off purchases, receipts forwarded from payment processors, and bank alerts are NOT subscriptions.
2. serviceName — clean human readable (e.g. "Netflix" not "billing@mail.netflix.com"). If a sender forwards multiple services, use the ACTUAL service name (e.g. for "noreply@paystack.com — Receipt from PiggyVest" use "PiggyVest").
3. category — one of [productivity, finance, shopping, food_delivery, banking, tech, entertainment, news, travel, health, other]
4. isPaid (true/false) — TRUE if there's a confirmed charge.
5. billingAmount — extract the exact amount with currency from any snippet. Examples: "$15.49", "NGN 5,000", "₦2,500", "£9.99". Append "/mo" or "/yr" if you can infer the frequency. Return null ONLY if absolutely no amount is visible anywhere in subjects/snippets.
6. frequency — one of [monthly, yearly, occasional]. "monthly" if charged each month, "yearly" if charged annually, "occasional" for one-time/irregular.
7. lastDebitDate — most recent charge date in "YYYY-MM-DD" or null
8. nextBillingDate — next charge date if mentioned ("renews on", "next billing", "expires") in "YYYY-MM-DD" or null
9. status — "active" if charged within last 45 days OR has a future billing date AND no "cancelled/expired/ended" wording. Otherwise "inactive".
10. isBankAlert (true/false) — TRUE for raw bank transaction notifications (e.g. "Credit Alert from GTB", "Debit notification", "Transaction Alert") — these are NOT subscriptions.

IMPORTANT: be aggressive about finding billingAmount — even partial info like "₦2,500" should be returned. Look in BOTH subjects and snippets.

Senders:
${senderList}

Respond with ONLY a JSON array (one entry per sender, same index), no markdown:
[{"index":1,"isSubscription":true,"serviceName":"Netflix","category":"entertainment","isPaid":true,"billingAmount":"$15.49/mo","frequency":"monthly","lastDebitDate":"2026-04-12","nextBillingDate":"2026-05-12","status":"active","isBankAlert":false}]`;

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

    // Exclude bank credit/debit alerts entirely — not subscriptions
    if (c?.isBankAlert) return null;

    // Include if Gemini says yes OR has unsubscribe header OR has billing emails
    const include = (c?.isSubscription) || hasUnsub || hasBilling;
    if (!include) return null;

    const { url: unsubscribeUrl, method: unsubscribeMethod, email: unsubscribeEmail } =
      parseUnsubscribeHeader(sender.unsubscribeHeader);

    const isPaid = hasBilling || c?.isPaid || false;

    // Fallback: regex-extract amount from snippets/subjects if Gemini didn't find one
    let billingAmount = c?.billingAmount || null;
    if (!billingAmount) {
      const allText = [sender.latestSubject, ...(sender.subjects || []), ...(sender.snippets || [])].join(' ');
      const amountRegex = /(NGN|₦|\$|USD|EUR|€|£|GBP|₹|INR)\s?([\d,]+(?:\.\d{2})?)/i;
      const match = allText.match(amountRegex);
      if (match) {
        billingAmount = `${match[1]}${match[2].includes(',') || match[2].length > 3 ? ' ' : ''}${match[2]}`.trim();
      }
    }

    // Determine status based on real signals: last debit date + next billing date
    let status = c?.status;
    const now = Date.now();
    const daysSince = (dateStr) => dateStr ? (now - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24) : Infinity;

    if (!status) {
      const lastDebit = c?.lastDebitDate;
      const nextBilling = c?.nextBillingDate;

      const recentDebit = lastDebit && daysSince(lastDebit) <= 45;
      const futureBilling = nextBilling && new Date(nextBilling).getTime() > now;

      if (recentDebit || futureBilling) {
        status = 'active';
      } else if (daysSince(sender.latestDate) > 60) {
        status = 'inactive';
      } else {
        status = 'active';
      }
    }

    // Override: if it's a paid sub, require recent debit OR future billing to count as active
    if (isPaid && status === 'active') {
      const lastDebit = c?.lastDebitDate;
      const nextBilling = c?.nextBillingDate;
      const recentDebit = lastDebit && daysSince(lastDebit) <= 45;
      const futureBilling = nextBilling && new Date(nextBilling).getTime() > now;
      // If paid but no recent debit and no future billing → likely cancelled
      if (!recentDebit && !futureBilling && daysSince(sender.latestDate) > 60) {
        status = 'inactive';
      }
    }

    return {
      id: `sub_${sender.domain.replace(/\./g, '_')}_${Date.now()}_${i}`,
      serviceName: c?.serviceName || sender.senderName || sender.domain,
      category: c?.category || 'other',
      isPaid,
      billingAmount,
      lastDebitDate: c?.lastDebitDate || null,
      nextBillingDate: c?.nextBillingDate || null,
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
