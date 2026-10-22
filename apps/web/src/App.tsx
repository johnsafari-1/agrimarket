import { useEffect, useState, lazy, Suspense } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Sprout, ShoppingBag, ArrowRight, Menu, X, LogOut } from 'lucide-react';
import { api, send, setCsrf } from './api';
import { AuthContext, NoticeContext, useAuth, useAction } from './context';
import { Button, Feedback, Empty } from './components/ui';
import type { ReactNode } from 'react';
import type { Session } from './api';

import { Marketplace, Product } from './pages/marketplace';
const AuthPage = lazy(() => import('./pages/auth').then((m) => ({ default: m.AuthPage })));
const Cart = lazy(() => import('./pages/orders').then((m) => ({ default: m.Cart })));
const OrderList = lazy(() => import('./pages/orders').then((m) => ({ default: m.OrderList })));
const OrderDetail = lazy(() => import('./pages/orders').then((m) => ({ default: m.OrderDetail })));
const Farm = lazy(() => import('./pages/farm').then((m) => ({ default: m.Farm })));
const Requests = lazy(() => import('./pages/community').then((m) => ({ default: m.Requests })));
const Messages = lazy(() => import('./pages/community').then((m) => ({ default: m.Messages })));
const Admin = lazy(() => import('./pages/admin').then((m) => ({ default: m.Admin })));

function Header() {
  const { user, update } = useAuth(),
    [open, setOpen] = useState(false),
    action = useAction();
  const navigate = useNavigate();
  return (
    <header>
      <div className="nav-wrap">
        <Link className="brand" to="/">
          <span className="brand-icon">
            <Sprout size={25} />
          </span>
          agri<span>market</span>
          <span className="brand-dot">.</span>
        </Link>
        <button
          className="icon-button mobile-menu"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
        <nav className={open ? 'open' : ''} onClick={() => setOpen(false)}>
          <NavLink to="/">Marketplace</NavLink>
          {user && (
            <>
              <NavLink to="/orders">{user.role === 'Farmer' ? 'Deliveries' : 'Orders'}</NavLink>
              {user.role !== 'Admin' && <NavLink to="/requests">Requests</NavLink>}
              <NavLink to="/messages">Messages</NavLink>
              {user.role === 'Farmer' && <NavLink to="/farm">My farm</NavLink>}
              {user.role === 'Admin' && <NavLink to="/admin">Admin</NavLink>}
            </>
          )}
          {user?.role === 'Buyer' && (
            <NavLink to="/cart" className="nav-cart">
              <ShoppingBag size={17} />
              Cart
            </NavLink>
          )}
          {user ? (
            <>
              <span className="nav-name">
                {user.full_name.split(' ')[0]} <small>{user.role}</small>
              </span>
              <Button
                busy={action.busy}
                className="icon-button"
                aria-label="Sign out"
                onClick={() =>
                  action.run(async () => {
                    update(await send('/auth/logout'));
                    navigate('/');
                  })
                }
              >
                <LogOut size={18} />
              </Button>
            </>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link className="button small" to="/register">
                Join the marketplace <ArrowRight size={15} />
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const update = (s: Session) => {
    setCsrf(s.csrf);
    setSession(s);
  };
  const boot = () => {
    setError('');
    api<Session>('/auth/session')
      .then(update)
      .catch(() => setError('Could not connect to AgriMarket. Check that the API is running.'));
  };
  useEffect(boot, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 9000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!session)
    return (
      <main className="container">
        <Feedback error={error} loading={!error} retry={boot} />
      </main>
    );
  return (
    <AuthContext.Provider value={{ user: session.user, update }}>
      <NoticeContext.Provider value={setNotice}>
        <Header />
        {notice && (
          <div className="toast" role="status">
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setNotice('')}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <main className="container" key={session.user?.user_id ?? 'guest'}>
          <Suspense
            fallback={
              <p className="loading" role="status">
                Loading page…
              </p>
            }
          >
            <Routes>
              <Route path="/" element={<Marketplace />} />
              <Route path="/products/:id" element={<Product />} />
              <Route path="/login" element={<AuthPage key="login" kind="login" />} />
              <Route path="/register" element={<AuthPage key="register" kind="register" />} />
              <Route
                path="/forgot-password"
                element={<AuthPage key="forgot-password" kind="forgot-password" />}
              />
              <Route
                path="/resend-verification"
                element={<AuthPage key="resend-verification" kind="resend-verification" />}
              />
              <Route
                path="/reset-password"
                element={<AuthPage key="reset-password" kind="reset-password" />}
              />
              <Route
                path="/verify-email"
                element={<AuthPage key="verify-email" kind="verify-email" />}
              />
              <Route
                path="/cart"
                element={
                  <Protected role="Buyer">
                    <Cart />
                  </Protected>
                }
              />
              <Route
                path="/orders"
                element={
                  <Protected>
                    <OrderList />
                  </Protected>
                }
              />
              <Route
                path="/orders/:id"
                element={
                  <Protected>
                    <OrderDetail />
                  </Protected>
                }
              />
              <Route
                path="/farm"
                element={
                  <Protected role="Farmer">
                    <Farm />
                  </Protected>
                }
              />
              <Route
                path="/requests"
                element={
                  <Protected>
                    <Requests />
                  </Protected>
                }
              />
              <Route
                path="/messages"
                element={
                  <Protected>
                    <Messages />
                  </Protected>
                }
              />
              <Route
                path="/admin"
                element={
                  <Protected role="Admin">
                    <Admin />
                  </Protected>
                }
              />
              <Route
                path="*"
                element={
                  <Empty title="Page not found">
                    <Link to="/">Back to marketplace</Link>
                  </Empty>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <footer>
          <div className="container footer-inner">
            <Link to="/" className="brand">
              <Sprout size={22} />
              agrimarket.
            </Link>
            <p>Good food. Fair markets. Stronger communities.</p>
            <span>Grown in Kenya</span>
          </div>
        </footer>
      </NoticeContext.Provider>
    </AuthContext.Provider>
  );
}

function Protected({ children, role }: { children: ReactNode; role?: string }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role)
    return <Empty title="This page is for a different account role." />;
  return children;
}
