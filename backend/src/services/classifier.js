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

I will give you a list of email senders, their subjects, and snippets from the past 12 months.

For each sender analyze the subjects/snippets and classify as:
1. isSubscription (true/false) — a recurring paid service the user signed up for. Standalone bank alerts and one-off transactions are NOT subscriptions.
2. serviceName — clean human readable (e.g. "Netflix" not "billing@mail.netflix.com")
3. category — one of [productivity, finance, shopping, food_delivery, banking, tech, entertainment, news, travel, health, other]
4. isPaid (true/false) — TRUE if there's evidence of a charge: Paystack, Flutterwave, "you were charged", amounts in NGN/USD/$/₦/€/£, "receipt", "invoice", "renewed"
5. billingAmount — the most recent visible amount as a clean string (e.g. "$15.49/mo", "NGN 5000", "₦2,500/month"), or null if no amount visible
6. lastDebitDate — date of the most recent charge/debit/payment email visible, in "YYYY-MM-DD" format, or null
7. nextBillingDate — date of the next scheduled charge if mentioned in any email ("renews on", "next payment", "your subscription will renew"), in "YYYY-MM-DD" format, or null
8. status — "active" ONLY if there's a recent debit (within 45 days) OR a future next-billing date. "inactive" if last charge was over 60 days ago with no future billing date, OR if any email mentions "cancelled", "expired", "subscription ended", "no longer".
9. isBankAlert (true/false) — TRUE if this is a bank's transaction alert (e.g. "Credit Alert", "Debit Alert", "Account Debited", "Transaction Notification") that is NOT a recurring subscription you can unsubscribe from. The bank itself is not a subscription.

Senders:
${senderList}

Respond with ONLY a JSON array (one entry per sender, same order, same index), no markdown:
[
  {
    "index": 1,
    "isSubscription": true,
    "serviceName": "Netflix",
    "category": "entertainment",
    "isPaid": true,
    "billingAmount": "$15.49/mo",
    "lastDebitDate": "2026-04-12",
    "nextBillingDate": "2026-05-12",
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

    // Exclude bank credit/debit alerts entirely — not subscriptions
    if (c?.isBankAlert) return null;

    // Include if Gemini says yes OR has unsubscribe header OR has billing emails
    const include = (c?.isSubscription) || hasUnsub || hasBilling;
    if (!include) return null;

    const { url: unsubscribeUrl, method: unsubscribeMethod, email: unsubscribeEmail } =
      parseUnsubscribeHeader(sender.unsubscribeHeader);

    const isPaid = hasBilling || c?.isPaid || false;

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
      billingAmount: c?.billingAmount || null,
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
