import { useState } from 'react';
import { X, Plus, Check, Pencil, Archive } from 'lucide-react';
import { api, send, useData, money } from '../api';
import { useAction, values } from '../context';
import { Button, Status, PageHead, Feedback, Empty, Pagination, Field } from '../components/ui';
import { categories } from '../constants';
import type { Data } from '../api';

export function Farm() {
  const [page, setPage] = useState(1),
    load = useData(`/farmer/products?page=${page}`),
    [editing, setEditing] = useState<Data | null>(null),
    [adding, setAdding] = useState(false),
    action = useAction();
  return (
    <>
      <PageHead eyebrow="FARMER WORKSPACE" title="Your harvest. Your business.">
        <button
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
        >
          <Plus size={17} />
          New listing
        </button>
      </PageHead>
      <Feedback {...load} retry={load.refresh} />
      {adding && (
        <ProductForm
          key={editing?.product_id ?? 'new'}
          product={editing}
          done={() => {
            setAdding(false);
            load.refresh();
          }}
          cancel={() => setAdding(false)}
        />
      )}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produce</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {load.data?.items.map((p: Data) => (
              <tr key={p.product_id}>
                <td>
                  <strong>{p.product_name}</strong>
                  <small>{p.category}</small>
                </td>
                <td>
                  {money(p.price)} / {p.unit}
                </td>
                <td>{p.quantity}</td>
                <td>
                  <Status value={p.status} />
                </td>
                <td>
                  <div className="inline-actions">
                    <button
                      className="icon-button"
                      aria-label={`Edit ${p.product_name}`}
                      onClick={() => {
                        setEditing(p);
                        setAdding(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Archive ${p.product_name}`}
                      disabled={action.busy || p.status === 'Unavailable'}
                      onClick={() => {
                        if (confirm('Archive this listing? Previous orders will be kept.'))
                          action.run(async () => {
                            await send(`/farmer/products/${p.product_id}`, undefined, 'DELETE');
                            load.refresh();
                          });
                      }}
                    >
                      <Archive size={17} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {load.data?.items.length === 0 && <Empty title="Your first listing starts here." />}
      </div>
      {load.data && <Pagination page={page} more={load.data.has_more} onChange={setPage} />}
    </>
  );
}

export function ProductForm({
  product,
  done,
  cancel,
}: {
  product: Data | null;
  done: () => void;
  cancel: () => void;
}) {
  const action = useAction(),
    [image, setImage] = useState<File | null>(null);
  return (
    <form
      className="panel listing-form"
      onSubmit={(e) => {
        e.preventDefault();
        const b: Data = values(e);
        delete b.image;
        b.quantity = Number(b.quantity);
        if (product) b.expected_quantity = product.quantity;
        b.image_url = '';
        action.run(async () => {
          if (image) {
            const form = new FormData();
            form.append('image', image);
            const uploaded = await api('/farmer/images', { method: 'POST', body: form });
            b.image_url = uploaded.image_url;
          }
          await send(
            product ? `/farmer/products/${product.product_id}` : '/farmer/products',
            b,
            product ? 'PUT' : 'POST',
          );
          done();
        });
      }}
    >
      <div className="spread">
        <h2>{product ? 'Edit listing' : 'Grow your market'}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close listing form"
          onClick={cancel}
        >
          <X />
        </button>
      </div>
      <div className="form-grid">
        <Field
          label="Product name"
          name="product_name"
          defaultValue={product?.product_name}
          maxLength={150}
        />
        <label className="field">
          Category
          <select name="category" defaultValue={product?.category}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <Field
          label="Price (KES)"
          name="price"
          type="number"
          step="0.01"
          min="0.01"
          max="99999999.99"
          defaultValue={product?.price}
        />
        <Field
          label="Quantity available"
          name="quantity"
          type="number"
          min="0"
          max="10000000"
          defaultValue={product?.quantity ?? 0}
        />
        <Field label="Unit" name="unit" defaultValue={product?.unit ?? 'kg'} maxLength={30} />
        <label className="field">
          Visibility
          <select name="status" defaultValue={product?.status ?? 'Available'}>
            <option>Available</option>
            <option>Unavailable</option>
          </select>
        </label>
      </div>
      <label className="field">
        Description
        <textarea name="description" maxLength={10000} defaultValue={product?.description ?? ''} />
      </label>
      <Field
        label="Product image"
        name="image"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        required={false}
        hint="Up to 3 MB and 16 megapixels. Existing images are retained unless replaced."
        onChange={(e) => setImage(e.target.files?.[0] ?? null)}
      />
      <Button busy={action.busy}>
        Save listing <Check size={17} />
      </Button>
    </form>
  );
}
