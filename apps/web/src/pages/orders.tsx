import { useContext, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Truck,
  ArrowRight,
  X,
  MapPin,
  MessageCircle,
  Package,
  ChevronRight,
  RefreshCw,
  Check,
} from 'lucide-react';
import { api, send, useData, money, date } from '../api';
import { NoticeContext, useAuth, useAction, values } from '../context';
import { Button, Status, PageHead, Feedback, Empty, Pagination, Field } from '../components/ui';
import type { Data } from '../api';

export function Cart() {
  const load = useData<Data[]>('/cart'),
    action = useAction(),
    navigate = useNavigate(),
    [method, setMethod] = useState('Cash on Delivery'),
    [key, setKey] = useState(() => crypto.randomUUID());
  const total = load.data?.reduce((sum, p) => sum + Number(p.price) * p.cart_quantity, 0) ?? 0;
  const [capabilities, setCapabilities] = useState(false);
  useEffect(() => {
    api('/capabilities')
      .then((v) => setCapabilities(v.mpesa_enabled))
      .catch(() => {});
  }, []);
  return (
    <>
      <PageHead eyebrow="YOUR BASKET" title="Fresh picks, ready to go." />
      <Feedback {...load} retry={load.refresh} />
      {load.data?.length === 0 ? (
        <Empty title="Your basket is waiting">
          <Link to="/">
            Explore the marketplace <ArrowRight size={16} />
          </Link>
        </Empty>
      ) : (
        load.data && (
          <div className="checkout-grid">
            <div className="panel">
              {load.data.map((p) => (
                <div className="cart-row" key={p.product_id}>
                  <div>
                    <Link to={`/products/${p.product_id}`}>
                      <h3>{p.product_name}</h3>
                    </Link>
                    <p className="subtle">
                      {money(p.price)} / {p.unit} · {p.farmer_name}
                    </p>
                  </div>
                  <label className="quantity-label">
                    Quantity
                    <input
                      aria-label={`Quantity of ${p.product_name}`}
                      type="number"
                      min="0"
                      max="10000"
                      defaultValue={p.cart_quantity}
                      key={`${p.product_id}-${p.cart_quantity}`}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isInteger(n) && n !== p.cart_quantity)
                          action.run(async () => {
                            await send(`/cart/${p.product_id}`, { quantity: n }, 'PUT');
                            setKey(crypto.randomUUID());
                            load.refresh();
                          });
                      }}
                    />
                  </label>
                  <strong>{money(Number(p.price) * p.cart_quantity)}</strong>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${p.product_name}`}
                    disabled={action.busy}
                    onClick={() =>
                      action.run(async () => {
                        await send(`/cart/${p.product_id}`, { quantity: 0 }, 'PUT');
                        setKey(crypto.randomUUID());
                        load.refresh();
                      })
                    }
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
            <form
              className="panel checkout-summary"
              onSubmit={(e) => {
                e.preventDefault();
                const b = values(e);
                action.run(async () => {
                  const result = await send('/orders', b, 'POST', { 'Idempotency-Key': key });
                  navigate(`/orders/${result.order_id}`);
                });
              }}
            >
              <p className="eyebrow">CHECKOUT</p>
              <h2>Bring it home.</h2>
              <div className="total">
                <span>Order total</span>
                <strong>{money(total)}</strong>
              </div>
              <label className="field">
                Delivery address
                <textarea
                  name="delivery_address"
                  placeholder="Town, estate, street or landmark"
                  maxLength={255}
                  required
                />
              </label>
              <label className="field">
                Payment method
                <select
                  name="payment_method"
                  value={method}
                  onChange={(e) => {
                    setMethod(e.target.value);
                    setKey(crypto.randomUUID());
                  }}
                >
                  <option>Cash on Delivery</option>
                  {capabilities && <option>M-Pesa</option>}
                </select>
              </label>
              {method === 'M-Pesa' && (
                <Field
                  label="M-Pesa phone number"
                  name="phone_number"
                  type="tel"
                  placeholder="07XXXXXXXX"
                />
              )}
              <Button busy={action.busy} className="full">
                Place order <ArrowRight size={17} />
              </Button>
              <p className="fine-print">
                Delivery estimates appear when each farmer confirms your order.
              </p>
            </form>
          </div>
        )
      )}
    </>
  );
}

export function OrderList() {
  const { user } = useAuth(),
    [page, setPage] = useState(1),
    load = useData(`/orders?page=${page}`);
  return (
    <>
      <PageHead
        eyebrow={user?.role === 'Farmer' ? 'FARMER WORKSPACE' : 'YOUR MARKETPLACE'}
        title={
          user?.role === 'Farmer' ? 'From your farm, on its way.' : 'Every order, in one place.'
        }
      />
      <Feedback {...load} retry={load.refresh} />
      {load.data?.items.length === 0 && (
        <Empty title="No orders yet">
          <Link to="/">Browse fresh produce</Link>
        </Empty>
      )}
      <div className="order-grid">
        {load.data?.items.map((o: Data) => (
          <Link to={`/orders/${o.order_id}`} className="panel order-card" key={o.order_id}>
            <div className="spread">
              <span className="order-icon">
                <Package size={24} />
              </span>
              <Status value={o.status} />
            </div>
            <h3>Order #{o.order_id}</h3>
            <p className="subtle">{date(o.order_date)}</p>
            <div className="spread">
              <strong>{money(o.total_amount)}</strong>
              <ArrowRight size={19} />
            </div>
            <p className="fine-print">Payment: {o.payment_status}</p>
          </Link>
        ))}
      </div>
      {load.data && <Pagination page={page} more={load.data.has_more} onChange={setPage} />}
    </>
  );
}

export function OrderDetail() {
  const { id } = useParams(),
    { user } = useAuth(),
    load = useData(`/orders/${id}`, true),
    action = useAction(),
    notify = useContext(NoticeContext);
  const order = load.data;
  return (
    <>
      <Link to="/orders" className="breadcrumb">
        Orders <ChevronRight size={14} /> Order #{id}
      </Link>
      <PageHead eyebrow="ORDER TRACKING" title={`Your order’s journey.`}>
        <button className="secondary" onClick={load.refresh} disabled={load.loading}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </PageHead>
      <Feedback {...load} retry={load.refresh} />
      {order && (
        <>
          <div className="order-summary panel">
            <div>
              <p className="eyebrow">ORDER #{id}</p>
              <h2>{money(order.total_amount)}</h2>
              <p className="subtle">Placed {date(order.order_date)}</p>
            </div>
            <div>
              <Status value={order.status} />
              <p className="subtle">
                <MapPin size={14} />
                {order.delivery_address}
              </p>
            </div>
          </div>
          <div className="tracking-layout">
            <div>
              {order.fulfilments.map((f: Data) => (
                <Fulfilment key={f.farmer_id} f={f} order={order} refresh={load.refresh} />
              ))}
              <p className="fine-print">
                Updates refresh every 30 seconds while this page is visible. Tracking shows farmer
                delivery updates; GPS tracking is not included.
              </p>
            </div>
            <aside>
              <section className="panel">
                <p className="eyebrow">PAYMENT</p>
                {order.payments.map((p: Data) => (
                  <div className="payment-row" key={p.txn_id}>
                    <strong>{p.payment_method}</strong>
                    <Status value={p.payment_status} />
                    {p.amount && <p>{money(p.amount)}</p>}
                    {user?.role === 'Buyer' &&
                      p.payment_method === 'M-Pesa' &&
                      p.payment_status === 'Pending' && (
                        <div className="stack">
                          <Button
                            busy={action.busy}
                            onClick={() =>
                              action.run(async () => {
                                const r = await send(`/payments/mpesa/${id}/start`);
                                notify(r.message);
                                load.refresh();
                              })
                            }
                          >
                            Send M-Pesa prompt
                          </Button>
                          <Button
                            busy={action.busy}
                            className="secondary"
                            onClick={() =>
                              action.run(async () => {
                                await send(`/payments/mpesa/${id}/check`);
                                notify('Payment status checked.');
                                load.refresh();
                              })
                            }
                          >
                            Check payment
                          </Button>
                        </div>
                      )}
                  </div>
                ))}
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}

export function Fulfilment({ f, order, refresh }: { f: Data; order: Data; refresh: () => void }) {
  const { user } = useAuth(),
    action = useAction(),
    [editing, setEditing] = useState(false);
  const stages = ['Pending', 'Confirmed', 'Shipped', 'Delivered'],
    next: Record<string, string> = {
      Pending: 'Confirmed',
      Confirmed: 'Shipped',
      Shipped: 'Delivered',
    };
  const items = order.items.filter((i: Data) => i.farmer_id === f.farmer_id);
  const canManage =
    user?.role === 'Admin' || (user?.role === 'Farmer' && user.user_id === f.farmer_id);
  const cod = order.payments.every((p: Data) => p.payment_method === 'Cash on Delivery');
  const transition = (status: string, extra: Data = {}) =>
    action.run(async () => {
      await send(`/orders/${order.order_id}/fulfilments/${f.farmer_id}`, {
        status,
        version: f.version,
        ...extra,
      });
      setEditing(false);
      refresh();
    });
  return (
    <section className="panel fulfilment">
      <div className="spread">
        <div>
          <p className="eyebrow">FARMER DELIVERY</p>
          <h3>{f.business_name || f.farmer_name}</h3>
        </div>
        <Status value={f.status} />
      </div>
      {f.status !== 'Cancelled' && (
        <ol className="stepper">
          {stages.map((s, n) => (
            <li key={s} className={n <= stages.indexOf(f.status) ? 'complete' : ''}>
              <span>{n < stages.indexOf(f.status) ? <Check size={15} /> : n + 1}</span>
              <small>{s === 'Pending' ? 'Placed' : s}</small>
            </li>
          ))}
        </ol>
      )}
      {f.estimated_delivery_date && (
        <div className="delivery-estimate">
          <Truck size={21} />
          <div>
            <strong>Estimated arrival</strong>
            <p>
              {new Date(f.estimated_delivery_date + 'T12:00:00Z').toLocaleDateString('en-KE', {
                dateStyle: 'long',
              })}{' '}
              · {f.estimated_delivery_window}
            </p>
          </div>
        </div>
      )}
      <div className="order-items">
        {items.map((i: Data) => (
          <div className="spread" key={i.item_id}>
            <span>
              {i.product_name}
              <small>
                {i.quantity} {i.unit} × {money(i.unit_price)}
              </small>
            </span>
            <strong>{money(i.quantity * Number(i.unit_price))}</strong>
          </div>
        ))}
      </div>
      <div className="fulfilment-actions">
        {user?.user_id !== f.farmer_id && (
          <Link to={`/messages?peer=${f.farmer_id}`} className="contact-link">
            <MessageCircle size={16} />
            Message farmer
          </Link>
        )}
        {canManage && next[f.status] && (
          <Button busy={action.busy} onClick={() => setEditing(!editing)}>
            {next[f.status] === 'Confirmed'
              ? 'Confirm delivery'
              : next[f.status] === 'Shipped'
                ? 'Mark as shipped'
                : 'Mark as delivered'}
            <ArrowRight size={15} />
          </Button>
        )}
        {cod &&
          ((canManage && ['Pending', 'Confirmed'].includes(f.status)) ||
            (user?.role === 'Buyer' && f.status === 'Pending')) && (
            <button
              className="text-button danger"
              disabled={action.busy}
              onClick={() => {
                if (confirm('Cancel this farmer’s delivery and restore its stock?'))
                  void transition('Cancelled');
              }}
            >
              Cancel delivery
            </button>
          )}
      </div>
      {editing && (
        <form
          className="transition-form"
          onSubmit={(e) => {
            e.preventDefault();
            void transition(next[f.status], values(e));
          }}
        >
          {f.status === 'Pending' && (
            <div className="form-grid">
              <Field
                label="Estimated delivery date"
                name="estimated_delivery_date"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
              />
              <label className="field">
                Delivery window
                <select name="estimated_delivery_window">
                  <option>Morning</option>
                  <option>Afternoon</option>
                  <option>Evening</option>
                </select>
              </label>
            </div>
          )}
          <Field label="Delivery note (optional)" name="note" required={false} maxLength={500} />
          <Button busy={action.busy}>Save update</Button>
        </form>
      )}
      <div className="timeline">
        <h4>Delivery history</h4>
        {order.events
          .filter((e: Data) => e.farmer_id === f.farmer_id)
          .map((e: Data) => (
            <div className="timeline-event" key={e.event_id}>
              <span className="timeline-dot" />
              <div>
                <strong>{e.status}</strong>
                <p>{e.note}</p>
                <time>{date(e.created_at)}</time>
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
