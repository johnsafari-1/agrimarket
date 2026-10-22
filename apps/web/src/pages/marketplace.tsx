import { useContext, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Sprout,
  ShoppingBag,
  Truck,
  ShieldCheck,
  ArrowRight,
  Search,
  MapPin,
  Leaf,
  MessageCircle,
  ChevronRight,
  Users,
} from 'lucide-react';
import { send, useData, money } from '../api';
import { NoticeContext, useAuth, useAction } from '../context';
import { Button, PageHead, Feedback, Empty, Pagination } from '../components/ui';
import { categories } from '../constants';
import type { Data } from '../api';

export function ProductCard({ p }: { p: Data }) {
  return (
    <Link className="product-card" to={`/products/${p.product_id}`}>
      <div className="product-image">
        {p.image_url ? (
          <img src={p.image_url} alt={p.product_name} loading="lazy" />
        ) : (
          <Leaf size={54} />
        )}
        <span className="category-label">{p.category}</span>
      </div>
      <div className="product-info">
        <p className="farmer">
          <Sprout size={13} />
          {p.business_name || p.farmer_name}
        </p>
        <h3>{p.product_name}</h3>
        <p className="location">
          <MapPin size={13} />
          {p.location || 'Kenya'}
        </p>
        <div className="product-bottom">
          <span>
            <strong>{money(p.price)}</strong>
            <small> / {p.unit}</small>
          </span>
          <span className="round-link">
            <ArrowRight size={18} />
          </span>
        </div>
      </div>
    </Link>
  );
}

export function Marketplace() {
  const [params, setParams] = useSearchParams(),
    [search, setSearch] = useState(params.get('q') ?? '');
  const page = Number(params.get('page') ?? 1),
    category = params.get('category') ?? '';
  const load = useData(`/products?${params}`);
  const change = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(updates).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next);
  };
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="live-dot" />
            DIRECT FROM KENYAN FARMS
          </p>
          <h1>
            Fresh from the soil.
            <br />
            <em>Closer to you.</em>
          </h1>
          <p>
            Meet the people who grow your food. Shop seasonal produce, support local farmers, and
            follow every delivery.
          </p>
          <a className="button cream" href="#market">
            Explore the marketplace <ArrowRight size={18} />
          </a>
          <div className="hero-proof">
            <span>
              <ShieldCheck size={17} />
              Direct farmer connections
            </span>
            <span>
              <Truck size={17} />
              Delivery updates
            </span>
          </div>
        </div>
        <div className="hero-photo">
          <img src="/images/hero-market.jpg" alt="Fresh farm produce at the market" />
          <div className="photo-note">
            <Sprout size={25} />
            <span>
              From their farm.
              <br />
              <strong>To your table.</strong>
            </span>
          </div>
        </div>
      </section>
      <section className="value-strip">
        <span>
          <Leaf />
          Seasonal & fresh
        </span>
        <span>
          <Users />
          Support local growers
        </span>
        <span>
          <ShoppingBag />
          Prices in Kenyan shillings
        </span>
      </section>
      <section id="market">
        <PageHead eyebrow="THE MARKETPLACE" title="Good things are growing.">
          <span className="subtle">Find your next fresh favourite</span>
        </PageHead>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            change({ q: search, page: '1' });
          }}
        >
          <Search size={20} />
          <input
            aria-label="Search produce"
            placeholder="Search maize, vegetables, fresh milk…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button>Search</button>
        </form>
        <div className="chips">
          {['', ...categories].map((c) => (
            <button
              key={c}
              className={category === c ? 'chip selected' : 'chip'}
              onClick={() => change({ category: c, page: '1' })}
            >
              {c || 'All produce'}
            </button>
          ))}
        </div>
        <Feedback {...load} retry={load.refresh} />
        {load.data?.items.length === 0 && (
          <Empty title="No produce found">
            <p>Try another search or post a buyer request.</p>
            <Link to="/requests">
              Request a product <ArrowRight size={15} />
            </Link>
          </Empty>
        )}
        <div className="product-grid">
          {load.data?.items.map((p: Data) => (
            <ProductCard key={p.product_id} p={p} />
          ))}
        </div>
        {load.data && (
          <Pagination
            page={page}
            more={load.data.has_more}
            onChange={(p) => change({ page: String(p) })}
          />
        )}
      </section>
      <section className="farmer-banner">
        <div>
          <p className="eyebrow">FOR THE PEOPLE WHO GROW</p>
          <h2>
            Your harvest deserves
            <br />a bigger market.
          </h2>
          <p>List your produce and connect directly with buyers.</p>
        </div>
        <Link className="button cream" to="/register">
          Start selling <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}

export function Product() {
  const { id } = useParams(),
    load = useData(`/products/${id}`),
    { user } = useAuth(),
    action = useAction(),
    notify = useContext(NoticeContext),
    [quantity, setQuantity] = useState(1);
  const p = load.data;
  return (
    <>
      <Link className="breadcrumb" to="/">
        Marketplace <ChevronRight size={14} /> Product
      </Link>
      <Feedback {...load} retry={load.refresh} />
      {p && (
        <section className="detail-grid">
          <div className="detail-image">
            {p.image_url ? <img src={p.image_url} alt={p.product_name} /> : <Leaf size={100} />}
          </div>
          <div className="detail-copy">
            <p className="eyebrow">{p.category}</p>
            <h1>{p.product_name}</h1>
            <p className="farmer">
              <Sprout size={18} />
              {p.business_name || p.farmer_name}
            </p>
            <p className="location">
              <MapPin size={16} />
              {p.location || 'Kenya'}
            </p>
            <p className="description">
              {p.description || 'Fresh produce directly from the farmer.'}
            </p>
            <p className="price-large">
              {money(p.price)} <small>/ {p.unit}</small>
            </p>
            <p className="subtle">
              {p.quantity} {p.unit} available
            </p>
            {user?.role === 'Buyer' ? (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  action.run(async () => {
                    await send(`/cart/${p.product_id}`, { quantity }, 'PUT');
                    notify('Added to your cart.');
                  });
                }}
              >
                <label>
                  Quantity
                  <input
                    type="number"
                    min="1"
                    max={Math.min(p.quantity, 10000)}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    required
                  />
                </label>
                <Button busy={action.busy}>
                  <ShoppingBag size={18} />
                  Add to cart
                </Button>
              </form>
            ) : !user ? (
              <Link className="button" to="/login">
                Sign in to shop <ArrowRight size={17} />
              </Link>
            ) : null}
            {user && user.user_id !== p.farmer_id && (
              <Link className="contact-link" to={`/messages?peer=${p.farmer_id}`}>
                <MessageCircle size={17} />
                Message the farmer
              </Link>
            )}
            <div className="detail-assurance">
              <Truck size={22} />
              <span>
                Know where your order stands.
                <small>Farmer updates and estimated delivery windows.</small>
              </span>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
