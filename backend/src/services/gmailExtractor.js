import { google } from 'googleapis';
import { decryptToken } from './encryption.js';

export async function extractGmailSubscriptions(accessToken, refreshToken, tokenExpiry, onProgress) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: decryptToken(accessToken),
    refresh_token: refreshToken ? decryptToken(refreshToken) : null,
    expiry_date: tokenExpiry,
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Strict queries — only paid subscriptions and free trials
  const queries = [
    'subject:(subscription OR "subscription active" OR billing OR renewal OR "trial ends" OR "trial expires" OR "free trial") newer_than:1y',
    'subject:(invoice OR "you have been charged" OR "payment successful" OR "payment received" OR "your receipt") newer_than:1y',
  ];

  const senderMap = new Map(); // domain → sender info
  let totalFetched = 0;

  for (let qi = 0; qi < queries.length; qi++) {
    const query = queries[qi];
    let pageToken = null;
    let pageCount = 0;
    const maxPages = 5; // ~500 emails per query

    do {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken: pageToken || undefined,
        fields: 'messages(id),nextPageToken',
      });

      const messages = response.data.messages || [];
      if (messages.length === 0) break;

      // Fetch headers for each message in parallel (batches of 20)
      const batches = chunk(messages, 20);
      for (const batch of batches) {
        await Promise.all(batch.map(msg => fetchMessageHeaders(gmail, msg.id, senderMap)));
        totalFetched += batch.length;
        onProgress && onProgress(Math.min(70, Math.round((totalFetched / 500) * 70)));
      }

      pageToken = response.data.nextPageToken;
      pageCount++;
    } while (pageToken && pageCount < maxPages);
  }

  return Array.from(senderMap.values());
}

async function fetchMessageHeaders(gmail, messageId, senderMap) {
  try {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date', 'List-Unsubscribe', 'List-Unsubscribe-Post'],
    });

    const headers = msg.data.payload?.headers || [];
    const get = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const from = get('From');
    const subject = get('Subject');
    const date = get('Date');
    const listUnsub = get('List-Unsubscribe');
    const listUnsubPost = get('List-Unsubscribe-Post');

    if (!from) return;

    // Parse sender
    const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
    const senderEmail = emailMatch?.[1]?.toLowerCase() || '';
    const senderName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || senderEmail;
    const domain = senderEmail.split('@')[1] || '';

    if (!domain) return;

    // Detect billing-related emails — strong signal this is a paid subscription
    const subLower = subject.toLowerCase();
    const billingKeywords = ['receipt', 'invoice', 'billing', 'payment', 'renewal', 'subscription', 'charged', 'order confirmation'];
    const hasBilling = billingKeywords.some(k => subLower.includes(k));

    const snippet = msg.data.snippet || '';

    // Use full email as key for payment processor domains so merchants don't get merged
    const PROCESSOR_DOMAINS = new Set(['paystack.com', 'flutterwavego.com', 'flutterwave.com', 'stripe.com', 'paddle.com', 'lemonsqueezy.com']);
    const key = PROCESSOR_DOMAINS.has(domain) ? senderEmail : domain;
    if (!senderMap.has(key)) {
      senderMap.set(key, {
        senderName,
        senderEmail,
        domain,
        emailCount: 0,
        latestSubject: subject,
        latestDate: date,
        unsubscribeHeader: listUnsub || null,
        oneClickSupported: !!listUnsubPost,
        snippet,
        subjects: [],
        snippets: [],
        chargeDates: [],     // all dates where subject suggests an actual charge
        billingEmailCount: 0,
        hasBillingEmails: false,
      });
    }

    const entry = senderMap.get(key);
    entry.emailCount++;

    // Record charge dates — only emails that look like actual debits, not just newsletters
    const isChargeEmail = /receipt|invoice|payment|charged|renewed|renewal|debited|debit alert|paid|billing|subscription (active|renewed|started)|"you have been charged"/i.test(subject + ' ' + snippet);
    if (isChargeEmail && date) {
      entry.chargeDates.push(date);
    }

    // Keep up to 5 distinct subject samples
    if (entry.subjects.length < 5 && subject && !entry.subjects.includes(subject)) {
      entry.subjects.push(subject);
    }

    // Capture snippets — prioritize ones with money/billing info, fallback to recent ones
    const moneyPattern = /(?:NGN|₦|\$|USD|EUR|€|£|GBP|₹|INR)\s?[\d,]+(?:\.\d{2})?|paystack|flutterwave|renew|monthly|yearly|annually/i;
    if (snippet && entry.snippets.length < 4) {
      if (moneyPattern.test(snippet) || entry.snippets.length < 2) {
        entry.snippets.push(snippet.slice(0, 250));
      }
    }

    if (hasBilling) {
      entry.billingEmailCount++;
      entry.hasBillingEmails = true;
    }
    if (new Date(date) > new Date(entry.latestDate)) {
      entry.latestDate = date;
      entry.latestSubject = subject;
    }
    if (!entry.unsubscribeHeader && listUnsub) {
      entry.unsubscribeHeader = listUnsub;
      entry.oneClickSupported = !!listUnsubPost;
    }
  } catch {
    // silently skip individual message errors
  }
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}
