import type { ReactNode } from 'react';
import { Sprout, AlertCircle } from 'lucide-react';
export function Button({
  children,
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...props} disabled={busy || props.disabled}>
      {busy ? 'Working…' : children}
    </button>
  );
}

export function Status({ value }: { value: string }) {
  return (
    <span
      className={`badge ${['Delivered', 'Completed', 'Available', 'Accepted', 'Fulfilled', 'Active'].includes(value) ? 'good' : ['Cancelled', 'Failed', 'Declined', 'Unavailable'].includes(value) ? 'muted' : 'pending'}`}
    >
      {value}
    </span>
  );
}

export function PageHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Feedback({
  error,
  loading,
  retry,
}: {
  error: string;
  loading: boolean;
  retry: () => void;
}) {
  return (
    <>
      {error && (
        <div className="error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button className="text-button" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {loading && (
        <p className="loading" role="status">
          Loading…
        </p>
      )}
    </>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Sprout size={36} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Pagination({
  page,
  more,
  onChange,
}: {
  page: number;
  more: boolean;
  onChange: (p: number) => void;
}) {
  return (
    <div className="pagination">
      <button className="secondary" disabled={page === 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span>Page {page}</span>
      <button className="secondary" disabled={!more} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
}

export function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="field">
      {label}
      <input required {...props} />
      {hint && <small>{hint}</small>}
    </label>
  );
}
