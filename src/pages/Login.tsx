import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/useAuth';
import { AlertCircle, Eye, EyeOff, ArrowLeft, Mail, Lock, Loader2, ShieldCheck, Zap, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';

/* ──────────────────────────────────────────────────────────────
   Particles — tiny floating dots for the left hero panel
   ────────────────────────────────────────────────────────────── */
interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  opacity: number;
}

function useParticles(count: number) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const p: Particle[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: (Math.random() - 0.5) * 0.3,
      opacity: Math.random() * 0.5 + 0.1,
    }));
    setParticles(p);
  }, [count]);

  return particles;
}

/* ──────────────────────────────────────────────────────────────
   Live Clock
   ────────────────────────────────────────────────────────────── */
function useClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return time;
}

/* ──────────────────────────────────────────────────────────────
   Typing Effect
   ────────────────────────────────────────────────────────────── */
function useTypewriter(words: string[], typingSpeed = 100, deletingSpeed = 60, pauseMs = 2000) {
  const [text, setText] = useState('');
  const [wordIndex, setWordIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentWord = words[wordIndex];
    const timeout = setTimeout(() => {
      if (!isDeleting) {
        setText(currentWord.slice(0, text.length + 1));
        if (text.length + 1 === currentWord.length) {
          setTimeout(() => setIsDeleting(true), pauseMs);
        }
      } else {
        setText(currentWord.slice(0, text.length - 1));
        if (text.length === 0) {
          setIsDeleting(false);
          setWordIndex((prev) => (prev + 1) % words.length);
        }
      }
    }, isDeleting ? deletingSpeed : typingSpeed);

    return () => clearTimeout(timeout);
  }, [text, isDeleting, wordIndex, words, typingSpeed, deletingSpeed, pauseMs]);

  return text;
}

