import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export function Button(props: {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly variant?: 'primary' | 'ghost';
  readonly type?: 'button' | 'submit';
}) {
  const variant = props.variant ?? 'primary';
  return (
    <button
      type={props.type ?? 'button'}
      className={`btn btn-${variant}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function Card(props: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <section className="card">
      {(props.title || props.actions) && (
        <header className="card-head">
          <h2>{props.title}</h2>
          {props.actions}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function Badge(props: {
  readonly tone?: 'ok' | 'warn' | 'bad' | 'muted';
  readonly children: ReactNode;
}) {
  return <span className={`badge badge-${props.tone ?? 'muted'}`}>{props.children}</span>;
}

export function KindBadge(props: { readonly kind: string }) {
  const tone =
    props.kind === 'correction' || props.kind === 'failure' ? 'warn' : props.kind === 'win' ? 'ok' : 'muted';
  return <Badge tone={tone}>{props.kind}</Badge>;
}

export function ErrorNote(props: { readonly message: string; readonly onRetry?: () => void }) {
  return (
    <div className="error-note">
      <span>{props.message}</span>
      {props.onRetry && (
        <Button variant="ghost" onClick={props.onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

export function Modal(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={(next) => !next && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content">
          <Dialog.Title className="modal-title">{props.title}</Dialog.Title>
          <Dialog.Close className="modal-close" aria-label="关闭">
            ×
          </Dialog.Close>
          <div className="modal-body">{props.children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Empty(props: { readonly children: ReactNode }) {
  return <p className="empty">{props.children}</p>;
}
