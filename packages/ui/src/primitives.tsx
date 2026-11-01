import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/**
 * Small presentational primitives (§11.4). Plain CSS classes from
 * styles/ui.css so the kit works with or without Tailwind in the app.
 */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "quiet" | "danger";
}

export function Button({ variant = "default", className, type, ...rest }: ButtonProps): ReactNode {
  const variantClass =
    variant === "primary"
      ? "iz-btn--primary"
      : variant === "quiet"
        ? "iz-btn--quiet"
        : variant === "danger"
          ? "iz-btn--danger"
          : "";
  return (
    <button
      type={type ?? "button"}
      className={`iz-btn ${variantClass}${className !== undefined ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label text; rendered above the field. Omit when labelled elsewhere (aria-label). */
  label?: string;
}

export function TextInput({ label, id, className, ...rest }: TextInputProps): ReactNode {
  const field = (
    <input
      id={id}
      className={`iz-input${className !== undefined ? ` ${className}` : ""}`}
      {...rest}
    />
  );
  if (label === undefined) return field;
  return (
    <label className="iz-field">
      <span className="iz-visually-hidden">{label}</span>
      {field}
    </label>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return <div className={`iz-panel${className !== undefined ? ` ${className}` : ""}`}>{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return <div className={`iz-card${className !== undefined ? ` ${className}` : ""}`}>{children}</div>;
}