/* ──────────────────────────────────────────────────────────────
   Canvas — Animated connected particles
   ────────────────────────────────────────────────────────────── */
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; r: number }[]>([]);
  const animRef = useRef<number>(0);

  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width = w * 2;
    canvas.height = h * 2;

    const count = Math.floor((w * h) / 8000);
    particlesRef.current = Array.from({ length: count }, () => ({
      x: Math.random() * w * 2,
      y: Math.random() * h * 2,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      r: Math.random() * 2 + 0.5,
    }));
  }, []);

  useEffect(() => {
    init();
    window.addEventListener('resize', init);

    const animate = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      const pts = particlesRef.current;
      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99,182,255,0.5)';
        ctx.fill();
      }

      // Draw connections
      const maxDist = 160;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = `rgba(99,182,255,${0.15 * (1 - dist / maxDist)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', init);
    };
  }, [init]);

  return <canvas ref={canvasRef} className="lg-particle-canvas" />;
}

/* ══════════════════════════════════════════════════════════════
   LOGIN COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const { login, resetPassword } = useAuth();
  const navigate = useNavigate();
  const clock = useClock();
  const typedText = useTypewriter([
    'Fast Billing',
    'Smart Inventory',
    'Real-time Analytics',
    'Customer Ledger',
    'Supplier Management',
  ], 90, 50, 1800);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const success = await login(email, password);

    if (success) {
      toast.success('Welcome back!');
      navigate('/pos');
    } else {
      setError('Invalid email or password');
    }

    setIsLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }
    setError('');
    setIsLoading(true);

    const success = await resetPassword(email);

    if (success) {
      setIsForgotPassword(false);
      setPassword('');
    }

    setIsLoading(false);
  };

  const timeStr = clock.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const dateStr = clock.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="lg-page">
      {/* ─────────────────────────────────────
           LEFT HERO PANEL
         ───────────────────────────────────── */}
      <div className={`lg-hero ${mounted ? 'lg-hero--visible' : ''}`}>
        {/* Animated canvas particles */}
        <ParticleCanvas />

        {/* Gradient overlays */}
        <div className="lg-hero-gradient" />

        {/* Animated orbs */}
        <div className="lg-orb lg-orb--1" />
        <div className="lg-orb lg-orb--2" />
        <div className="lg-orb lg-orb--3" />

        {/* Barcode scanner line */}
        <div className="lg-scanline" />

        {/* Content */}
        <div className="lg-hero-content">
          {/* Logo */}
          <div className="lg-hero-logo">
            <div className="lg-hero-logo-inner">
              <svg viewBox="0 0 24 24" fill="none" className="lg-hero-logo-svg">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 10a4 4 0 01-8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="lg-hero-logo-pulse" />
          </div>

          <h1 className="lg-hero-title">
            Super<span className="lg-hero-title-accent">Mart</span>
          </h1>

          <p className="lg-hero-tagline">
            Point of Sale System
          </p>

          {/* Typing animation */}
          <div className="lg-hero-typed">
            <span className="lg-hero-typed-text">{typedText}</span>
            <span className="lg-hero-cursor">|</span>
          </div>

          {/* Feature pills */}
          <div className="lg-hero-features">
            <div className="lg-feature-pill lg-feature-pill--1">
              <Zap className="lg-feature-icon" />
              <span>Lightning Fast</span>
            </div>
            <div className="lg-feature-pill lg-feature-pill--2">
              <ShieldCheck className="lg-feature-icon" />
              <span>Bank-Grade Security</span>
            </div>
            <div className="lg-feature-pill lg-feature-pill--3">
              <BarChart3 className="lg-feature-icon" />
              <span>Smart Reports</span>
            </div>
          </div>

          {/* Clock */}
          <div className="lg-hero-clock">
            <div className="lg-hero-time">{timeStr}</div>
            <div className="lg-hero-date">{dateStr}</div>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────
           RIGHT FORM PANEL
         ───────────────────────────────────── */}
      <div className={`lg-form-panel ${mounted ? 'lg-form-panel--visible' : ''}`}>
        {/* Subtle pattern */}
        <div className="lg-form-pattern" />

        <div className="lg-form-container">
          {/* Mobile-only branding */}
          <div className="lg-mobile-brand">
            <div className="lg-mobile-logo">
              <svg viewBox="0 0 24 24" fill="none" className="lg-mobile-logo-svg">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 10a4 4 0 01-8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="lg-mobile-brand-text">SuperMart</span>
          </div>

          {/* Greeting */}
          <div className="lg-form-header">
            <h2 className="lg-form-title">
              {isForgotPassword ? 'Reset Password' : 'Welcome back'}
            </h2>
            <p className="lg-form-subtitle">
              {isForgotPassword
                ? 'Enter your email and we\'ll send you a reset link'
                : 'Enter your credentials to access the dashboard'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="lg-error">
              <AlertCircle className="lg-error-icon" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Forgot Password ── */}
          {isForgotPassword ? (
            <form onSubmit={handleResetPassword} className="lg-form">
              <div className="lg-field">
                <label className="lg-label" htmlFor="reset-email">Email Address</label>
                <div className={`lg-input-group ${focusedField === 'reset-email' ? 'lg-input-group--focused' : ''}`}>
                  <Mail className="lg-input-pre-icon" />
                  <input
                    id="reset-email"
                    type="email"
                    className="lg-input"
                    placeholder="you@supermart.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusedField('reset-email')}
                    onBlur={() => setFocusedField(null)}
                    required
                  />
                </div>
              </div>

              <button type="submit" className="lg-submit" disabled={isLoading}>
                <span className="lg-submit-bg" />
                <span className="lg-submit-text">
                  {isLoading ? (
                    <>
                      <Loader2 className="lg-spin" />
                      Sending…
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </span>
              </button>

              <button
                type="button"
                className="lg-back"
                onClick={() => { setIsForgotPassword(false); setError(''); }}
              >
                <ArrowLeft className="lg-back-icon" />
                Back to Sign In
              </button>
            </form>
          ) : (
            /* ── Sign In ── */
            <form onSubmit={handleSubmit} className="lg-form">
              {/* Email */}
              <div className="lg-field">
                <label className="lg-label" htmlFor="email">Email</label>
                <div className={`lg-input-group ${focusedField === 'email' ? 'lg-input-group--focused' : ''}`}>
                  <Mail className="lg-input-pre-icon" />
                  <input
                    id="email"
                    type="email"
                    className="lg-input"
                    placeholder="you@supermart.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="lg-field">
                <div className="lg-label-row">
                  <label className="lg-label" htmlFor="password">Password</label>
                  <button
                    type="button"
                    className="lg-forgot-link"
                    onClick={() => { setIsForgotPassword(true); setError(''); }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className={`lg-input-group ${focusedField === 'password' ? 'lg-input-group--focused' : ''}`}>
                  <Lock className="lg-input-pre-icon" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className="lg-input lg-input--has-suffix"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    required
                  />
                  <button
                    type="button"
                    className="lg-eye"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="lg-eye-icon" /> : <Eye className="lg-eye-icon" />}
                  </button>
                </div>
              </div>

              <button type="submit" className="lg-submit" disabled={isLoading}>
                <span className="lg-submit-bg" />
                <span className="lg-submit-text">
                  {isLoading ? (
                    <>
                      <Loader2 className="lg-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign In
                      <svg className="lg-arrow" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </>
                  )}
                </span>
              </button>
            </form>
          )}

          {/* Footer */}
          <div className="lg-footer">
            <div className="lg-footer-line" />
            <span className="lg-footer-text">SuperMart POS v2.0 — Enterprise Edition</span>
          </div>
        </div>
      </div>
    </div>
  );
}
