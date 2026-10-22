import { useState } from 'react';
import { Download } from 'lucide-react';
import { send, useData, money } from '../api';
import { useAuth, useAction } from '../context';
import { Button, Status, PageHead, Feedback, Pagination } from '../components/ui';
import type { Data } from '../api';

export function Admin() {
  const summary = useData('/admin/summary'),
    [page, setPage] = useState(1),
    users = useData<Data[]>(`/admin/users?page=${page}`),
    [productPage, setProductPage] = useState(1),
    products = useData(`/admin/products?page=${productPage}`),
    { user } = useAuth(),
    action = useAction();
  return (
    <>
      <PageHead eyebrow="ADMINISTRATION" title="A healthy marketplace.">
        <a className="button secondary" href="/api/admin/report.csv">
          <Download size={17} />
          Export orders
        </a>
      </PageHead>
      <Feedback {...summary} retry={summary.refresh} />
      {summary.data && (
        <div className="stats-grid">
          {[
            ['Members', summary.data.users],
            ['Listings', summary.data.products],
            ['Orders', summary.data.orders],
            ['Verified payments', money(summary.data.paid_revenue)],
          ].map(([label, value]) => (
            <div className="panel stat" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      {summary.data &&
        (Number(summary.data.failed_emails) > 0 || Number(summary.data.payment_reviews) > 0) && (
          <div className="error">
            Needs attention: {summary.data.failed_emails} failed email jobs,{' '}
            {summary.data.payment_reviews} payment reviews.
          </div>
        )}
      <section>
        <PageHead eyebrow="ACCOUNT MANAGEMENT" title="People behind the market." />
        <Feedback {...users} retry={users.refresh} />
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u.user_id}>
                  <td>
                    <strong>{u.full_name}</strong>
                    <small>{u.location}</small>
                  </td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>
                    <Status value={u.is_active ? 'Active' : 'Unavailable'} />
                  </td>
                  <td>
                    <Button
                      busy={action.busy}
                      className="secondary small"
                      disabled={u.user_id === user?.user_id}
                      onClick={() => {
                        if (confirm(`${u.is_active ? 'Deactivate' : 'Activate'} ${u.full_name}?`))
                          action.run(async () => {
                            await send(`/admin/users/${u.user_id}/status`, {
                              is_active: !u.is_active,
                            });
                            users.refresh();
                            summary.refresh();
                          });
                      }}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} more={users.data?.length === 24} onChange={setPage} />
      </section>
      <section>
        <PageHead eyebrow="LISTING MODERATION" title="Keep the market in good shape." />
        <Feedback {...products} retry={products.refresh} />
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Farmer</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {products.data?.items.map((p: Data) => (
                <tr key={p.product_id}>
                  <td>{p.product_name}</td>
                  <td>{p.farmer_name}</td>
                  <td>
                    <Status value={p.status} />
                  </td>
                  <td>
                    <Button
                      busy={action.busy}
                      className="secondary small"
                      disabled={p.status === 'Unavailable'}
                      onClick={() => {
                        if (confirm('Archive this listing?'))
                          action.run(async () => {
                            await send(`/admin/products/${p.product_id}/archive`);
                            products.refresh();
                          });
                      }}
                    >
                      Archive
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {products.data && (
          <Pagination page={productPage} more={products.data.has_more} onChange={setProductPage} />
        )}
      </section>
    </>
  );
}
