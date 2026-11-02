"use client";

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type Labelled = { label: ReactNode; hint?: ReactNode; error?: ReactNode };

function Wrap({ id, label, hint, error, children }: Labelled & { id: string; children: ReactNode }) {
  return (
    <div className="v2-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <span id={`${id}-msg`} className="v2-field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-msg`} className="v2-field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Field({ label, hint, error, ...rest }: Labelled & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <input id={id} className="v2-input" aria-invalid={error ? true : undefined} aria-describedby={hint || error ? `${id}-msg` : undefined} {...rest} />
    </Wrap>
  );
}

export function TextareaField({ label, hint, error, ...rest }: Labelled & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <textarea id={id} className="v2-input" aria-invalid={error ? true : undefined} aria-describedby={hint || error ? `${id}-msg` : undefined} {...rest} />
    </Wrap>
  );
}

export function SelectField({ label, hint, error, children, ...rest }: Labelled & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <select id={id} className="v2-input" aria-invalid={error ? true : undefined} aria-describedby={hint || error ? `${id}-msg` : undefined} {...rest}>
        {children}
      </select>
    </Wrap>
  );
}
