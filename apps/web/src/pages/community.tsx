import { useContext, useEffect, useState, useRef } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { api, send, useData, money, date } from '../api';
import { NoticeContext, useAuth, useAction, values } from '../context';
import { Button, Status, PageHead, Feedback, Empty, Pagination, Field } from '../components/ui';
import { categories } from '../constants';
import type { Data } from '../api';

export function Requests() {
  const { user } = useAuth(),
    [page, setPage] = useState(1),
    [matches, setMatches] = useState<Data[]>([]),
    load = useData(user?.role === 'Admin' ? null : `/requests?page=${page}`),
    action = useAction(),
    notify = useContext(NoticeContext),
    navigate = useNavigate(),
    products = useData(user?.role === 'Farmer' ? '/farmer/products' : null);
  if (user?.role === 'Admin') return <Navigate to="/admin" />;
  return (
    <>
      <PageHead
        eyebrow="COMMUNITY REQUESTS"
        title={
          user?.role === 'Buyer'
            ? 'Looking for something specific?'
            : 'Your next buyer could be here.'
        }
      />
      <Feedback {...load} retry={load.refresh} />
      <div className={user?.role === 'Buyer' ? 'request-layout' : ''}>
        {user?.role === 'Buyer' && (
          <form
            className="panel request-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                b: Data = values(e);
              b.quantity = Number(b.quantity);
              b.budget_max = b.budget_max || null;
              action.run(async () => {
                const result = await send('/requests', b);
                form.reset();
                setMatches(result.matches);
                notify(
                  result.matches.length
                    ? 'Request posted. Matching listings are available in the marketplace.'
                    : 'Request posted. Farmers can now respond.',
                );
                load.refresh();
              });
            }}
          >
            <h2>Post a request</h2>
            <Field label="What do you need?" name="title" maxLength={150} />
            <label className="field">
              Details
              <textarea name="description" minLength={10} maxLength={10000} required />
            </label>
            <label className="field">
              Category
              <select name="category">
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <Field
                label="Quantity"
                name="quantity"
                type="number"
                min="1"
                max="10000000"
                defaultValue="1"
              />
              <Field label="Unit" name="unit" defaultValue="kg" maxLength={30} />
            </div>
            <Field
              label="Maximum budget (optional, KES)"
              name="budget_max"
              type="number"
              min="0.01"
              max="99999999.99"
              step="0.01"
              required={false}
            />
            <Button busy={action.busy}>
              Post request <ArrowRight size={16} />
            </Button>
            {matches.length > 0 && (
              <div className="offer">
                <h3>Already in the marketplace</h3>
                {matches.map((p) => (
                  <p key={p.product_id}>
                    <Link to={`/products/${p.product_id}`}>
                      {p.product_name} · {money(p.price)} / {p.unit}
                    </Link>
                  </p>
                ))}
              </div>
            )}
          </form>
        )}
        <div className="request-list">
          {load.data?.items.length === 0 && <Empty title="No requests here yet." />}
          {load.data?.items.map((r: Data) => (
            <section className="panel" key={r.request_id}>
              <div className="spread">
                <p className="eyebrow">{r.category}</p>
                <Status value={r.status} />
              </div>
              <h3>{r.title}</h3>
              <p className="description">{r.description}</p>
              <p className="subtle">
                {r.quantity} {r.unit}
                {r.budget_max ? ` · Budget ${money(r.budget_max)}` : ''}
              </p>
              {user?.role === 'Farmer' && r.offers.length === 0 && (
                <form
                  className="offer-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const b: Data = values(e);
                    b.product_id = b.product_id ? Number(b.product_id) : null;
                    action.run(async () => {
                      await send(`/requests/${r.request_id}/offers`, b);
                      notify('Your offer was sent.');
                      load.refresh();
                    });
                  }}
                >
                  <label className="field">
                    Link a listing (optional)
                    <select name="product_id">
                      <option value="">No listing</option>
                      {products.data?.items
                        .filter((p: Data) => p.status === 'Available')
                        .map((p: Data) => (
                          <option key={p.product_id} value={p.product_id}>
                            {p.product_name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Field label="Your message" name="message" maxLength={2000} />
                  <Field
                    label="Proposed price (KES)"
                    name="price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max="99999999.99"
                  />
                  <Button busy={action.busy}>Send offer</Button>
                </form>
              )}
              {r.offers.map((o: Data) => (
                <div className="offer" key={o.offer_id}>
                  <div className="spread">
                    <strong>{o.farmer_name}</strong>
                    <Status value={o.status} />
                  </div>
                  <p>{o.message}</p>
                  <strong>{money(o.price)}</strong>
                  {o.product_id && (
                    <p>
                      <Link to={`/products/${o.product_id}`}>{o.product_name}</Link>
                    </p>
                  )}
                  {user?.role === 'Buyer' && o.status === 'Pending' && r.status === 'Open' && (
                    <Button
                      busy={action.busy}
                      className="secondary"
                      onClick={() => {
                        if (
                          confirm(
                            'Accept this offer? Other offers will be declined. Agree delivery and payment with the farmer in messages.',
                          )
                        )
                          action.run(async () => {
                            const result = await send(`/requests/${r.request_id}/accept`, {
                              offer_id: o.offer_id,
                            });
                            notify(result.message);
                            navigate(`/messages?peer=${result.farmer_id}`);
                          });
                      }}
                    >
                      Accept offer
                    </Button>
                  )}
                  {o.status === 'Accepted' && (
                    <Link
                      className="contact-link"
                      to={`/messages?peer=${user?.role === 'Buyer' ? o.farmer_id : r.buyer_id}`}
                    >
                      Open conversation <MessageCircle size={15} />
                    </Link>
                  )}
                </div>
              ))}
              {user?.role === 'Buyer' && r.status === 'Open' && (
                <button
                  className="text-button danger"
                  disabled={action.busy}
                  onClick={() => {
                    if (confirm('Close this request?'))
                      action.run(async () => {
                        await send(`/requests/${r.request_id}/close`);
                        load.refresh();
                      });
                  }}
                >
                  Close request
                </button>
              )}
            </section>
          ))}
          {load.data && <Pagination page={page} more={load.data.has_more} onChange={setPage} />}
        </div>
      </div>
    </>
  );
}

