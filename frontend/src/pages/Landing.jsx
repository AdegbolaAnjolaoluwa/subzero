import { useEffect, useRef } from 'react';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const FEATURES = [
  { icon: '⚡', title: 'Scans 1 year', desc: 'Finds every newsletter, service, and recurring charge buried in your inbox.' },
  { icon: '🧠', title: 'AI-powered', desc: 'Gemini classifies each sender — paid vs free, category, frequency.' },
  { icon: '🗑️', title: 'One-click kill', desc: 'Unsubscribe directly from the dashboard. No hunting through emails.' },
];

export default function Landing() {
  const noiseRef = useRef(null);

  useEffect(() => {
    const el = noiseRef.current;
    if (!el) return;
    let frame;
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 200;
    const ctx = canvas.getContext('2d');
    function draw() {
      const img = ctx.createImageData(200, 200);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 20;
        img.data[i] = img.data[i+1] = img.data[i+2] = v;
        img.data[i+3] = 30;
      }
      ctx.putImageData(img, 0, 0);
      el.style.backgroundImage = `url(${canvas.toDataURL()})`;
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', overflow: 'hidden', position: 'relative' }}>
      <div ref={noiseRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundSize: '200px' }} />

      {/* Glow orb */}
      <div style={{ position: 'fixed', top: '-20vh', left: '50%', transform: 'translateX(-50%)', width: '60vw', height: '60vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(200,255,0,0.06) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 48px', position: 'relative', zIndex: 1 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' }}>
          Sub<span style={{ color: 'var(--accent)' }}>Zero</span>
        </span>
        <a href={`${API_URL}/auth/google`} style={{ background: 'var(--accent)', color: '#000', padding: '8px 20px', borderRadius: 99, fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-display)' }}>
          Try free →
        </a>
      </nav>

      {/* Hero */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '80px 24px 60px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'inline-block', background: 'var(--accent-dim)', border: '1px solid rgba(200,255,0,0.2)', borderRadius: 99, padding: '5px 14px', fontSize: 12, color: 'var(--accent)', fontWeight: 500, marginBottom: 28, letterSpacing: '0.05em' }}>
          FREE — no credit card
        </div>

        <h1 style={{ fontSize: 'clamp(48px, 8vw, 88px)', fontWeight: 800, lineHeight: 0.95, letterSpacing: '-3px', marginBottom: 28 }}>
          Kill every<br />
          <span style={{ color: 'var(--accent)' }}>dead subscription</span>
        </h1>

        <p style={{ fontSize: 18, color: 'var(--muted)', maxWidth: 480, margin: '0 auto 48px', lineHeight: 1.6, fontWeight: 300 }}>
          Connect your Gmail. We scan the last year, find every subscription and newsletter, and let you unsubscribe in one click.
        </p>

        <a href={`${API_URL}/auth/google`} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: '#fff', color: '#000', padding: '16px 32px', borderRadius: 99, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, transition: 'all 0.2s' }}
          onMouseEnter={e => e.target.style.background = 'var(--accent)'}
          onMouseLeave={e => e.target.style.background = '#fff'}>
          <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Connect Gmail — it's free
        </a>

        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)' }}>Read-only access · We never store your emails · Unsubscribe anytime</p>
      </div>

      {/* Features */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 120px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, position: 'relative', zIndex: 1 }}>
        {FEATURES.map(f => (
          <div key={f.title} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '28px 24px' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{f.title}</div>
            <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
