import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sprout, ShoppingBag, ArrowRight, Leaf } from 'lucide-react';
import { send } from '../api';
import { useAuth, useAction, values } from '../context';
import { Button, Field } from '../components/ui';
import type { FormEvent } from 'react';

export function AuthPage({ kind }: { kind: string }) {
  const { update } = useAuth(),
    navigate = useNavigate(),
    action = useAction(),
    [message, setMessage] = useState(''),
    [role, setRole] = useState('Buyer');
  const [token] = useState(
    () =>
      new URLSearchParams(window.location.hash.slice(1)).get('token') ??
      new URLSearchParams(window.location.search).get('token') ??
      '',
  );
  useEffect(() => {
    if (window.location.hash || window.location.search)
      window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const titles: Record<string, string> = {
    login: 'Welcome back.',
    register: 'A fresher way to connect.',
    'forgot-password': 'Let’s get you back in.',
    'resend-verification': 'Verify your email.',
    'reset-password': 'Choose a new passphrase.',
    'verify-email': 'One last step.',
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const b = values(e);
    action.run(async () => {
      if (kind === 'register' && b.password !== b.confirm)
        throw new Error('Passwords do not match.');
      delete b.confirm;
      if (kind === 'register') b.role = role;
      if (kind === 'verify-email' || kind === 'reset-password') b.token = token;
      const result = await send(`/auth/${kind}`, b);
      if (kind === 'login') {
        update(result);
        navigate('/');
      } else setMessage(result.message);
    });
  };
  return (
    <section className="auth-grid">
      <div className="auth-story">
        <Sprout size={42} />
        <p className="eyebrow">ROOTED IN COMMUNITY</p>
        <h1>
          Better markets.
          <br />
          <em>Shared growth.</em>
        </h1>
        <p>Good food begins with a connection. Find yours here.</p>
        <div className="auth-story-bottom">
          <Leaf size={18} />
          From Kenyan farms, with care.
        </div>
      </div>
      <div className="auth-form">
        <p className="eyebrow">AGRIMARKET</p>
        <h2>{titles[kind]}</h2>
        <p className="subtle">
          {kind === 'login'
            ? 'Sign in to your marketplace.'
            : kind === 'register'
              ? 'Create your buyer or farmer account.'
              : 'Follow the steps below to continue.'}
        </p>
        {message ? (
          <div className="success" role="status">
            {message}
            <p>
              <Link to="/login">Back to sign in</Link>
            </p>
          </div>
        ) : (
          <form onSubmit={submit}>
            {kind === 'register' && (
              <>
                <div className="role-picker">
                  {['Buyer', 'Farmer'].map((r) => (
                    <button
                      type="button"
                      key={r}
                      className={role === r ? 'selected' : ''}
                      onClick={() => setRole(r)}
                    >
                      {r === 'Buyer' ? <ShoppingBag size={18} /> : <Sprout size={18} />}I’m a{' '}
                      {r.toLowerCase()}
                    </button>
                  ))}
                </div>
                <Field label="Full name" name="full_name" autoComplete="name" maxLength={100} />
              </>
            )}
            {!['reset-password', 'verify-email'].includes(kind) && (
              <Field
                label="Email address"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={150}
              />
            )}{' '}
            {['login', 'register', 'reset-password'].includes(kind) && (
              <Field
                label="Password"
                name="password"
                type="password"
                autoComplete={kind === 'login' ? 'current-password' : 'new-password'}
                minLength={kind === 'login' ? 1 : 15}
                hint={
                  kind !== 'login'
                    ? 'Use a passphrase of at least 15 characters, up to 72 bytes.'
                    : undefined
                }
              />
            )}{' '}
            {kind === 'register' && (
              <>
                <Field
                  label="Confirm password"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                />
                <Field
                  label="Phone number"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  maxLength={20}
                />
                <Field
                  label="National ID"
                  name="national_id"
                  pattern="[0-9]{6,10}"
                  inputMode="numeric"
                  maxLength={10}
                />
                <Field
                  label="Location"
                  name="location"
                  autoComplete="address-level2"
                  minLength={2}
                  maxLength={150}
                />
                {role === 'Farmer' && (
                  <Field label="Farm or business name" name="business_name" maxLength={150} />
                )}
              </>
            )}
            {['verify-email', 'reset-password'].includes(kind) && !token ? (
              <div className="error">This link has no token. Request a new email.</div>
            ) : (
              <Button busy={action.busy} className="full">
                {kind === 'login'
                  ? 'Sign in'
                  : kind === 'register'
                    ? 'Create account'
                    : kind === 'verify-email'
                      ? 'Verify email'
                      : kind === 'reset-password'
                        ? 'Update password'
                        : 'Send email'}
                <ArrowRight size={17} />
              </Button>
            )}
          </form>
        )}
        <div className="auth-links">
          {kind === 'login' ? (
            <>
              <Link to="/forgot-password">Forgot password?</Link>
              <Link to="/resend-verification">Resend verification</Link>
              <p>
                New here? <Link to="/register">Create an account</Link>
              </p>
            </>
          ) : (
            <Link to="/login">Already have an account? Sign in</Link>
          )}
        </div>
      </div>
    </section>
  );
}
