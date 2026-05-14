import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiDelete } from '../api.js';

const CATEGORIES = ['all', 'productivity', 'finance', 'shopping', 'food_delivery', 'tech', 'entertainment', 'banking', 'travel', 'news', 'other'];
const CAT_LABELS = { all: 'All', productivity: 'Productivity', finance: 'Finance', shopping: 'Shopping', food_delivery: 'Food', tech: 'Tech', entertainment: 'Entertainment', banking: 'Banking', travel: 'Travel', news: 'News', other: 'Other' };

export default function Dashboard({ user, setUser }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showAll, setShowAll] = useState(false); // false = active subs only; true = all emails
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  // Load existing subscriptions on mount
  useEffect(() => {
    apiGet('/subscriptions')
      .then(r => r.json())
      .then(d => { setSubscriptions(d.subscriptions || []); setScanned(d.scanned); });
  }, []);

  // Poll job status
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
        // Reload subscriptions
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
    if (filter !== 'all' && s.category !== filter) return false;
    // Default view: only show active subscriptions (hide inactive/expired)
    // "All emails" toggle shows everything including inactive newsletters
    if (!showAll && s.status === 'inactive') return false;
    if (search && !s.serviceName.toLowerCase().includes(search.toLowerCase()) && !s.senderEmail.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const active = filtered.filter(s => s.status !== 'unsubscribed');
  const unsubscribed = filtered.filter(s => s.status === 'unsubscribed');
  const paidCount = subscriptions.filter(s => s.isPaid).length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? 'var(--success)' : 'var(--danger)', color: '#000', padding: '12px 20px', borderRadius: 'var(--radius-sm)', fontWeight: 500, fontSize: 14, zIndex: 100, animation: 'fadeIn 0.2s ease' }}>
          {toast.msg}
        </div>
      )}
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800 }}>Sub<span style={{ color: 'var(--accent)' }}>Zero</span></span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={user.picture} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{user.email}</span>
          <button onClick={logout} style={{ background: 'transparent', color: 'var(--muted)', fontSize: 13, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>Sign out</button>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>

        {/* Stats bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 32 }}>
          {[
            { label: 'Total found', value: subscriptions.length },
            { label: 'Still active', value: active.length },
            { label: 'Paid subs', value: paidCount },
            { label: 'Unsubscribed', value: unsubscribed.length },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 20px' }}>
              <div style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 700, color: s.label === 'Paid subs' && paidCount > 0 ? 'var(--accent)' : 'var(--text)' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Scan button / progress */}
        {!scanned && !scanning && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '48px 24px', textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Ready to scan your inbox?</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 28, fontSize: 14 }}>We'll scan the past 12 months and find every subscription. Takes 1-3 minutes.</p>
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

        {/* Filters */}
        {scanned && subscriptions.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
              <input
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', width: 200, outline: 'none' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
                All emails
              </label>
              <button onClick={startScan} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                Re-scan
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => setFilter(c)} style={{ background: filter === c ? 'var(--accent)' : 'var(--bg2)', color: filter === c ? '#000' : 'var(--muted)', border: `1px solid ${filter === c ? 'var(--accent)' : 'var(--border)'}`, padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: filter === c ? 600 : 400 }}>
                  {CAT_LABELS[c]}
                </button>
              ))}
            </div>

            {/* Subscription cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {active.map(sub => (
                <SubscriptionCard key={sub.id} sub={sub} onUnsubscribe={unsubscribe} onDismiss={dismiss} />
              ))}
            </div>

            {unsubscribed.length > 0 && (
              <>
                <div style={{ marginTop: 40, marginBottom: 16, fontSize: 12, color: 'var(--muted)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Unsubscribed ({unsubscribed.length})</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, opacity: 0.5 }}>
                  {unsubscribed.map(sub => (
                    <SubscriptionCard key={sub.id} sub={sub} onDismiss={dismiss} done />
                  ))}
                </div>
              </>
            )}

            {active.length === 0 && unsubscribed.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>No subscriptions match your filters.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SubscriptionCard({ sub, onUnsubscribe, onDismiss, done }) {
  const CAT_COLORS = { productivity: '#7c6fff', finance: '#00d68f', shopping: '#ff8c42', food_delivery: '#ff4081', tech: '#4fc3f7', entertainment: '#e040fb', banking: '#00bcd4', travel: '#ffca28', news: '#78909c', other: '#546e7a' };
  const color = CAT_COLORS[sub.category] || '#546e7a';

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, transition: 'border-color 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{sub.serviceName}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.senderEmail}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {sub.isPaid && !sub.billingAmount && <span style={{ background: 'rgba(200,255,0,0.12)', color: 'var(--accent)', border: '1px solid rgba(200,255,0,0.2)', fontSize: 10, padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>PAID</span>}
          <span style={{ background: `${color}18`, color, border: `1px solid ${color}30`, fontSize: 10, padding: '2px 8px', borderRadius: 99 }}>{CAT_LABELS2[sub.category] || sub.category}</span>
        </div>
      </div>

      {/* Bold amount display */}
      {sub.billingAmount && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, color: 'var(--accent)', letterSpacing: '-1px' }}>
            {sub.billingAmount}
          </span>
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {sub.latestSubject}
      </div>

      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' }}>
        {sub.lastDebitDate && <span>💳 Last charge: {new Date(sub.lastDebitDate).toLocaleDateString()}</span>}
        {sub.nextBillingDate && <><span>·</span><span style={{ color: 'var(--accent)' }}>↻ Next: {new Date(sub.nextBillingDate).toLocaleDateString()}</span></>}
        {!sub.lastDebitDate && !sub.nextBillingDate && <>
          <span>📧 {sub.emailCount} emails</span>
          <span>·</span>
          <span>{sub.frequency}</span>
        </>}
        {sub.oneClickSupported && <><span>·</span><span style={{ color: 'var(--success)' }}>1-click</span></>}
      </div>

      {!done && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={() => onUnsubscribe(sub)} style={{ flex: 1, background: 'var(--danger)', color: '#fff', padding: '9px 0', borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: 13 }}>
            Unsubscribe
          </button>
          <button onClick={() => onDismiss(sub.id)} style={{ background: 'var(--bg3)', color: 'var(--muted)', padding: '9px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 13 }}>
            Keep
          </button>
        </div>
      )}

      {done && (
        <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>✓ Unsubscribed</div>
      )}
    </div>
  );
}

const CAT_LABELS2 = { productivity: 'Productivity', finance: 'Finance', shopping: 'Shopping', food_delivery: 'Food', tech: 'Tech', entertainment: 'Entertainment', banking: 'Banking', travel: 'Travel', news: 'News', other: 'Other' };