const mergeMessages = (...groups: Data[][]) =>
  Array.from(new Map(groups.flat().map((m) => [m.msg_id, m])).values()).sort(
    (a, b) => a.msg_id - b.msg_id,
  );
export function Messages() {
  const { user } = useAuth(),
    [params, setParams] = useSearchParams(),
    peer = params.get('peer'),
    threads = useData<Data[]>('/messages/threads', true),
    thread = useData(peer ? `/messages/thread/${peer}` : null, true),
    action = useAction(),
    [older, setOlder] = useState<Data[]>([]),
    [hasOlder, setHasOlder] = useState(true),
    peerRef = useRef(peer);
  peerRef.current = peer;
  useEffect(() => {
    setOlder([]);
    setHasOlder(true);
    if (peer)
      send(`/messages/thread/${peer}/read`)
        .then(threads.refresh)
        .catch(() => {});
  }, [peer]);
  useEffect(() => {
    if (!thread.data) return;
    setOlder((previous) => mergeMessages(previous, thread.data.items));
    if (
      peer &&
      thread.data.items.some((m: Data) => m.receiver_id === user?.user_id && !m.is_read)
    ) {
      send(`/messages/thread/${peer}/read`)
        .then(threads.refresh)
        .catch(() => {});
    }
  }, [thread.data, peer, user?.user_id]);
  return (
    <>
      <PageHead eyebrow="CONVERSATIONS" title="A good connection goes a long way." />
      <div className="messages-layout">
        <aside className="panel thread-list">
          <h3>Messages</h3>
          <Feedback {...threads} retry={threads.refresh} />
          {threads.data?.length === 0 && (
            <p className="subtle">Start a conversation from a product or accepted offer.</p>
          )}
          {threads.data?.map((t) => (
            <button
              key={t.user_id}
              className={String(t.user_id) === peer ? 'thread selected' : 'thread'}
              onClick={() => setParams({ peer: String(t.user_id) })}
            >
              <span className="avatar">{t.full_name[0]}</span>
              <span>
                <strong>{t.full_name}</strong>
                <small>{t.latest_message}</small>
              </span>
              {Number(t.unread) > 0 && <span className="badge good">{t.unread}</span>}
            </button>
          ))}
        </aside>
        <section className="panel conversation">
          {!peer ? (
            <Empty title="Choose a conversation">
              <p>Talk produce, availability and delivery.</p>
            </Empty>
          ) : (
            <>
              <Feedback {...thread} retry={thread.refresh} />
              {thread.data && (
                <>
                  <div className="conversation-head">
                    <span className="avatar">{thread.data.peer.full_name[0]}</span>
                    <h3>{thread.data.peer.full_name}</h3>
                  </div>
                  <div className="message-stream">
                    {thread.data.has_more && hasOlder && (
                      <button
                        className="text-button"
                        disabled={action.busy}
                        onClick={() =>
                          action.run(async () => {
                            const before = older[0]?.msg_id ?? thread.data.items[0]?.msg_id;
                            if (!before) return;
                            const requestedPeer = peer;
                            const result = await api(`/messages/thread/${peer}?before=${before}`);
                            if (peerRef.current !== requestedPeer) return;
                            setOlder((v) => mergeMessages(v, result.items));
                            setHasOlder(result.has_more);
                          })
                        }
                      >
                        Load earlier messages
                      </button>
                    )}
                    {mergeMessages(older, thread.data.items).map((m: Data) => (
                      <div
                        className={`bubble ${m.sender_id === user?.user_id ? 'mine' : ''}`}
                        key={m.msg_id}
                      >
                        <p>{m.content}</p>
                        <time>{date(m.sent_at)}</time>
                      </div>
                    ))}
                  </div>
                  <form
                    className="message-compose"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget,
                        b = values(e);
                      action.run(async () => {
                        await send(`/messages/thread/${peer}`, b);
                        form.reset();
                        thread.refresh();
                        threads.refresh();
                      });
                    }}
                  >
                    <label className="sr-only" htmlFor="message">
                      Your message
                    </label>
                    <textarea
                      id="message"
                      name="content"
                      placeholder="Write a message…"
                      required
                      maxLength={4000}
                    />
                    <Button busy={action.busy} aria-label="Send message">
                      <ArrowRight size={21} />
                    </Button>
                  </form>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
