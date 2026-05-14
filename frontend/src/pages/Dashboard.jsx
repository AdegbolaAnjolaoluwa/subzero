import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiDelete } from '../api.js';

const CATEGORIES = ['all', 'productivity', 'design', 'ai', 'entertainment', 'gaming', 'health', 'education', 'other'];
const CAT_LABELS = { all: 'All', productivity: 'Productivity', design: 'Design', ai: 'AI', entertainment: 'Entertainment', gaming: 'Gaming', health: 'Health', education: 'Education', other: 'Other' };

export default function Dashboard({ user, setUser }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    apiGet('/subscriptions')
      .then(r => r.json())
      .then(d => { setSubscriptions(d.subscriptions || []); setScanned(d.scanned); });
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      const r = await apiGet(`/scan/status/${jobId}`);
      const data = await r.json();
      setScanProgress(data.progress || 0);

      if (data.status === 'completed') {
        clearInterval(interval);
        setScanning(false);
        setJobId(null);
        const res = await apiGet('/subscriptions');
        const d = await res.json();
        setSubscriptions(d.subscriptions || []);
        setScanned(true);
        showToast('Scan complete!', 'success');
      } else if (data.status === 'failed') {
        clearInterval(interval);
        setScanning(false);
        setJobId(null);
        showToast('Scan failed. Please try again.', 'error');
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobId]);

  const startScan = async () => {
    setScanning(true);
    setScanProgress(0);
    const r = await apiPost('/scan/start', {});
    const data = await r.json();
    setJobId(data.jobId);
  };

  const unsubscribe = async (sub) => {
    const r = await apiPost(`/subscriptions/${sub.id}/unsubscribe`, {});
    const data = await r.json();

    setSubscriptions(prev => prev.map(s => s.id === sub.id ? { ...s, status: 'unsubscribed' } : s));

    if (data.method === 'link' && data.url) {
      window.open(data.url, '_blank');
      showToast(`Opening unsubscribe page for ${sub.serviceName}`, 'success');
    } else if (data.method === 'mailto' && data.email) {
      window.location.href = `mailto:${data.email}?subject=Unsubscribe`;
      showToast(`Opening email to unsubscribe from ${sub.serviceName}`, 'success');
    } else {
      showToast(`Marked ${sub.serviceName} as unsubscribed`, 'success');
    }
  };

  const dismiss = async (id) => {
    await apiDelete(`/subscriptions/${id}`);
    setSubscriptions(prev => prev.filter(s => s.id !== id));
  };

  const logout = async () => {
    await apiPost('/auth/logout', {});
    setUser(null);
  };

  const showToast = (msg, type) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const filtered = subscriptions.filter(s => {
    if (s.status === 'unsubscribed') return false;
    if (filter !== 'all' && s.category !== filter) return false;
    if (search && !s.serviceName.toLowerCase().includes(search.toLowerCase()) && !s.senderEmail.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Two sections: paid subs and expiring trials (sorted by soonest)
  const paidSubs = filtered.filter(s => s.isPaid);
  const trials = filtered.filter(s => s.isTrial).sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999));
  const unsubscribed = subscriptions.filter(s => s.status === 'unsubscribed');

  // Calculate monthly spend total (rough estimate by currency)
  const monthlySpend = (() => {
    const byCurrency = {};
    paidSubs.forEach(s => {
      if (!s.billingAmount) return;
      const m = s.billingAmount.match(/(NGN|₦|\$|USD|EUR|€|£|GBP)\s?([\d,]+(?:\.\d{2})?)/i);
      if (!m) return;
      let symbol = m[1].toUpperCase();
      if (symbol === 'USD') symbol = '$';
      if (symbol === 'NGN') symbol = '₦';
      if (symbol === 'EUR') symbol = '€';
      if (symbol === 'GBP') symbol = '£';
      const amount = parseFloat(m[2].replace(/,/g, ''));
      if (isNaN(amount)) return;
      const monthly = s.frequency === 'yearly' ? amount / 12 : amount;
      byCurrency[symbol] = (byCurrency[symbol] || 0) + monthly;
    });
    return byCurrency;
  })();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? 'var(--success)' : 'var(--danger)', color: '#000', padding: '12px 20px', borderRadius: 'var(--radius-sm)', fontWeight: 500, fontSize: 14, zIndex: 100, animation: 'fadeIn 0.2s ease' }}>
          {toast.msg}
        </div>
      )}
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } } @keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.6 } }`}</style>

      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800 }}>Sub<span style={{ color: 'var(--accent)' }}>Zero</span></span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={user.picture} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{user.email}</span>
          <button onClick={logout} style={{ background: 'transparent', color: 'var(--muted)', fontSize: 13, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>Sign out</button>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>

        {/* Scan prompt */}
        {!scanned && !scanning && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '48px 24px', textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Ready to scan your inbox?</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 28, fontSize: 14 }}>We'll find paid subscriptions and expiring trials from the past 12 months.</p>
            <button onClick={startScan} style={{ background: 'var(--accent)', color: '#000', padding: '14px 36px', borderRadius: 99, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>
              Start scanning →
            </button>
          </div>
        )}

        {scanning && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '48px 24px', textAlign: 'center', marginBottom: 32 }}>
            <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' }} />
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              {scanProgress < 30 ? 'Fetching emails...' : scanProgress < 75 ? 'Reading senders...' : scanProgress < 95 ? 'Classifying with AI...' : 'Almost done...'}
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>This takes 1–3 minutes</p>
            <div style={{ background: 'var(--bg3)', borderRadius: 99, height: 6, maxWidth: 320, margin: '0 auto' }}>
              <div style={{ background: 'var(--accent)', height: 6, borderRadius: 99, width: `${scanProgress}%`, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>{scanProgress}%</div>
          </div>
        )}

        {/* Hero spend summary + filters */}
        {scanned && subscriptions.length > 0 && (
          <>
            {/* Spend hero */}
            {paidSubs.length > 0 && (
              <div style={{ background: 'linear-gradient(135deg, var(--bg2) 0%, rgba(200,255,0,0.04) 100%)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '32px', marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontWeight: 500 }}>Monthly Spend</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                    {Object.keys(monthlySpend).length === 0 ? (
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 38, color: 'var(--muted)', letterSpacing: '-1.5px' }}>—</span>
                    ) : (
                      Object.entries(monthlySpend).map(([sym, amt]) => (
                        <span key={sym} style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 42, color: 'var(--accent)', letterSpacing: '-2px', lineHeight: 1 }}>
                          {sym}{amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 32 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, color: 'var(--text)' }}>{paidSubs.length}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Active subs</div>
                  </div>
                  {trials.length > 0 && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, color: '#ffca28' }}>{trials.length}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Trials</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
              <input
                placeholder="Search subscriptions..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', width: 240, outline: 'none' }}
              />
              <button onClick={startScan} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '9px 16px', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer' }}>
                ↻ Re-scan
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 36 }}>
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => setFilter(c)} style={{ background: filter === c ? 'var(--accent)' : 'transparent', color: filter === c ? '#000' : 'var(--muted)', border: `1px solid ${filter === c ? 'var(--accent)' : 'var(--border)'}`, padding: '6px 14px', borderRadius: 99, fontSize: 12, fontWeight: filter === c ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {CAT_LABELS[c]}
                </button>
              ))}
            </div>

            {/* SECTION 1: Paid Subscriptions */}
            {paidSubs.length > 0 && (
              <section style={{ marginBottom: 48 }}>
                <SectionHeader title="Paid Subscriptions" count={paidSubs.length} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                  {paidSubs.map(sub => (
                    <SubCard key={sub.id} sub={sub} onUnsubscribe={unsubscribe} onDismiss={dismiss} />
                  ))}
                </div>
              </section>
            )}

            {/* SECTION 2: Free Trials Expiring */}
            {trials.length > 0 && (
              <section style={{ marginBottom: 48 }}>
                <SectionHeader title="Free Trials Expiring" count={trials.length} accent="#ff8c42" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                  {trials.map(sub => (
                    <TrialCard key={sub.id} sub={sub} onUnsubscribe={unsubscribe} onDismiss={dismiss} />
                  ))}
                </div>
              </section>
            )}

            {/* Unsubscribed history */}
            {unsubscribed.length > 0 && (
              <section style={{ marginBottom: 48 }}>
                <SectionHeader title="Unsubscribed" count={unsubscribed.length} muted />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, opacity: 0.55 }}>
                  {unsubscribed.map(sub => (
                    <SubCard key={sub.id} sub={sub} onDismiss={dismiss} done />
                  ))}
                </div>
              </section>
            )}

            {paidSubs.length === 0 && trials.length === 0 && (
              <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
                <div style={{ fontSize: 16, fontFamily: 'var(--font-display)', fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>No paid subscriptions or trials found</div>
                <div style={{ fontSize: 13 }}>You're all clear — nothing draining your wallet right now.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, count, accent, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: muted ? 'var(--muted)' : 'var(--text)', letterSpacing: '-0.5px' }}>
        {title}
      </h2>
      <span style={{ fontSize: 13, color: accent || 'var(--muted)', fontWeight: 600 }}>{count}</span>
    </div>
  );
}

const CAT_COLORS = { productivity: '#7c6fff', design: '#ff8c42', ai: '#c8ff00', entertainment: '#e040fb', gaming: '#4fc3f7', health: '#00d68f', education: '#ffca28', other: '#546e7a' };

function SubCard({ sub, onUnsubscribe, onDismiss, done }) {
  const color = CAT_COLORS[sub.category] || '#546e7a';
  const freqLabel = sub.frequency === 'monthly' ? '/mo' : sub.frequency === 'yearly' ? '/yr' : '';
  const daysToNext = sub.nextBillingDate ? Math.ceil((new Date(sub.nextBillingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const initial = (sub.serviceName || '?').charAt(0).toUpperCase();

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px', display: 'flex', flexDirection: 'column', gap: 18, transition: 'all 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          {/* Service avatar */}
          <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${color}40, ${color}15)`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color, flexShrink: 0 }}>
            {initial}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.serviceName}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.senderEmail}</div>
          </div>
        </div>
        {!done && <span style={{ background: 'rgba(0,214,143,0.12)', color: 'var(--success)', border: '1px solid rgba(0,214,143,0.25)', fontSize: 9, padding: '3px 8px', borderRadius: 99, fontWeight: 700, letterSpacing: '0.06em', flexShrink: 0 }}>ACTIVE</span>}
      </div>

      {/* Amount hero */}
      {sub.billingAmount ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, color: 'var(--accent)', letterSpacing: '-1.8px', lineHeight: 1 }}>
            {sub.billingAmount}
          </span>
          {!sub.billingAmount.match(/\/(mo|yr|month|year)/i) && freqLabel && (
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, color: 'var(--muted)' }}>{freqLabel}</span>
          )}
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--muted)', textTransform: 'capitalize' }}>
          Paid {sub.frequency}
        </div>
      )}

      {/* Next billing — emphasized box */}
      {sub.nextBillingDate && (
        <div style={{ background: 'rgba(200,255,0,0.06)', border: '1px solid rgba(200,255,0,0.15)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Next billing</div>
            <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{new Date(sub.nextBillingDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          </div>
          {daysToNext !== null && daysToNext >= 0 && (
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: daysToNext <= 7 ? '#ff8c42' : 'var(--accent)' }}>
              {daysToNext}d
            </div>
          )}
        </div>
      )}

      {/* Last charge */}
      {sub.lastChargeDate && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
          <span>Last charged</span>
          <span style={{ color: 'var(--text)' }}>{new Date(sub.lastChargeDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
      )}

      {!done && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onUnsubscribe(sub)} style={{ flex: 1, background: 'var(--danger)', color: '#fff', padding: '11px 0', borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Unsubscribe
          </button>
          <button onClick={() => onDismiss(sub.id)} style={{ background: 'var(--bg3)', color: 'var(--muted)', padding: '11px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer' }}>
            Keep
          </button>
        </div>
      )}

      {done && <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>✓ Unsubscribed</div>}
    </div>
  );
}

function TrialCard({ sub, onUnsubscribe, onDismiss }) {
  const color = CAT_COLORS[sub.category] || '#546e7a';
  const days = sub.daysRemaining;
  const urgent = days !== null && days <= 7;

  return (
    <div style={{ background: 'var(--bg2)', border: `1px solid ${urgent ? '#ff8c42' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: '22px', display: 'flex', flexDirection: 'column', gap: 16, transition: 'all 0.15s', position: 'relative' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.serviceName}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.senderEmail}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ background: urgent ? 'rgba(255,140,66,0.18)' : 'rgba(255,202,40,0.15)', color: urgent ? '#ff8c42' : '#ffca28', border: `1px solid ${urgent ? 'rgba(255,140,66,0.35)' : 'rgba(255,202,40,0.3)'}`, fontSize: 9, padding: '2px 8px', borderRadius: 99, fontWeight: 700, letterSpacing: '0.05em', animation: urgent ? 'pulse 2s infinite' : 'none' }}>
            {urgent ? 'EXPIRES SOON' : 'TRIAL'}
          </span>
          <span style={{ background: `${color}18`, color, border: `1px solid ${color}30`, fontSize: 10, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>{CAT_LABELS[sub.category] || sub.category}</span>
        </div>
      </div>

      {days !== null ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, color: urgent ? '#ff8c42' : '#ffca28', letterSpacing: '-1.5px', lineHeight: 1 }}>
            {days}
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--muted)' }}>
            {days === 1 ? 'day left' : 'days left'}
          </span>
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: '#ffca28' }}>Trial active</div>
      )}

      {sub.trialExpiryDate && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
          <span>Expires on</span>
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{new Date(sub.trialExpiryDate).toLocaleDateString()}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onUnsubscribe(sub)} style={{ flex: 1, background: 'var(--danger)', color: '#fff', padding: '11px 0', borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          Cancel trial
        </button>
        <button onClick={() => onDismiss(sub.id)} style={{ background: 'var(--bg3)', color: 'var(--muted)', padding: '11px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer' }}>
          Keep
        </button>
      </div>
    </div>
  );
}
